import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {failure} from '../../js/request-errors.js';
import {safeNextPath} from '../../js/safe-next.js';
function delay(ms,signal){return new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));};const t=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});}
export function telegram(context,auth,purpose){
 const {dict,signal,navigate,url}=context,t=dict.auth;
 if(!auth.telegramConfigured||!auth.botUsername)return el('div',{},el('button',{type:'button',disabled:true,class:'btn-secondary w-full opacity-50'},purpose==='register'?t.continueWithTelegramRegister:t.continueWithTelegram),el('p',{class:'mt-1.5 text-xs text-ink-300'},t.telegramUnavailable));
 if(!auth.telegramIntentEnabled){const target=el('div',{'aria-label':t.continueWithTelegram,'data-telegram-widget':''});const script=el('script',{src:'https://telegram.org/js/telegram-widget.js?22',async:true,'data-telegram-login':auth.botUsername,'data-size':'large','data-auth-url':'/api/auth/telegram/callback','data-request-access':'write',nonce:auth.nonce});target.append(script);signal.addEventListener('abort',()=>target.replaceChildren(),{once:true});return target;}
 const label=purpose==='link'?t.telegramLink:purpose==='register'?t.continueWithTelegramRegister:t.continueWithTelegram;
 const holder=el('div',{class:'flex flex-col gap-2'}),button=el('button',{type:'button',class:'btn-secondary'},label),error=el('p',{role:'alert',class:'text-xs text-band-bad'});let controller,pending;
 const known={telegram_already_linked:t.telegramConflict,no_linked_account:t.telegramNoAccount,already_signed_in:t.telegramAlreadySignedIn,already_consumed:t.telegramExpired,expired:t.telegramExpired,intent_not_confirmed:t.telegramExpired};
 const restore=()=>{button.disabled=false;button.textContent=label;holder.replaceChildren(button,error);};
 listen(button,'click',async()=>{if(button.disabled)return;controller?.abort();controller=new AbortController();const flight=AbortSignal.any([signal,controller.signal]);button.disabled=true;button.textContent=purpose==='register'?t.telegramRegisterWaiting:t.telegramWaiting;error.textContent='';
 try{const created=await api.request('/api/auth/telegram/intent',{method:'POST',body:{purpose},signal:flight});if(flight.aborted)return;if(typeof created.token!=='string'||!created.token||typeof created.intentId!=='string'||!created.intentId||typeof created.browserNonce!=='string'||!created.browserNonce||created.purpose!==purpose||!/^[A-Za-z0-9_]{5,32}$/.test(created.botUsername??''))throw Error('invalid_intent');const pair={intentId:created.intentId,browserNonce:created.browserNonce};pending=pair;const link=`https://t.me/${created.botUsername}?start=${encodeURIComponent(created.token)}`;
 const open=el('a',{class:'text-center text-sm text-signal-600 hover:underline',href:link,target:'_blank',rel:'noopener noreferrer'},t.telegramOpen),cancel=el('button',{type:'button',class:'text-xs text-ink-400 hover:underline'},t.telegramCancel);holder.insertBefore(open,error);holder.insertBefore(cancel,error);window.open(link,'_blank','noopener,noreferrer');
 listen(cancel,'click',async()=>{controller.abort();const current=pending;pending=null;restore();if(current)try{await api.request('/api/auth/telegram/intent/cancel',{method:'POST',body:current,signal});}catch(e){if(!signal.aborted&&!pending)error.textContent=failure(e,dict,known);}},signal);
 const deadline=Date.now()+300000;
 while(!flight.aborted&&Date.now()<deadline){await delay(2000,flight);let state;try{state=await api.request(`/api/auth/telegram/intent/status?id=${encodeURIComponent(created.intentId)}&nonce=${encodeURIComponent(created.browserNonce)}`,{signal:flight});}catch(e){if(flight.aborted)throw e;continue;}
 if(flight.aborted)return;if(state.status==='cancelled'){restore();return;}if(state.expired||state.status==='expired')throw {code:'expired'};if(state.status!=='confirmed')continue;
 const data=await api.request('/api/auth/telegram/intent/exchange',{method:'POST',body:pair,signal:flight});if(flight.aborted)return;pending=null;
 const destination=purpose==='link'?'/app/profile':data.outcome==='suspended'||data.accountStatus==='suspended'?'/pending':purpose==='register'&&(['pending','reopened','already_pending'].includes(data.outcome)||data.accountStatus!=='active')?'/pending':safeNextPath(url.searchParams.get('next'))??(data.onboarded?'/app':'/onboarding');
 await navigate(destination);return;
 }if(!flight.aborted)throw {code:'expired'};
 }catch(e){if(!flight.aborted){restore();error.textContent=failure(e,dict,known);}}
 },signal);
 signal.addEventListener('abort',()=>{controller?.abort();pending=null;},{once:true});holder.append(button,error);return holder;
}
