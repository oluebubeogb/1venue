'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {boot,client,signupPayload}=require('./helpers/server');
const db=require('../db');
const skip=process.env.DB_DRIVER!=='sqlite'&&!process.env.DATABASE_URL;
let s,host,id;
test.before(async()=>{if(skip)return;s=await boot();host=client(s.base);await host.post('/api/signup',signupPayload());id=(await host.get('/api/session')).body.user.id;});
test.after(async()=>{if(s)await s.stop();await db.close();});
test('billable openings require sign-in, 30 credits, reject exemptions and concurrent hosts; guest admission stays free',{skip},async()=>{
 const anon=client(s.base);const denied=await anon.post('/api/create',{name:'Unfunded',participantName:'Ada'});assert.equal(denied.status,401,JSON.stringify(denied.body)+' '+s.output());
 assert.equal((await host.post('/api/create',{name:'Unfunded',participantName:'Ada',billingExempt:true})).status,402);
 await db.q('INSERT INTO credit_wallets(user_id,balance_units) VALUES($1,1800000)',[id]);
 const outcomes=await Promise.all([host.post('/api/create',{name:'Funded A'}),host.post('/api/create',{name:'Funded B'})]);
 assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);
 const room=outcomes.find(x=>x.status===200).body;
 assert.equal((await anon.post('/api/join',{code:room.code,participantName:'Free guest'})).status,200);
 const wallet=(await host.get('/api/wallet')).body;assert.ok(wallet.balanceCredits<=30);assert.equal(wallet.billing.code,room.code);
 const row=(await db.q('SELECT * FROM credit_billing_sessions WHERE user_id=$1',[id])).rows[0];
 assert.ok(row.media_room.startsWith('b-'));assert.notEqual(row.media_room,room.code);
});
test('exhaustion closes the live application room and rejects new joins without another charge',{skip},async()=>{
 const row=(await db.q("SELECT * FROM credit_billing_sessions WHERE user_id=$1 AND state='active'",[id])).rows[0];assert.ok(row);
 await db.q('UPDATE credit_wallets SET balance_units=1 WHERE user_id=$1',[id]);
 await host.get('/api/wallet');
 let status;
 for(let i=0;i<30;i++) {status=(await host.get('/api/meeting/'+row.code)).status;if(status===404)break;await new Promise(r=>setTimeout(r,50));}
 assert.equal(status,404);assert.equal((await client(s.base).post('/api/join',{code:row.code,participantName:'Ben'})).status,404);
 const ended=(await db.q('SELECT * FROM credit_billing_sessions WHERE id=$1',[row.id])).rows[0];assert.equal(ended.end_reason,'credits-exhausted');
 assert.equal((await host.get('/api/wallet')).body.balanceCredits,0);
});
test('only an authorized server-resolved venue retains deferred funding behavior',{skip},async()=>{
 const owner=client(s.base);await owner.post('/api/signup',signupPayload());
 const venue=await owner.post('/api/venues',{name:'Deferred billing venue'});assert.equal(venue.status,200,JSON.stringify(venue.body));
 const forbidden=await host.post('/api/create',{name:'Other owner',venue:venue.body.slug});assert.equal(forbidden.status,403);
 const opened=await owner.post('/api/create',{name:'Venue gathering',venue:venue.body.slug});assert.equal(opened.status,200,JSON.stringify(opened.body));
 assert.equal(opened.body.code,venue.body.code);assert.equal((await owner.get('/api/wallet')).body.balanceCredits,0);assert.equal((await owner.get('/api/wallet')).body.billing,null);
});
