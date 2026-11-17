const test=require('node:test'),assert=require('node:assert/strict');
test('balance store discards stale account results and coalesces requests per account',async()=>{
 const {createCreditStore}=await import('../public/js/credit-store.js');
 const requests=[];const store=createCreditStore({fetchWallet:()=>new Promise(resolve=>requests.push(resolve)),setInterval:()=>1,clearInterval:()=>{},visible:()=>true});
 const values=[];const unsub=store.subscribe(v=>values.push(v));store.setUser(1);store.refresh();assert.equal(requests.length,1);
 store.setUser(2);assert.equal(requests.length,2);requests[0]({userId:1,balanceCredits:100,billing:null});await Promise.resolve();await Promise.resolve();assert.equal(values.at(-1).balanceCredits,null);
 requests[1]({userId:2,balanceCredits:3,billing:{state:'active',lowCredit:true}});await store.refresh();assert.equal(values.at(-1).balanceCredits,3);
 store.setUser(null);assert.equal(values.at(-1).balanceCredits,null);unsub();
});
test('balance store reports failed reads as unavailable, never as an empty wallet',async()=>{
 const {createCreditStore}=await import('../public/js/credit-store.js');let reject;
 const store=createCreditStore({fetchWallet:()=>new Promise((_,r)=>reject=r),setInterval:()=>1,clearInterval:()=>{},visible:()=>true});
 let latest;const off=store.subscribe(v=>latest=v);store.setUser(1);const pending=store.refresh();reject(Error('offline'));await pending;
 assert.equal(latest.balanceCredits,null);assert.equal(latest.error,'offline');off();
});
test('a cross-tab account change cannot display another account balance under the previous session',async()=>{
 const {createCreditStore}=await import('../public/js/credit-store.js');
 const store=createCreditStore({fetchWallet:async()=>({userId:2,balanceCredits:999}),setInterval:()=>1,clearInterval:()=>{},visible:()=>true});
 let latest;const off=store.subscribe(v=>latest=v);store.setUser(1);await store.refresh();assert.equal(latest.balanceCredits,null);assert.ok(latest.error);off();
});
