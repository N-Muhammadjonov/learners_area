import {publishSessionEvent} from '../../js/session-events.js';
import {el,listen} from '../../js/dom.js';
import {accountResult} from '../../js/adapters/account.js';
import {api,ApiError} from '../../js/api-client.js';
import {failure} from '../../js/request-errors.js';
import {safeNextPath} from '../../js/safe-next.js';
function delay(ms,signal){return new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));};const t=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});}
export function telegram(context,auth,purpose){
 const {dict,signal,navigate,url}=context,t=dict.auth;
 if(signal.aborted)return el('div');
 const providerLabel=purpose==='register'&&auth.telegramIntentEnabled?t.continueWithTelegramRegister:t.continueWithTelegram;
 const unavailable=()=>el('div',{},el('button',{type:'button',disabled:true,class:'btn-secondary w-full opacity-50'},providerLabel),el('p',{class:'mt-1.5 text-xs text-ink-300'},t.telegramUnavailable));
 if(!auth.telegramConfigured||!auth.botUsername)return unavailable();
 if(!auth.telegramIntentEnabled){const target=el('div',{'aria-label':t.continueWithTelegram,'data-telegram-widget':''});const script=el('script',{src:'https://telegram.org/js/telegram-widget.js?22',async:true,'data-telegram-login':auth.botUsername,'data-size':'large','data-auth-url':'/api/auth/telegram/callback','data-request-access':'write',nonce:auth.nonce});listen(script,'error',()=>{if(!signal.aborted)target.replaceChildren(unavailable());},signal);target.append(script);signal.addEventListener('abort',()=>target.replaceChildren(),{once:true});return target;}
 const label=purpose==='link'?t.telegramLink:purpose==='register'?t.continueWithTelegramRegister:t.continueWithTelegram;
 const holder=el('div',{class:'flex flex-col gap-2'}),button=el('button',{type:'button',class:'btn-secondary'},label),errorNode=el('p',{role:'alert',class:'text-xs text-band-bad'});
 let controller,pending,revision=0,waiting=false,link=null,error='';const now=context.now??Date.now,sleep=context.sleep??delay;
 const known={telegram_already_linked:t.telegramConflict,no_linked_account:t.telegramNoAccount,already_signed_in:t.telegramAlreadySignedIn,already_consumed:t.telegramExpired,expired:t.telegramExpired,intent_not_confirmed:t.telegramExpired};
 function paint(){if(signal.aborted)return;button.disabled=waiting;button.textContent=waiting?(purpose==='register'?t.telegramRegisterWaiting:t.telegramWaiting):label;holder.replaceChildren(button);
  if(link)holder.append(el('a',{class:'text-center text-sm text-signal-600 hover:underline',href:link,target:'_blank',rel:'noopener noreferrer'},t.telegramOpen));
  if(waiting){const cancel=el('button',{type:'button',class:'text-xs text-ink-400 hover:underline'},t.telegramCancel);listen(cancel,'click',cancelIntent,signal);holder.append(cancel);}
  if(error){errorNode.textContent=error;holder.append(errorNode);}
 }
 async function cancelIntent(){const version=++revision,current=pending;controller?.abort();pending=null;waiting=false;link=null;error='';paint();if(current)try{await api.request('/api/auth/telegram/intent/cancel',{method:'POST',body:current,signal});}catch(e){if(!signal.aborted&&version===revision){error=failure(e,dict,known);paint();}}}
 listen(button,'click',async()=>{if(signal.aborted||waiting)return;++revision;controller?.abort();controller=new AbortController();const flight=AbortSignal.any([signal,controller.signal]);waiting=true;error='';paint();
 try{
  const created=await api.request('/api/auth/telegram/intent',{method:'POST',body:{purpose},signal:flight});if(flight.aborted)return;
  if(!created||typeof created.token!=='string'||!created.token||typeof created.intentId!=='string'||!created.intentId||typeof created.browserNonce!=='string'||!created.browserNonce||created.purpose!==purpose||!/^[A-Za-z0-9_]{5,32}$/.test(created.botUsername??''))throw new ApiError(502,'invalid_response');
  const pair={intentId:created.intentId,browserNonce:created.browserNonce};pending=pair;link=`https://t.me/${created.botUsername}?start=${encodeURIComponent(created.token)}`;paint();window.open(link,'_blank','noopener,noreferrer');
  const deadline=now()+300000;
  while(!flight.aborted&&now()<deadline){
   await sleep(2000,flight);if(flight.aborted)return;let state;
   try{state=await api.request(`/api/auth/telegram/intent/status?id=${encodeURIComponent(created.intentId)}&nonce=${encodeURIComponent(created.browserNonce)}`,{signal:flight});}catch(e){if(flight.aborted)throw e;continue;}
   if(flight.aborted)return;if(!state||typeof state.status!=='string'||typeof state.expired!=='boolean')throw new ApiError(502,'invalid_response');
   if(state.status==='cancelled'){waiting=false;paint();return;}if(state.expired||state.status==='expired')throw {code:'expired'};if(state.status!=='confirmed')continue;
   const data=accountResult(await api.request('/api/auth/telegram/intent/exchange',{method:'POST',body:pair,signal:flight}),'login');if(flight.aborted)return;pending=null;
   if(purpose==='link'){waiting=false;link=null;paint();}else if(data.outcome==='suspended'||data.accountStatus==='suspended')error=t.telegramSuspended;else if(purpose==='register'&&data.outcome==='already_pending')error=t.telegramAlreadyPending;else if(purpose==='register'&&['pending','reopened'].includes(data.outcome))error=t.telegramRegisterPending;else if(purpose==='register'&&data.outcome==='already_active')error=t.telegramAlreadyActive;paint();
   const destination=purpose==='link'?'/app/profile':data.outcome==='suspended'||data.accountStatus==='suspended'?'/pending':purpose==='register'&&(['pending','reopened','already_pending'].includes(data.outcome)||data.accountStatus!=='active')?'/pending':safeNextPath(url.searchParams.get('next'))??(data.onboarded?'/app':'/onboarding');
   publishSessionEvent('refresh');context.invalidateSession?.();await navigate(destination);return;
  }
  if(!flight.aborted)throw {code:'expired'};
 }catch(e){if(!flight.aborted){waiting=false;error=failure(e,dict,known);paint();}}
 },signal);
 signal.addEventListener('abort',()=>{revision++;controller?.abort();pending=null;link=null;holder.replaceChildren();},{once:true});paint();return holder;
}
