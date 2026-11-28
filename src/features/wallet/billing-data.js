const crypto = require('node:crypto');
const db = require('../../../db');
const { fail, openMeetingConflict, UNITS_PER_CREDIT: U } = require('./rules');
const rates = require('./rates');
const shape = r => r ? { ...r, low_credit: !!r.low_credit, media_issued: !!r.media_issued } : null;
const get = async id => shape((await db.q('SELECT * FROM credit_billing_sessions WHERE id=$1',[id])).rows[0]);
async function lockUser(c,id) {
  if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0]) throw fail(409,'Billing account is unavailable');
}
function workerLiveMs() { return require('../../config').RESTART.adoptGraceMs; }
/** True only when that worker is not us, not marked stopped, and heartbeating recently. */
async function workerIsLive(c, workerId, now, selfId) {
  if (!workerId || (selfId && String(workerId) === String(selfId))) return false;
  const worker = (await c.query('SELECT * FROM credit_billing_workers WHERE id=$1', [workerId])).rows[0];
  if (!worker || worker.stopped) return false;
  return now - Number(worker.heartbeat_ms) < workerLiveMs();
}
/** Close a leftover non-closed row so it cannot block a new session (no downtime debit). */
async function closeStaleRow(c, row, now) {
  if (row.state === 'active') return settleLocked(c, row, Number(row.accounted_ms), row.end_reason || 'restart-lost');
  if (row.state === 'closing') await c.query("UPDATE credit_billing_sessions SET state='closed' WHERE id=$1 AND state='closing'", [row.id]);
  return row;
}
/**
 * If we already own the session, or the current owner is stopped/dead, take ownership.
 * Throw the reconnecting 409 only when another worker is truly alive.
 */
async function takeIfIdle(c, row, ownerId, now, { force=false }={}) {
  if (!ownerId || String(row.owner_id) === String(ownerId)) return row;
  if (!force && await workerIsLive(c, row.owner_id, now, ownerId)) {
    throw fail(409, 'This meeting is reconnecting to another server');
  }
  return (await c.query('UPDATE credit_billing_sessions SET owner_id=$2 WHERE id=$1 RETURNING *', [row.id, ownerId])).rows[0];
}
/** Reopen a closing/closed row for a meeting that is still live in this process. */
async function reopenRow(c, row, ownerId, now) {
  const updated = (await c.query(
    `UPDATE credit_billing_sessions
        SET state='active', owner_id=$2, end_reason=NULL, ended_ms=NULL, cleanup_until_ms=NULL, last_cleanup_ms=NULL,
            accounted_ms=GREATEST(accounted_ms, $3)
      WHERE id=$1 RETURNING *`,
    [row.id, ownerId, Math.floor(now)]
  )).rows[0];
  if (row.history_id) await c.query('UPDATE meeting_history SET ended_at=NULL WHERE id=$1', [row.history_id]);
  return updated;
}

async function open({userId=null,code,name,hostName,ownerId,now=Date.now()}) {
  try { return await db.tx(async c=>{
    if(userId!=null){
      await lockUser(c,userId);
      const existing=(await c.query("SELECT * FROM credit_billing_sessions WHERE user_id=$1 AND state<>'closed' FOR UPDATE",[userId])).rows;
      for (const row of existing) {
        const ours=ownerId&&String(row.owner_id)===String(ownerId);
        if (row.state==='active' && (ours || await workerIsLive(c, row.owner_id, now, ownerId))) throw openMeetingConflict(row);
        await closeStaleRow(c, row, now);
      }
      const paid = (await c.query("SELECT code, history_id FROM paid_meeting_sessions WHERE host_user_id=$1 AND state='active'",[userId])).rows[0];
      if (paid) throw openMeetingConflict(paid);
    }
    const staleCode=(await c.query("SELECT * FROM credit_billing_sessions WHERE code=$1 AND state<>'closed' FOR UPDATE",[code])).rows;
    for (const row of staleCode) {
      const ours=ownerId&&String(row.owner_id)===String(ownerId);
      if (row.state==='active' && (ours || await workerIsLive(c, row.owner_id, now, ownerId))) throw fail(409,'This host or room already has an open meeting');
      await closeStaleRow(c, row, now);
    }
    const historyId=(await c.query('INSERT INTO meeting_history(code,name,host_user_id,host_display_name,max_participants) VALUES($1,$2,$3,$4,1) RETURNING id',[code,name,userId,hostName])).rows[0].id;
    const media='b-'+crypto.randomBytes(16).toString('hex');
    const session=(await c.query('INSERT INTO credit_billing_sessions(id,history_id,user_id,code,media_room,owner_id,started_ms,accounted_ms,free_until_ms) VALUES($1::bigint,$1::int,$2,$3,$4,$5,$6,$6,$7) RETURNING *',[historyId,userId,code,media,ownerId,now,rates.freeUntilMs(now)])).rows[0];
    return {historyId,session:shape(session)};
  }); } catch(e) {if(e.code==='23505')throw fail(409,'This host or room already has an open meeting');throw e;}
}
async function settle(id,{now=Date.now(),endReason=null,ownerId=null,force=false,publishers,viewers,skipAutoTopup=false}={}) {
  const original=await get(id); if(!original)return null;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    let row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (row.state==='active' && ownerId && row.owner_id!==ownerId) row=await takeIfIdle(c,row,ownerId,now,{force});
    return settleLocked(c,row,now,endReason,{publishers,viewers});
  }).then((out)=>{ // a debit happened: maybe auto top-up (async, single-flight, see autotopup.js)
    if(out&&!skipAutoTopup&&original.user_id!=null)require('./autotopup').maybeAfterDebit(Number(original.user_id),null);
    return out;
  });
}
async function settleLocked(c,row,now,endReason=null,counts={}) {
    const id=row.id;
    if(row.state!=='active')return shape(row);
    if(row.deferred){
      if(!endReason)return shape(row);
      const ended=Math.floor(now);
      const updated=(await c.query("UPDATE credit_billing_sessions SET state='closing',ended_ms=$2,end_reason=$3,cleanup_until_ms=$4 WHERE id=$1 RETURNING *",[id,ended,endReason,ended+11*60*1000])).rows[0];
      await c.query('UPDATE meeting_history SET ended_at=$2 WHERE id=$1 AND ended_at IS NULL',[row.history_id,new Date(ended).toISOString()]);
      return shape(updated);
    }
    const freeUntil=Number(row.free_until_ms||row.started_ms), hasStartedBilling=Math.floor(now)>=freeUntil;
    if(!hasStartedBilling&&!endReason)return shape(row);
    if(row.user_id!=null) await require('./spend').syncPlanLocked(c, row.user_id, new Date(now));
    const wallet=row.user_id==null?null:(await c.query('SELECT * FROM credit_wallets WHERE user_id=$1 FOR UPDATE',[row.user_id])).rows[0];
    const available=Math.max(0,Number(wallet?.balance_units||0)),previous=(endReason&&Math.floor(now)<freeUntil)?Math.floor(now):Math.max(Number(row.accounted_ms),freeUntil);
    const endpoint=endReason?Math.floor(now):Math.max(freeUntil,Math.floor(now));
    const elapsed=Math.max(0,endpoint-previous);
    const pubs = counts.publishers == null ? 1 : counts.publishers;
    const views = counts.viewers == null ? 0 : counts.viewers;
    const due=rates.unitsForElapsed(elapsed, pubs, views);
    // If the room rate is faster than 1 unit/ms, the clock still advances by elapsed ms; we may
    // run out of credits before the endpoint. Map debit back onto the accounted clock using the rate.
    const unitsPerMs = elapsed ? due / elapsed : rates.unitsForElapsed(1000, pubs, views) / 1000;
    const debit=Math.min(due,available);
    const msCovered = due>0 ? Math.floor(elapsed * (debit / due)) : elapsed;
    const balance=Math.max(0,available-debit);
    const through=previous+msCovered;
    if(debit>0&&row.user_id!=null) {
      const planUnits=Math.max(0,Number(wallet.plan_balance_units||0));
      const nextPlan=Math.max(0,planUnits-Math.min(planUnits,debit));
      const nextUsed=Number(wallet.period_used_units||0)+debit;
      await c.query('UPDATE credit_wallets SET balance_units=$2,plan_balance_units=$3,period_used_units=$4,updated_at=NOW() WHERE user_id=$1',[row.user_id,balance,nextPlan,nextUsed]);
      await c.query("INSERT INTO credit_ledger(user_id,billing_session_id,through_ms,kind,delta_units,balance_after_units) VALUES($1,$2,$3,'usage',$4,$5)",[row.user_id,id,through,-debit,balance]);
    }
    const exhausted=hasStartedBilling&&balance===0;
    const reason=exhausted?(row.user_id==null?'credits-required':'credits-exhausted'):endReason;
    const ended=reason?(exhausted?through:Math.floor(now)):null;
    const updated=(await c.query('UPDATE credit_billing_sessions SET accounted_ms=$2,charged_units=charged_units+$3,low_credit=$4,state=$5,ended_ms=$6,end_reason=$7,cleanup_until_ms=$8 WHERE id=$1 RETURNING *',[id,through,debit,balance<=10*U,reason?'closing':'active',ended,reason,reason?ended+11*60*1000:null])).rows[0];
    if(reason)await c.query('UPDATE meeting_history SET ended_at=$2 WHERE id=$1 AND ended_at IS NULL',[row.history_id,new Date(ended).toISOString()]);
    return shape(updated);
}
async function reconcileLocked(c,userId,now=Date.now()) {
  const row=(await c.query("SELECT * FROM credit_billing_sessions WHERE user_id=$1 AND state='active' FOR UPDATE",[userId])).rows[0];
  return row ? settleLocked(c,row,now) : null;
}
async function current(userId,now=Date.now()) {
  // Read-only: never settle() here. Wallet polls must not charge, including after a
  // restart when the meeting is not live in this process.
  const row=shape((await db.q("SELECT * FROM credit_billing_sessions WHERE user_id=$1 AND state<>'closed'",[userId])).rows[0]);
  const balance=Number((await db.q('SELECT balance_units FROM credit_wallets WHERE user_id=$1',[userId])).rows[0]?.balance_units||0)/U;
  return {balanceCredits:balance,billing:row?{sessionId:String(row.id),code:row.code,state:row.state,lowCredit:row.low_credit&&now>=Number(row.free_until_ms||row.started_ms),remainingMinutes:balance,reason:row.end_reason}:null};
}
async function claimHost(id,user,now=Date.now()) {
  return db.tx(async c=>{
    await lockUser(c,user.id);
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row||row.state!=='active'||now>=Number(row.free_until_ms||row.started_ms))throw fail(410,'The free meeting period has ended');
    if(row.user_id!=null)return Number(row.user_id)===Number(user.id)?shape(row):(()=>{throw fail(409,'This meeting is linked to another account')})();
    if((await c.query("SELECT id FROM credit_billing_sessions WHERE user_id=$1 AND state<>'closed'",[user.id])).rows[0])throw fail(409,'You already have another open meeting');
    await c.query('INSERT INTO credit_wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);
    await c.query('UPDATE credit_billing_sessions SET user_id=$2 WHERE id=$1',[id,user.id]);
    await c.query('UPDATE meeting_history SET host_user_id=$2 WHERE id=$1',[row.history_id,user.id]);
    return shape((await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1',[id])).rows[0]);
  });
}
async function mediaToken(id,room,now=Date.now()) {
  return db.tx(async c=>{
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row||row.state!=='active')throw fail(410,'This meeting has ended');
    const rooms=typeof row.media_rooms==='string'?JSON.parse(row.media_rooms):row.media_rooms;
    if(!rooms.includes(room))rooms.push(room);
    await c.query('UPDATE credit_billing_sessions SET media_rooms=$2,media_issued=$3 WHERE id=$1',[id,JSON.stringify(rooms),true]);
    const freeUntil=Number(row.free_until_ms||row.started_ms);
    if(now<freeUntil)return Math.max(1,Math.min(60,Math.ceil((freeUntil-now)/1000)));
    if(row.user_id==null)throw fail(410,'Sign in and add credits to continue this meeting');
    const balance=Number((await c.query('SELECT balance_units FROM credit_wallets WHERE user_id=$1',[row.user_id])).rows[0]?.balance_units||0);
    const remaining=balance-Math.max(0,now-Math.max(Number(row.accounted_ms),freeUntil));
    if(remaining<=0)throw fail(410,'The host has run out of credits');
    return Math.max(1,Math.min(60,Math.floor(remaining/1000)));
  });
}
async function pendingCleanup(now=Date.now()) {return (await db.q("SELECT * FROM credit_billing_sessions WHERE state='closing' OR (state='closed' AND cleanup_until_ms>$1 AND (last_cleanup_ms IS NULL OR last_cleanup_ms<=$2))",[now,now-5000])).rows.map(shape);}
async function markCleaned(id,now=Date.now()) {await db.q("UPDATE credit_billing_sessions SET state='closed',last_cleanup_ms=$2 WHERE id=$1 AND state<>'active'",[id,now]);}
// A running process re-registers itself (stopped=false). stop() sets stopping first, waits
// for an in-flight tick, then calls heartbeat(id, true), so a tick cannot undo shutdown.
async function heartbeat(ownerId,stopped=false,now=Date.now()) {await db.q('INSERT INTO credit_billing_workers(id,heartbeat_ms,stopped) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET heartbeat_ms=$2,stopped=EXCLUDED.stopped',[ownerId,now,stopped]);}
async function claim(id,ownerId,now=Date.now()) {
  const original=await get(id);if(!original)return null;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row.state!=='active')return null;
    if(await workerIsLive(c,row.owner_id,now,ownerId))return null;
    return shape((await c.query('UPDATE credit_billing_sessions SET owner_id=$2 WHERE id=$1 RETURNING *',[id,ownerId])).rows[0]);
  });
}
async function closeLost(id,expectedOwner,now=Date.now(),{force=false}={}) {
  const original=await get(id);if(!original)return null;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    const row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(row.state!=='active')return shape(row);
    if(expectedOwner&&row.owner_id!==expectedOwner)return shape(row);
    if(!force){
      if(await workerIsLive(c,row.owner_id,now,null))return shape(row);
      if((await c.query('SELECT code FROM meeting_snapshots WHERE history_id=$1',[row.history_id])).rows[0])return shape(row);
    } else {
      await c.query('DELETE FROM meeting_snapshots WHERE history_id=$1',[row.history_id]);
    }
    return settleLocked(c,row,Number(row.accounted_ms),'restart-lost');
  });
}
/** Advance accounted_ms to now without debiting, so a resume never bills the downtime gap. */
async function skipDowntime(id,{now=Date.now(),ownerId=null}={}) {
  const original=await get(id);if(!original||original.state!=='active')return original;
  return db.tx(async c=>{
    if(original.user_id!=null)await lockUser(c,original.user_id);
    let row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row||row.state!=='active')return shape(row);
    if(ownerId&&row.owner_id!==ownerId)row=await takeIfIdle(c,row,ownerId,now);
    const accounted=Math.max(Number(row.accounted_ms),Math.floor(now));
    if(accounted===Number(row.accounted_ms))return shape(row);
    return shape((await c.query('UPDATE credit_billing_sessions SET accounted_ms=$2 WHERE id=$1 RETURNING *',[id,accounted])).rows[0]);
  });
}
async function queueCleanup(id,now=Date.now()) {await db.q('UPDATE credit_billing_sessions SET cleanup_until_ms=$2,last_cleanup_ms=NULL WHERE id=$1 AND state<>\'active\'', [id,now+11*60*1000]);}
/** Make this session billable by this process: take over an idle owner, or reopen a leftover closing row. */
async function ensureLive(meeting,{ownerId,now=Date.now(),force=false}={}) {
  const id=meeting?.billingId; if(id==null)return null;
  return db.tx(async c=>{
    const original=await get(id);
    if(original?.user_id!=null)await lockUser(c,original.user_id);
    let row=(await c.query('SELECT * FROM credit_billing_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row)return null;
    if(row.state==='active')return shape(await takeIfIdle(c,row,ownerId,now,{force}));
    // closing/closed leftover (e.g. a manual SQL stop) must not kill a room that is live here.
    if(force || row.end_reason==='manual-stop' || row.end_reason==='restart-lost' || row.end_reason==='restart-expired'){
      return shape(await reopenRow(c,row,ownerId,now));
    }
    return shape(row);
  });
}

module.exports={queueCleanup,claimHost,claim,closeLost,skipDowntime,open,settle,get,current,mediaToken,pendingCleanup,markCleaned,heartbeat,reconcileLocked,ensureLive,workerIsLive,takeIfIdle};

