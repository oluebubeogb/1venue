import {h,api,toast} from './ui.js';
import {icon} from './icons.js';
import {createCreditStore} from './credit-store.js';
const store=createCreditStore({fetchWallet:()=>api('/api/wallet'),setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),visible:()=>document.visibilityState!=='hidden'});
export const subscribeCredits=store.subscribe;
export const refreshCredits=store.refresh;
export const setCreditUser=store.setUser;
export const formatCredits=n=>new Intl.NumberFormat('en-NG',{maximumFractionDigits:3}).format(n);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')refreshCredits();});
window.addEventListener('focus',refreshCredits);
/** Shared compact badge. In a room, open the wallet in a separate tab to keep the call active. */
export function creditBadge({inRoom=false,roomCode=null}={}) {
 const label=h('span',null,'— credits');
 const badge=h('a',{class:'credit-badge',href:'/wallet',...(inRoom?{target:'_blank',rel:'noopener'}:{'data-link':''}),'aria-label':'Credit wallet'},h('span',{'aria-hidden':'true',html:icon('creditCard',{size:16})}),label);
 const notice=h('div',{class:'credit-warning',role:'status',hidden:true,'aria-live':'polite'},h('span',null,'Your credits are running low. This meeting will end when they run out. '),h('a',{href:'/wallet',target:'_blank',rel:'noopener'},'Top up in a new tab'));
 let warned=false,lastSession=null;
 const unsubscribe=subscribeCredits(value=>{
   badge.hidden=!value.userId;
   label.textContent=value.balanceCredits==null?'— credits':formatCredits(value.balanceCredits)+' credits';
   badge.title=value.error?'Balance unavailable. Open your wallet to retry.':'Open your credit wallet';
   badge.setAttribute('aria-label',value.balanceCredits==null?'Credit wallet, balance unavailable':formatCredits(value.balanceCredits)+' credits. Open wallet');
   const session=value.billing?.sessionId||null;
   if(session!==lastSession){warned=false;lastSession=session;}
   const low=!!(value.billing?.state==='active'&&value.billing.lowCredit&&(!inRoom||value.billing.code===roomCode));
   badge.classList.toggle('credit-low',low);notice.hidden=!low;
   if(!low)warned=false;
   if(inRoom&&low&&!warned){toast('10 minutes of credits or less remain. Top up to keep your meeting running.',{icon:'alert',ms:8000});warned=true;}
 });
 return {badge,notice,unsubscribe};
}
