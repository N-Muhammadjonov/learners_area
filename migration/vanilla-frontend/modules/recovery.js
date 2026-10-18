import {el,listen} from '../js/dom.js';
import {dictionary,readPreferences} from '../js/preferences.js';
import {authShell} from '../js/components/auth-shell.js';
import {api} from '../js/api-client.js';
import {safeNextPath} from '../js/safe-next.js';
export async function mount(context){
 const {root,signal,url,navigate}=context;const {locale}=readPreferences();const dict=await dictionary(locale);
 const form=el('form',{class:'flex flex-col gap-4'});const inputs={};
 for(const [name,type] of [['email','email'],['password','password']]){inputs[name]=el('input',{id:name,name,type,required:true,class:'input'});form.append(el('div',{},el('label',{for:name,class:'mb-1.5 block text-sm font-medium text-ink-700'},dict.auth[name]),inputs[name]));}
 const error=el('p',{role:'alert',class:'mt-1 text-xs text-band-bad'}),button=el('button',{type:'submit',class:'btn-primary'},dict.auth.loginCta);form.append(error,button);
 listen(form,'submit',async e=>{e.preventDefault();if(button.disabled)return;button.disabled=true;button.textContent=dict.common.loading;error.textContent='';
 try{const data=await api.request('/api/auth/recovery/login',{method:'POST',body:{email:inputs.email.value,password:inputs.password.value},signal});if(signal.aborted)return;
 if(!data||typeof data!=='object')throw Error('invalid_response');
 await navigate(data.accountStatus&&data.accountStatus!=='active'?'/pending':safeNextPath(url.searchParams.get('next'))??(data.onboarded?'/app':'/onboarding'));
 }catch(e){if(!signal.aborted)error.textContent=e.code==='invalid_credentials'?dict.auth.errorInvalidCredentials:dict.auth.errorNetwork;}finally{button.disabled=false;button.textContent=dict.auth.loginCta;}
 },signal);
 root.append(authShell({...context,dict,locale},{title:dict.auth.loginTitle,children:form}));
}
