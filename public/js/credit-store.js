// State and request ownership are independent of the DOM, including account changes mid-request.
export function createCreditStore({fetchWallet,setInterval,clearInterval,visible}) {
  let userId=null,generation=0,pending=null,timer=null;
  let value={userId:null,balanceCredits:null,billing:null,error:null};
  const listeners=new Set();
  const emit=()=>{for(const fn of listeners)fn(value);};
  function refresh() {
    if(!userId||!visible())return Promise.resolve();
    if(pending?.generation===generation)return pending.promise;
    const request={generation};
    request.promise=(async()=>{
      try {
        const wallet=await fetchWallet();
        if(request.generation!==generation)return;
        if(String(wallet.userId)!==String(userId))throw Error('Your sign-in changed. Refresh this page.');
        if(!Number.isFinite(wallet.balanceCredits)||wallet.balanceCredits<0)throw Error('Balance is unavailable');
        value={userId,balanceCredits:wallet.balanceCredits,billing:wallet.billing||null,error:null};emit();
      } catch(e) {
        if(request.generation===generation){value={userId,balanceCredits:null,billing:null,error:e.message};emit();}
      } finally {if(pending===request)pending=null;}
    })();
    pending=request;return request.promise;
  }
  function schedule() {
    if(timer!=null){clearInterval(timer);timer=null;}
    if(userId&&listeners.size){timer=setInterval(refresh,5000);refresh();}
  }
  return {
    refresh,
    setUser(id) {if(String(id||'')===String(userId||''))return;userId=id||null;generation++;value={userId,balanceCredits:null,billing:null,error:null};emit();schedule();},
    subscribe(fn){listeners.add(fn);fn(value);schedule();return()=>{listeners.delete(fn);if(!listeners.size&&timer!=null){clearInterval(timer);timer=null;}};},
  };
}
