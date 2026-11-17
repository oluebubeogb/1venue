const crypto = require('node:crypto');
const db = require('../../../db');
const { fail, UNITS_PER_CREDIT: U } = require('./rules');
const shape = r => r ? { ...r, low_credit: !!r.low_credit, media_issued: !!r.media_issued } : null;
const get = async id => shape((await db.q('SELECT * FROM credit_billing_sessions WHERE id=$1',[id])).rows[0]);
async function lockUser(c,id) {
  if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0]) throw fail(409,'Billing account is unavailable');
}
async function open({userId,code,name,hostName,ownerId,now=Date.now()}) {
  try { return await db.tx(async c=>{
    await lockUser(c,userId);
    if ((await c.query("SELECT id FROM credit_billing_sessions WHERE user_id=$1 AND state<>'closed'",[userId])).rows[0]) throw fail(409,'You already have an open meeting. End it before opening another.');
    const wallet=(await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
    if(Number(wallet?.balance_units||0)<30*U)throw fail(402,'You need at least 30 credits to open a meeting. Top up your credit wallet.');
    const historyId=(await c.query('INSERT INTO meeting_history(code,name,host_user_id,host_display_name,max_participants) VALUES($1,$2,$3,$4,1) RETURNING id',[code,name,userId,hostName])).rows[0].id;
    const media='b-'+crypto.randomBytes(16).toString('hex');
    const session=(await c.query('INSERT INTO credit_billing_sessions(id,history_id,user_id,code,media_room,owner_id,started_ms,accounted_ms) VALUES($1::bigint,$1::int,$2,$3,$4,$5,$6,$6) RETURNING *',[historyId,userId,code,media,ownerId,now])).rows[0];
    return {historyId,session:shape(session)};
  }); } catch(e) {if(e.code==='23505')throw fail(409,'This host or room already has an open meeting');throw e;}
}
async function settle(id,{now=Date.now(),endReason=null,ownerId=null}={}) {
  const original=await get(id); if(!original)return null;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (row.state==='active' && ownerId && row.owner_id!==ownerId) throw fail(409,'This meeting is reconnecting to another server');
    return settleLocked(c,row,now,endReason);
  });
}
async function settleLocked(c,row,now,endReason=null) {
    const id=row.id;
    if(row.state!=='active')return shape(row);
    const wallet=(await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1 FOR UPDATE',[row.user_id])).rows[0];
    const available=Number(wallet.balance_units),previous=Number(row.accounted_ms);
    const elapsed=Math.max(0,Math.floor(now)-previous),debit=Math.min(elapsed,available),balance=available-debit;
    const through=previous+debit;
    if(debit>0) {
      await c.query('UPDATE credit_wallets SET balance_units=$2,updated_at=NOW() WHERE user_id=$1',[row.user_id,balance]);
      await c.query("INSERT INTO credit_ledger(user_id,billing_session_id,through_ms,kind,delta_units,balance_after_units) VALUES($1,$2,$3,'usage',$4,$5)",[row.user_id,id,through,-debit,balance]);
    }
    const reason=balance===0?'credits-exhausted':endReason;
    const ended=reason?through:null;
    const updated=(await c.query('UPDATE credit_billing_sessions SET accounted_ms=$2,charged_units=charged_units+$3,low_credit=$4,state=$5,ended_ms=$6,end_reason=$7,cleanup_until_ms=$8 WHERE id=$1 RETURNING *',[id,through,debit,balance<=10*U,reason?'closing':'active',ended,reason,reason?ended+11*60*1000:null])).rows[0];
    if(reason)await c.query('UPDATE meeting_history SET ended_at=$2 WHERE id=$1 AND ended_at IS NULL',[row.history_id,new Date(ended).toISOString()]);
    return shape(updated);
}
async function reconcileLocked(c,userId,now=Date.now()) {
  const row=(await c.query("SELECT * FROM credit_billing_sessions WHERE user_id=$1 AND state='active' FOR UPDATE",[userId])).rows[0];
  return row ? settleLocked(c,row,now) : null;
}
async function current(userId,now=Date.now()) {
  const active=(await db.q("SELECT id FROM credit_billing_sessions WHERE user_id=$1 AND state<>'closed'",[userId])).rows[0];
  const row=active?await settle(active.id,{now}):null;
  const balance=Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1',[userId])).rows[0]?.balance_units||0)/U;
  return {balanceCredits:balance,billing:row?{sessionId:String(row.id),code:row.code,state:row.state,lowCredit:row.low_credit,remainingMinutes:balance,reason:row.end_reason}:null};
}
async function mediaToken(id,room,now=Date.now()) {
  return db.tx(async c=>{
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row||row.state!=='active')throw fail(410,'This meeting has ended');
    const rooms=typeof row.media_rooms==='string'?JSON.parse(row.media_rooms):row.media_rooms;
    if(!rooms.includes(room))rooms.push(room);
    await c.query('UPDATE credit_billing_sessions SET media_rooms=$2,media_issued=$3 WHERE id=$1',[id,JSON.stringify(rooms),true]);
    const balance=Number((await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1',[row.user_id])).rows[0]?.balance_units||0);
    const remaining=balance-Math.max(0,now-Number(row.accounted_ms));
    if(remaining<=0)throw fail(410,'The host has run out of credits');
    return Math.max(1,Math.min(60,Math.floor(remaining/1000)));
  });
}
async function pendingCleanup(now=Date.now()) {return (await db.q("SELECT * FROM credit_billing_sessions WHERE state='closing' OR (state='closed' AND cleanup_until_ms>$1 AND (last_cleanup_ms IS NULL OR last_cleanup_ms<=$2))",[now,now-5000])).rows.map(shape);}
async function markCleaned(id,now=Date.now()) {await db.q("UPDATE credit_billing_sessions SET state='closed',last_cleanup_ms=$2 WHERE id=$1 AND state<>'active'",[id,now]);}
async function heartbeat(ownerId,stopped=false,now=Date.now()) {await db.q('INSERT INTO credit_billing_workers(id,heartbeat_ms,stopped) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET heartbeat_ms=$2,stopped=$3',[ownerId,now,stopped]);}
async function claim(id,ownerId,now=Date.now()) {
  const original=await get(id);if(!original)return null;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row.state!=='active')return null;
    if(row.owner_id!==ownerId){
      const worker=(await c.query('SELECT * FROM credit_billing_workers WHERE id=$1',[row.owner_id])).rows[0];
      if(worker&&!worker.stopped&&now-Number(worker.heartbeat_ms)<15000)return null;
    }
    return shape((await c.query('UPDATE credit_billing_sessions SET owner_id=$2 WHERE id=$1 RETURNING *',[id,ownerId])).rows[0]);
  });
}
async function closeLost(id,expectedOwner,now=Date.now()) {
  const original=await get(id);if(!original)return null;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row.state!=='active'||row.owner_id!==expectedOwner)return shape(row);
    const worker=(await c.query('SELECT * FROM credit_billing_workers WHERE id=$1',[row.owner_id])).rows[0];
    if(worker&&!worker.stopped&&now-Number(worker.heartbeat_ms)<15000)return shape(row);
    if((await c.query('SELECT code FROM meeting_snapshots WHERE history_id=$1',[row.history_id])).rows[0])return shape(row);
    return settleLocked(c,row,Number(row.accounted_ms),'restart-lost');
  });
}
async function queueCleanup(id,now=Date.now()) {await db.q('UPDATE credit_billing_sessions SET cleanup_until_ms=$2,last_cleanup_ms=NULL WHERE id=$1 AND state<>\'active\'', [id,now+11*60*1000]);}
module.exports={queueCleanup,claim,closeLost,open,settle,get,current,mediaToken,pendingCleanup,markCleaned,heartbeat,reconcileLocked};
