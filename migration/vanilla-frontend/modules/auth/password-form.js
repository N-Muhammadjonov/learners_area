import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {accountResult,accountDiagnostic} from '../../js/adapters/account.js';
import {failure} from '../../js/request-errors.js';
import {safeNextPath} from '../../js/safe-next.js';
import {accountMutation} from '../../js/mutation-lifetime.js';
import {FieldError} from '../shared/inputs.js';
/** Stable native form nodes: errors/pending never remount fields or providers.
 * Drafts survive same-route preference refresh only, in router-owned memory.
 * They are never written to history, storage, a URL or any shared cache. */
export async function passwordForm(context,auth,telegram){
 const {dict,url,signal,navigate}=context,path=url.pathname,register=path==='/register',reset=path.startsWith('/reset-password'),confirm=path.endsWith('/confirm');
 const kind=register?'RegisterForm':reset?confirm?'ResetConfirmForm':'ResetRequestForm':'LoginForm';
 const view=await import(`../../js/generated/${kind}.js`),host=el('div',{'data-auth-form':kind}),token=url.searchParams.get('token')??'',firstGender={current:null};
 if(signal.aborted)return host;
 const state=context.state??{},draft=state.authDraft??={email:'',password:'',name:'',gender:'',done:false,devUrl:null};
 const known={invalid_credentials:dict.auth.errorInvalidCredentials,email_taken:dict.auth.errorEmailTaken,invalid_input:dict.errors.unknown,invalid_token:dict.errors.unknown,invalid_or_expired_token:dict.errors.unknown,reset_unavailable:dict.auth.resetUnavailable};
 let genderError=draft.genderError??false,error='',pending=false,errorNode;
 if(!reset){const key={google_unavailable:'googleUnavailable',google_state:'googleFailed',google_failed:'googleFailed',google_unverified:'googleUnverified',google_link_required:'googleLinkRequired'}[url.searchParams.get('error')];if(key)error=dict.auth[key];}
 if(reset&&!confirm&&draft.done){host.append(view.done({dict,devUrl:draft.devUrl}));return host;}
 if(draft.failure)error=failure(draft.failure,dict,known);
 const setGenderError=next=>{genderError=next;draft.genderError=next;const group=host.querySelector('[role=radiogroup]');group?.setAttribute('aria-invalid',String(next));host.querySelectorAll('input[name=gender]').forEach(n=>next?n.setAttribute('aria-describedby','gender-error'):n.removeAttribute('aria-describedby'));if(next){group?.setAttribute('aria-describedby','gender-error');if(!host.querySelector('#gender-error'))group?.after(el('p',{id:'gender-error',role:'alert',class:'mt-1 text-xs text-band-bad'},dict.auth.errorGenderRequired));}else{group?.removeAttribute('aria-describedby');host.querySelector('#gender-error')?.remove();}};
 const form=view.render({dict,...draft,setEmail:v=>draft.email=v,setPassword:v=>draft.password=v,setName:v=>draft.name=v,setGender:v=>draft.gender=v,genderError,setGenderError,firstGender,error:'',pending,onSubmit,recovery:context.recovery===true,googleConfigured:auth.googleConfigured,telegram,token});
 host.append(form);firstGender.current=host.querySelector('input[value=male]');const button=form.querySelector('button[type=submit]'),label=button.textContent,anchor=document.createComment('native-auth-error');
 if(reset&&!confirm)button.after(anchor);else button.before(anchor);
 function paint(){if(signal.aborted)return;button.disabled=pending||reset&&confirm&&!token;button.textContent=pending?dict.common.loading:label;form.setAttribute('aria-busy',String(pending));errorNode?.remove();errorNode=error?(reset&&!confirm?el('p',{role:'alert',class:'text-sm text-band-bad'},error):FieldError({children:[error]})):null;if(errorNode)anchor.before(errorNode);}
 async function onSubmit(e){
  e.preventDefault();if(signal.aborted||pending||reset&&confirm&&!token||!form.checkValidity())return;
  if(register&&!draft.gender){setGenderError(true);firstGender.current?.focus();return;}
  pending=true;error='';delete draft.failure;paint();const settle=accountMutation(state);
  const body=register?{name:draft.name,email:draft.email,password:draft.password,gender:draft.gender}:reset?confirm?{token,password:draft.password}:{email:draft.email}:{email:draft.email,password:draft.password};
  try{
   const endpoint=register?'/api/auth/register':reset?confirm?'/api/auth/reset/confirm':'/api/auth/reset/request':context.recovery?'/api/auth/recovery/login':'/api/auth/login';
   const result=accountResult(await api.request(endpoint,{method:'POST',body,signal}),register?'register':reset?'reset':'login');if(signal.aborted)return;
   if(reset&&!confirm){draft.done=true;draft.devUrl=safeNextPath(result.devResetUrl);host.replaceChildren(view.done({dict,devUrl:draft.devUrl}));host.querySelector('a')?.focus();return;}
   context.invalidateSession?.();
   await navigate(register?'/pending':reset?'/login':result.accountStatus&&result.accountStatus!=='active'?'/pending':safeNextPath(url.searchParams.get('next'))??(result.onboarded?'/app':'/onboarding'));
  }catch(e){if(!signal.aborted&&auth.diagnostics&&!register&&!reset)console.info('[qa-auth] '+JSON.stringify(accountDiagnostic(e)));if(!signal.aborted){draft.failure={status:e?.status,code:Object.hasOwn(known,e?.code)||e?.code==='invalid_response'?e.code:undefined,name:e?.name==='TimeoutError'?'TimeoutError':undefined};error=failure(draft.failure,dict,known);}}
  finally{pending=false;paint();settle();}
 }
 signal.addEventListener('abort',()=>{if(signal.reason!=='route-refresh'||state.authDraft!==draft){for(const input of host.querySelectorAll('input'))input.value='';draft.email='';draft.password='';draft.name='';draft.gender='';}}, {once:true});
 paint();return host;
}
