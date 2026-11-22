import {el,listen} from '../../js/dom.js';
import {goldCoin} from './coin-reward.js';

const ROLES=new Set(['student','teacher','admin','owner']);
const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const valid=data=>typeof data?.claimed==='boolean'&&data.cycle===7&&/^\d{4}-\d{2}-\d{2}$/.test(data.date)&&
 Number.isInteger(data.streak)&&data.streak>=0&&data.streak<=7&&
 data.todayCoins===(data.claimed?data.streak:0)&&
 data.nextCoins===(data.claimed?0:data.streak%7+1);

/** Server grants the reward. This account-scoped controller only presents it. */
export function dailyReward({session,signal,client,storage}){
 if(!ROLES.has(session?.user?.role)||session.user.accountStatus!=='active')return {update(){}};
 let context,eligible=false,requested='',pending=false,state,dialog,returnFocus;
 const seen=new Set();
 const key=day=>'la:daily-reward-seen:v2:'+session.user.id+':'+day;
 const alreadySeen=day=>{try{return seen.has(day)||(storage??globalThis.localStorage)?.getItem(key(day))==='1';}catch{return seen.has(day);}};
 const markSeen=day=>{seen.add(day);try{(storage??globalThis.localStorage)?.setItem(key(day),'1');}catch{}};
 function remove(){
  if(!dialog)return;
  const node=dialog;dialog=null;
  if(node.open&&typeof node.close==='function')node.close();
  node.remove();
  if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  returnFocus=null;
 }
 function show(){
  if(signal.aborted||!eligible||!context||!state||state.claimed||alreadySeen(state.date)||dialog||document.visibilityState==='hidden'||document.querySelector('dialog[open],[aria-modal="true"]'))return;
  const uz=context.locale==='uz',t=(a,b)=>uz?a:b,next=state.nextCoins;
  const completedDays=state.streak===7?0:state.streak;
  const close=el('button',{type:'button',class:'daily-reward-close','aria-label':t('Yopish','Close')},'×');
  const days=el('ol',{class:'daily-reward-days'},Array.from({length:7},(_,i)=>el('li',{
   class:'daily-reward-day'+(i<completedDays?' daily-reward-day--claimed':''),
   'aria-current':i+1===next?'step':null,
  },el('span',{},t((i+1)+'-KUN','DAY '+(i+1))),goldCoin(),el('strong',{},'+'+(i+1)),
   el('span',{class:'daily-reward-day-state'},i<completedDays?t('Olindi','Claimed'):i===completedDays?t('Olish mumkin','Available'):t('Kutilmoqda','Upcoming')))));
  const balance=el('p',{class:'daily-reward-balance',hidden:true});
  const earned=el('p',{class:'daily-reward-earned',role:'status'},t('Bugun +'+next+' tanga olish mumkin.','Claim +'+next+' coins today.'));
  const message=el('p',{role:'alert',class:'daily-reward-error',hidden:true});
  const claimButton=el('button',{type:'button',class:'btn-primary daily-reward-claim','data-daily-reward-claim':''},t('Olish','Claim'));
  const link=(label,href)=>{const a=el('a',{href,class:'btn-secondary'},label);listen(a,'click',event=>{
   if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   event.preventDefault();remove();void context.navigate(href);
  },signal);return a;};
  dialog=el('dialog',{class:'daily-reward-dialog','data-daily-reward':'','aria-labelledby':'daily-reward-title','aria-describedby':'daily-reward-description'},
   close,goldCoin(),el('h2',{id:'daily-reward-title'},t('Kunlik mukofot','Daily reward')),
   el('p',{id:'daily-reward-description'},t('Har kuni qayting. Ketma-ket 7 kunda +1 dan +7 gacha tanga oling.','Come back every day. Earn +1 to +7 coins through a seven-day streak.')),
   days,earned,claimButton,message,
   el('div',{class:'daily-reward-actions'},link(t('Tanga yig‘ish va tarix','Earn coins and history'),'/app/study-plan/rewards?view=earn'),link(t('Sovg‘alar','Gifts'),'/app/study-plan/rewards?view=gifts')),balance);
  async function claim() {
   if(!dialog||claimButton.disabled||signal.aborted||state.claimed)return;
   claimButton.disabled=true;message.hidden=true;
   try{
    const result=await client.request('/api/coins/daily/claim',{method:'POST',signal});
    if(signal.aborted||!dialog)return;
    if(!valid(result)||!result.claimed||result.date!==state.date)throw Error('invalid_daily_claim');
    state=result;markSeen(result.date);
    earned.textContent=t('Bugun +'+result.todayCoins+' tanga olindi.','Earned +'+result.todayCoins+' coins today.');
    claimButton.textContent=t('Olindi','Claimed');
    days.querySelectorAll('li').forEach((item,index)=>{
     item.classList.toggle('daily-reward-day--claimed',index<result.streak);
     item.querySelector('.daily-reward-day-state').textContent=index<result.streak?t('Olindi','Claimed'):t('Kutilmoqda','Upcoming');
    });
    if(Number.isSafeInteger(result.wallet?.balance)&&result.wallet.balance>=0){
     balance.hidden=false;balance.textContent=t('Balans: ','Balance: ')+result.wallet.balance.toLocaleString(uz?'uz-UZ':'en-GB');
    }
   }catch{
    if(!signal.aborted){claimButton.disabled=false;message.hidden=false;
     message.textContent=t('Tangani olish amalga oshmadi. Qayta urinib ko‘ring.','Unable to claim. Please retry.');}
   }
  }
  listen(claimButton,'click',()=>void claim(),signal);
  const dismiss=()=>{markSeen(state.date);remove();};
  listen(close,'click',dismiss,signal);
  listen(dialog,'cancel',event=>{event.preventDefault();dismiss();},signal);
  listen(dialog,'close',()=>{markSeen(state.date);remove();},signal);
  returnFocus=document.activeElement;
  document.body.append(dialog);
  try{
   if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
   claimButton.focus({preventScroll:true});
  }catch{remove();return;}
  const node=dialog;
  void client.request('/api/coins/wallet',{signal}).then(wallet=>{
   if(signal.aborted||dialog!==node||!Number.isSafeInteger(wallet?.balance)||wallet.balance<0)return;
   balance.hidden=false;balance.textContent=t('Balans: ','Balance: ')+wallet.balance.toLocaleString(uz?'uz-UZ':'en-GB');
  }).catch(()=>{});
 }
 async function check(){
  if(signal.aborted||document.visibilityState==='hidden')return;
  const day=localDay();
  if(pending||requested===day){show();return;}
  pending=true;requested=day;
  try{
   const result=await client.request('/api/coins/daily',{signal});
   if(signal.aborted)return;
   if(!valid(result))throw Error('invalid_daily_reward');
   if(state?.date!==result.date)remove();
   state=result;show();
  }catch{if(!signal.aborted)requested='';}
  finally{pending=false;}
 }
 const visible=()=>{if(document.visibilityState!=='hidden')void check();};
 listen(document,'visibilitychange',visible,signal);
 // Also handles a tab that stays visible across Tashkent midnight.
 const timer=setInterval(visible,60000);
 const observer=new document.defaultView.MutationObserver(()=>show());
 observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','aria-modal']});
 signal.addEventListener('abort',()=>{clearInterval(timer);observer.disconnect();remove();},{once:true});
 return {update(next,{ordinary=true}={}){context=next;eligible=ordinary;if(!ordinary)remove();queueMicrotask(()=>void check());}};
}
