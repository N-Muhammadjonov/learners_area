import {anySignal} from '../../js/signals.js';
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
 const buttonClass=['login','register'].includes(purpose)?'btn-secondary auth-telegram-pill':'btn-secondary';
 const unavailable=()=>el('div',{},el('button',{type:'button',disabled:true,class:buttonClass+' w-full opacity-50'},providerLabel),el('p',{class:'mt-1.5 text-xs text-ink-300'},t.telegramUnavailable));
 if(!auth.telegramConfigured||!auth.botUsername)return unavailable();
 if(!auth.telegramIntentEnabled){const target=el('div',{'aria-label':t.continueWithTelegram,'data-telegram-widget':''});const script=el('script',{src:'https://telegram.org/js/telegram-widget.js?22',async:true,'data-telegram-login':auth.botUsername,'data-size':'large','data-auth-url':'/api/auth/telegram/callback','data-request-access':'write',nonce:auth.nonce});listen(script,'error',()=>{if(!signal.aborted)target.replaceChildren(unavailable());},signal);target.append(script);signal.addEventListener('abort',()=>target.replaceChildren(),{once:true});return target;}
 const label=['link','replace'].includes(purpose)?t.telegramLink:purpose==='register'?t.continueWithTelegramRegister:t.continueWithTelegram;
 const holder=el('div',{class:'flex flex-col gap-2'}),button=el('button',{type:'button',class:buttonClass},label),errorNode=el('p',{role:'alert',class:'text-xs text-band-bad'});
 const nameInput=purpose==='register'&&!auth.passwordEnabled?el('input',{type:'text',name:'telegramFullName',autocomplete:'name',required:true,minlength:3,maxlength:200,pattern:'\\S+(?:\\s+\\S+)+',class:'input w-full','aria-label':t.name}):null;
 const nameField=nameInput?el('label',{class:'flex flex-col gap-1 text-sm'},t.name,nameInput):null;
 const genderInputs=nameInput?['male','female'].map(value=>el('input',{type:'radio',name:'telegramGender',value,required:true,class:'sr-only'})):[];
 const genderGroup=nameInput?el('div',{class:'gender-segments',role:'radiogroup','aria-label':t.chooseGender,'aria-required':'true'},...genderInputs.map(input=>el('label',{},input,el('span',{},input.value==='male'?t.genderMale:t.genderFemale)))):null;
 const genderField=genderGroup?el('fieldset',{},el('legend',{class:'mb-1.5 text-sm font-medium text-ink-700'},t.chooseGender),genderGroup):null;
 const genderErrorNode=el('p',{id:'telegram-gender-error',role:'alert',class:'mt-1 text-xs text-band-bad'},t.errorGenderRequired);
 let genderInvalid=false;
 for(const input of genderInputs)listen(input,'change',()=>{if(input.checked){genderInvalid=false;genderGroup.setAttribute('aria-invalid','false');genderGroup.removeAttribute('aria-describedby');genderErrorNode.remove();}},signal);
 let controller,pending,revision=0,waiting=false,link=null,error='';const now=context.now??Date.now,sleep=context.sleep??delay;
 const known={not_subscribed:t.telegramNotSubscribed,phone_required:t.telegramPhoneRequired,membership_unavailable:t.telegramMembershipUnavailable,full_name_required:t.telegramFullNameRequired,gender_required:t.errorGenderRequired,telegram_already_linked:t.telegramConflict,no_linked_account:t.telegramNoAccount,already_signed_in:t.telegramAlreadySignedIn,already_consumed:t.telegramExpired,expired:t.telegramExpired,intent_not_confirmed:t.telegramExpired};
 const callbackError=url.searchParams.get('error');if(callbackError?.startsWith('telegram_'))error=known[callbackError.slice(9)]??'';
 function paint(){if(signal.aborted)return;button.disabled=waiting;button.textContent=waiting?(purpose==='register'?t.telegramRegisterWaiting:t.telegramWaiting):label;holder.replaceChildren(...(nameField?[nameField,genderField]:[]),button);if(nameInput)nameInput.disabled=waiting;
  for(const input of genderInputs)input.disabled=waiting;
  if(genderGroup){genderGroup.setAttribute('aria-invalid',String(genderInvalid));if(genderInvalid){genderGroup.setAttribute('aria-describedby','telegram-gender-error');genderField.append(genderErrorNode);}else{genderGroup.removeAttribute('aria-describedby');genderErrorNode.remove();}}
  if(waiting){const cancel=el('button',{type:'button',class:'text-xs text-ink-400 hover:underline'},t.telegramCancel);listen(cancel,'click',cancelIntent,signal);holder.append(cancel);}
  if(link&&(waiting||error))holder.append(el('a',{href:link,target:'_blank',rel:'noopener noreferrer',class:'btn-secondary'},t.telegramOpen));
  if(error){errorNode.textContent=error;holder.append(errorNode);}
 }
 async function cancelIntent(){const version=++revision,current=pending;controller?.abort();pending=null;waiting=false;link=null;error='';paint();if(current)try{await api.request('/api/auth/telegram/intent/cancel',{method:'POST',body:current,signal});}catch(e){if(!signal.aborted&&version===revision){error=failure(e,dict,known);paint();}}}
 listen(button,'click',async()=>{if(signal.aborted||waiting)return;
 const registration=purpose==='register'?{name:(nameInput?.value??context.state?.authDraft?.name??context.root?.querySelector('#name')?.value??'').trim(),gender:genderGroup?genderInputs.find(input=>input.checked)?.value:context.state?.authDraft?.gender??context.root?.querySelector('input[name=gender]:checked')?.value}:{};
 if(nameInput)nameInput.value=registration.name;
 if(purpose==='register'&&(registration.name.length<3||registration.name.length>200||!/^\S+(?:\s+\S+)+$/.test(registration.name))){error=t.telegramFullNameRequired;paint();nameInput?.reportValidity();return;}
 if(purpose==='register'&&!['male','female'].includes(registration.gender)){genderInvalid=true;error=genderGroup?'':t.errorGenderRequired;paint();(genderInputs[0]??context.root?.querySelector('input[name=gender]'))?.focus();return;}
 ++revision;controller?.abort();controller=new AbortController();const flight=anySignal([signal,controller.signal]);waiting=true;error='';paint();
 try{
  const created=await api.request('/api/auth/telegram/intent',{method:'POST',body:{purpose},signal:flight});if(flight.aborted)return;
  if(!created||typeof created.token!=='string'||!created.token||typeof created.intentId!=='string'||!created.intentId||typeof created.browserNonce!=='string'||!created.browserNonce||created.purpose!==purpose||!/^[A-Za-z0-9_]{5,32}$/.test(created.botUsername??''))throw new ApiError(502,'invalid_response');
  const pair={intentId:created.intentId,browserNonce:created.browserNonce};pending=pair;link=`https://t.me/${created.botUsername}?start=${encodeURIComponent(created.token)}`;paint();window.open(link,'_blank','noopener,noreferrer');
  const deadline=now()+300000;
  while(!flight.aborted&&now()<deadline){
   await sleep(2000,flight);if(flight.aborted)return;let state;
   try{state=await api.request(`/api/auth/telegram/intent/status?id=${encodeURIComponent(created.intentId)}&nonce=${encodeURIComponent(created.browserNonce)}`,{signal:flight});}catch(e){if(flight.aborted)throw e;continue;}
   if(flight.aborted)return;if(!state||typeof state.status!=='string'||typeof state.expired!=='boolean')throw new ApiError(502,'invalid_response');
   if(state.status==='cancelled'){waiting=false;link=null;paint();return;}if(state.expired||state.status==='expired')throw {code:'expired'};
   if(state.gateError){error=known[state.gateError]??t.telegramMembershipUnavailable;paint();await sleep(3000,flight);continue;}
   if(error){error='';paint();}if(state.status!=='confirmed')continue;
   const data=accountResult(await api.request('/api/auth/telegram/intent/exchange',{method:'POST',body:{...pair,...registration},signal:flight}),'login');if(flight.aborted)return;pending=null;
   if(['link','replace'].includes(purpose)){waiting=false;link=null;paint();}else if(data.outcome==='suspended'||data.accountStatus==='suspended')error=t.telegramSuspended;else if(purpose==='register'&&data.outcome==='already_pending')error=t.telegramAlreadyPending;else if(purpose==='register'&&['pending','reopened'].includes(data.outcome))error=t.telegramRegisterPending;else if(purpose==='register'&&data.outcome==='already_active')error=t.telegramAlreadyActive;paint();
   const destination=['link','replace'].includes(purpose)?'/app/profile':data.outcome==='suspended'||data.accountStatus==='suspended'?'/pending':purpose==='register'&&(['pending','reopened','already_pending'].includes(data.outcome)||data.accountStatus!=='active')?'/pending':safeNextPath(url.searchParams.get('next'))??(data.onboarded?'/app':'/onboarding');
   publishSessionEvent('refresh');context.invalidateSession?.();await navigate(destination);return;
  }
  if(!flight.aborted)throw {code:'expired'};
 }catch(e){if(!flight.aborted){waiting=false;if(e?.code==='expired'||e?.code==='intent_not_confirmed')link=null;error=failure(e,dict,known);paint();}}
 },signal);
 signal.addEventListener('abort',()=>{revision++;controller?.abort();pending=null;link=null;if(nameInput)nameInput.value='';for(const input of genderInputs)input.checked=false;holder.replaceChildren();},{once:true});paint();return holder;
}

