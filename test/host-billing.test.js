'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/server'); // isolated SQLite path when selected
const db = require('../db');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL;
let billing;
const now = Date.now();
async function payer(credits) {
  const id = (await db.q('INSERT INTO users(username,email) VALUES($1,$2) RETURNING id', ['bill'+Math.random().toString(36).slice(2), Math.random()+'@ex.test'])).rows[0].id;
  await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,$2)', [id, Math.round(credits*60000)]);
  return id;
}
test.before(async()=>{if(skip)return;await db.ensureReady();billing=require('../src/features/wallet/billing-data');});
test.after(async()=>{await db.close();});
const open = (id,at=now)=>billing.open({userId:id,code:Math.random().toString(36).slice(2,8),name:'Billing test',hostName:'Host',now:at,ownerId:'test-worker'});
test('opening enforces 30 credits atomically, and a second simultaneous room cannot claim a payer', {skip},async()=>{
  const poor=await payer(29.999);await assert.rejects(open(poor),e=>e.status===402);
  const id=await payer(30);const attempts=await Promise.allSettled([open(id),open(id)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(attempts.find(x=>x.status==='rejected').reason.status,409);
});
test('90 seconds debits exactly 1.5 credits once, partial end stops later charges and ledger agrees', {skip},async()=>{
  const id=await payer(30);const {historyId}=await open(id);
  await Promise.all([billing.settle(historyId,{now:now+90000}),billing.settle(historyId,{now:now+90000})]);
  assert.equal((await billing.current(id,now+90000)).balanceCredits,28.5);
  await billing.settle(historyId,{now:now+90500,endReason:'host-ended'});
  await billing.settle(historyId,{now:now+200000});
  assert.equal((await billing.current(id,now+200000)).balanceCredits,28.5-0.5/60);
  const rows=(await db.q('SELECT SUM(delta_units) AS total FROM credit_ledger WHERE billing_session_id=$1',[historyId])).rows;
  assert.equal(Number(rows[0].total),-90500);
});
test('exhaustion clamps to zero and funded instant, warnings clear and rearm after top-ups', {skip},async()=>{
  const id=await payer(30);const {historyId}=await open(id);
  let row=await billing.settle(historyId,{now:now+1200000});assert.equal(row.low_credit, true);
  await db.q('UPDATE credit_wallets SET balance_units=balance_units+600000 WHERE user_id=$1',[id]);
  row=await billing.settle(historyId,{now:now+1200000});assert.equal(row.low_credit,false);
  row=await billing.settle(historyId,{now:now+1800000});assert.equal(row.low_credit,true);
  row=await billing.settle(historyId,{now:now+9999999});assert.equal(row.state,'closing');assert.equal(row.end_reason,'credits-exhausted');
  assert.equal(Number(row.ended_ms),now+2400000);assert.equal((await billing.current(id,now+9999999)).balanceCredits,0);
  await assert.rejects(open(id,now+9999999),e=>e.status===409);
  await assert.rejects(db.tx(c=>require('../src/features/wallet/data').assertCanDelete(c,id)),e=>e.status===409);
});

test('usage history includes negative meeting debits with no payment reference', {skip},async()=>{
 const id=await payer(30),{historyId}=await open(id);await billing.settle(historyId,{now:now+90000});
 const history=await require('../src/features/wallet/data').history(id);
 assert.equal(history.entries[0].type,'usage');assert.equal(history.entries[0].credits,-1.5);assert.ok(history.entries[0].meetingCode);assert.equal(history.entries[0].reference,null);
});
test('a late top-up reconciles exhaustion before adding funds and never revives a closed session',{skip},async()=>{
 const id=await payer(30),{historyId}=await open(id);
 await db.tx(async c=>{await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[id]);await billing.reconcileLocked(c,id,now+1800001);await c.query('UPDATE credit_wallets SET balance_units=600000 WHERE user_id=$1',[id]);});
 assert.equal((await billing.get(historyId)).state,'closing');assert.equal((await billing.current(id,now+1801000)).balanceCredits,10);
});
test('failed media cleanup is durable, retry deletes main and breakout rooms before releasing the host slot',{skip},async()=>{
 const id=await payer(30),{historyId,session}=await open(id);
 await billing.mediaToken(historyId,session.media_room,now);await billing.mediaToken(historyId,session.media_room+'-bo-1',now);
 await billing.settle(historyId,{now:now+1000,endReason:'host-ended'});
 const runner=require('../src/features/wallet/billing'),deleted=[];
 await assert.rejects(runner.closeMedia(await billing.get(historyId),now+1000,{deleteRoom:async()=>{throw Error('unreachable');}}));
 assert.ok((await billing.pendingCleanup(now+1000)).some(x=>String(x.id)===String(historyId)));
 await runner.closeMedia(await billing.get(historyId),now+1000,{deleteRoom:async name=>deleted.push(name)});
 assert.deepEqual(deleted,[session.media_room,session.media_room+'-bo-1']);assert.equal((await billing.get(historyId)).state,'closed');
 // Self-hosted cached/refreshed tokens can recreate the retired namespace; keep cleanup retryable for 11min.
 assert.ok((await billing.pendingCleanup(now+7000)).some(x=>String(x.id)===String(historyId)));
});
test('healthy overlapping worker is left alone; a lost owner without a snapshot closes at its checkpoint',{skip},async()=>{
 const id=await payer(30),{historyId}=await open(id);const runner=require('../src/features/wallet/billing');
 await billing.heartbeat('test-worker',false,now);await runner.recoverSession(await billing.get(historyId),now+1000);assert.equal((await billing.get(historyId)).state,'active');
 await billing.heartbeat('test-worker',true,now);await runner.recoverSession(await billing.get(historyId),now+5000);
 const row=await billing.get(historyId);assert.equal(row.end_reason,'restart-lost');assert.equal(Number(row.charged_units),0);assert.equal(Number(row.ended_ms),now);
});
test('restart snapshots resume the same paid session below the opening minimum, and exhausted ones cannot restore',{skip},async()=>{
 const snapshots=require('../src/rooms/snapshot'),store=require('../src/rooms/store'),runner=require('../src/features/wallet/billing');
 for(const minutes of [1,31]) {
  const start=Date.now()-minutes*60000,id=await payer(30),{historyId,session}=await open(id,start);
  const meeting={code:session.code,name:'Recovered',historyId,billingId:historyId,mediaRoom:session.media_room,participants:new Map(),createdAt:start};
  await db.q('INSERT INTO meeting_snapshots(code,history_id,state) VALUES($1,$2,$3::jsonb)',[session.code,historyId,snapshots.serialize(meeting)]);
  await billing.heartbeat('test-worker',true);await runner.recoverSession(await billing.get(historyId));
  const row=await billing.get(historyId);
  if(minutes===1){assert.ok(store.getMeeting(session.code));assert.equal(row.state,'active');assert.equal(row.owner_id,runner.ownerId);assert.ok(Number(row.charged_units)>=60000);assert.equal(String(row.history_id),String(historyId));store.deleteMeeting(session.code);}
  else {assert.equal(store.getMeeting(session.code),undefined);assert.equal(row.end_reason,'credits-exhausted');assert.equal(Number(row.charged_units),1800000);}
 }
});
test('lazy restore claims billing ownership before consuming its snapshot, and stale recovery cannot close it',{skip},async()=>{
 const snapshots=require('../src/rooms/snapshot'),store=require('../src/rooms/store'),runner=require('../src/features/wallet/billing');
 const id=await payer(30),{historyId,session}=await open(id);await billing.heartbeat('test-worker',true);
 const stale=await billing.get(historyId);
 await db.q('INSERT INTO meeting_snapshots(code,history_id,state) VALUES($1,$2,$3::jsonb)',[session.code,historyId,snapshots.serialize({code:session.code,name:'Lazy',billingId:historyId,historyId,participants:new Map()})]);
 assert.ok(await snapshots.getOrRestoreMeeting(session.code));
 await runner.recoverSession(stale);
 assert.equal((await billing.get(historyId)).state,'active');assert.equal((await billing.get(historyId)).owner_id,runner.ownerId);store.deleteMeeting(session.code);
});
test('retired media recreated after the cleanup horizon is swept, and deletion failures are durably retried',{skip},async()=>{
 const runner=require('../src/features/wallet/billing'),id=await payer(30),{historyId,session}=await open(id);
 await billing.mediaToken(historyId,session.media_room,now);await billing.settle(historyId,{now:now+1000,endReason:'host-ended'});
 await billing.markCleaned(historyId,now+1000);
 const later=now+12*60000,deleted=[];
 assert.ok(!(await billing.pendingCleanup(later)).some(s=>String(s.id)===String(historyId)));
 await runner.sweepRetired({listRooms:async()=>[{name:session.media_room}],deleteRoom:async()=>{throw Error('offline');}},later);
 assert.ok((await billing.pendingCleanup(later)).some(s=>String(s.id)===String(historyId)));
 await runner.sweepRetired({listRooms:async()=>[{name:session.media_room}],deleteRoom:async name=>deleted.push(name)},later+1000);
 assert.deepEqual(deleted,[session.media_room]);
});
test('expired snapshots settle at their restore cutoff and stale owners cannot end an adopted active session',{skip},async()=>{
 const snapshots=require('../src/rooms/snapshot'),runner=require('../src/features/wallet/billing'),config=require('../src/config');
 const at=Date.now(),start=at-config.RESTART.restoreMaxMs-120000,id=await payer(120),{historyId,session}=await open(id,start);
 const savedAt=at-config.RESTART.restoreMaxMs-60000;
 await db.q('INSERT INTO meeting_snapshots(code,history_id,state,created_at) VALUES($1,$2,$3::jsonb,$4)',[session.code,historyId,snapshots.serialize({code:session.code,billingId:historyId,historyId,participants:new Map()}),new Date(savedAt).toISOString()]);
 await billing.heartbeat('test-worker',true);await runner.recoverSession(await billing.get(historyId),at);
 const row=await billing.get(historyId);assert.equal(Number(row.ended_ms),at-60000);assert.equal(Number(row.charged_units),Number(row.ended_ms)-start);assert.equal(row.end_reason,'restart-expired');
 const other=await payer(30),opened=await open(other);await billing.claim(opened.historyId,runner.ownerId,at);
 await assert.rejects(billing.settle(opened.historyId,{now:at+1000,endReason:'stale-ended',ownerId:'test-worker'}),e=>e.status===409);assert.equal((await billing.get(opened.historyId)).state,'active');
});
