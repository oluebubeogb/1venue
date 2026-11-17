const crypto=require('node:crypto');
const db=require('../../../db');
const data=require('./billing-data');
const config=require('../../config');
const store=require('../../rooms/store');
const {cleanup,roomClient}=require('../../livekit/cleanup');
const {fail}=require('./rules');
const ownerId=crypto.randomUUID();
let busy=false;
let lastMediaSweep=0;
let mediaBusy=false,stopping=false;
async function start({user,code,name,hostName}) {
  if(!user)throw fail(401,'Sign in to open a meeting and use your credit wallet');
  return data.open({userId:user.id,code,name,hostName,ownerId});
}
async function check(meeting) {
  if(!meeting?.billingId)return null;
  const row=await data.settle(meeting.billingId,{ownerId});
  if(!row||row.state!=='active') {
    await require('../../rooms/lifecycle').endMeeting(meeting.code,row?.end_reason||'credits-exhausted');
    throw fail(410,'This meeting has ended because its credits ran out or it was closed');
  }
  return row;
}
async function end(meeting,reason,now=Date.now()) {
  if(!meeting.billingId)return;
  return data.settle(meeting.billingId,{now,endReason:reason,ownerId});
}
async function closeMedia(row,now=Date.now(),client) {
  try {await cleanup(row,client);await data.markCleaned(row.id,now);}
  catch(e){await data.queueCleanup(row.id,now);throw e;}
}
async function sweepRetired(client=roomClient(),now=Date.now()) {
  if(!client)return;
  const rooms=await client.listRooms();
  const bases=[...new Set(rooms.map(room=>room.name.replace(/-bo-\d+$/,'')).filter(name=>/^b-[a-f0-9]{32}$/.test(name)))];
  if(!bases.length)return;
  const retired=(await db.q("SELECT * FROM credit_billing_sessions WHERE media_room = ANY($1::text[]) AND state<>'active'",[bases])).rows;
  for(const row of retired) {
    const observed=rooms.map(room=>room.name).filter(name=>name===row.media_room||name.startsWith(row.media_room+'-bo-'));
    const recorded=typeof row.media_rooms==='string'?JSON.parse(row.media_rooms):row.media_rooms;
    try {await closeMedia({...row,media_issued:true,media_rooms:[...new Set([...recorded,...observed])]},now,client);}
    catch(e){console.warn('[billing] retired media cleanup',row.id,e.message);}
  }
}
async function recoverSession(row,now=Date.now()) {
  const worker=(await db.q('SELECT * FROM credit_billing_workers WHERE id=$1',[row.owner_id])).rows[0];
  if(worker&&!worker.stopped&&now-Number(worker.heartbeat_ms)<15000)return;
  const snapshot=(await db.q('SELECT created_at,state FROM meeting_snapshots WHERE history_id=$1',[row.history_id])).rows[0];
  if(!snapshot) {
    await data.closeLost(row.id,row.owner_id,now);
    return;
  }
  const cutoff=new Date(snapshot.created_at).getTime()+config.RESTART.restoreMaxMs;
  if(now>=cutoff) {
    await data.settle(row.id,{now:cutoff,endReason:'restart-expired'});
    return;
  }
  const meeting=await require('../../rooms/snapshot').getOrRestoreMeeting(row.code);
  if(meeting&&String(meeting.billingId)===String(row.id)) {
    return;
  } else await data.closeLost(row.id,row.owner_id,now);
}
async function tick(now=Date.now()) {
  if(busy||stopping)return;busy=true;
  try {
    await data.heartbeat(ownerId,false,now);
    const rows=(await db.q("SELECT s.*,w.balance_units FROM credit_billing_sessions s JOIN credit_wallets w ON w.user_id=s.user_id WHERE s.state='active'")).rows;
    for(let row of rows) {
      try {
        if(row.owner_id!==ownerId) {await recoverSession(row,now);row=await data.get(row.id);if(row.owner_id!==ownerId||row.state!=='active')continue;}
        if(now-Number(row.accounted_ms)>=Math.min(5000,Number(row.balance_units??0)))row=await data.settle(row.id,{now,ownerId});
        const meeting=store.getMeeting(row.code);
        if(row.state!=='active'&&meeting&&String(meeting.billingId)===String(row.id))await require('../../rooms/lifecycle').endMeeting(row.code,row.end_reason);
      } catch(e) {console.warn('[billing] reconcile',row.id,e.message);}
    }
    cleanupTick(now).catch(e=>console.warn('[billing] cleanup job',e.message));
  } finally {busy=false;}
}
async function cleanupTick(now=Date.now()) {
  if(mediaBusy||stopping)return;mediaBusy=true;
  try {
    for(const row of await data.pendingCleanup(now)) {
      try {
        const meeting=store.getMeeting(row.code);
        if(meeting&&String(meeting.billingId)===String(row.id))await require('../../rooms/lifecycle').endMeeting(row.code,row.end_reason);
        await closeMedia(row,now);
      } catch(e){console.warn('[billing] media cleanup',row.id,e.message);}
    }
    if(now-lastMediaSweep>=5000){
      lastMediaSweep=now;
      try{await sweepRetired(undefined,now);}catch(e){console.warn('[billing] media sweep',e.message);}
    }
  } finally {mediaBusy=false;}
}
async function recover(){await tick();}
async function stop(){stopping=true;await data.heartbeat(ownerId,true);}
module.exports={cleanupTick,sweepRetired,start,check,end,tick,recover,stop,closeMedia,recoverSession,ownerId};
