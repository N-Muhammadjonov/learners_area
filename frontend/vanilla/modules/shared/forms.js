import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {accountResult} from '../../js/adapters/account.js';
import {failure} from '../../js/request-errors.js';
export function field(label,name,attrs={}){const input=el('input',{id:name,name,class:'input',...attrs});return {input,node:el('div',{},el('label',{for:name,class:'mb-1.5 block text-sm font-medium text-ink-700'},label),input)};}
export function formSubmit({form,button,error,dict,signal,endpoint,body,success,known={},validate=()=>true}){
 let busy=false;const text=button.textContent;
 listen(form,'submit',async e=>{e.preventDefault();if(signal.aborted||busy||!form.checkValidity()||!validate())return;busy=true;button.disabled=true;button.textContent=dict.common.loading;error.textContent='';error.hidden=true;form.setAttribute('aria-busy','true');try{const result=await api.request(endpoint,{method:'POST',body:body(),signal});if(!signal.aborted)await success(accountResult(result,'mutation'));}catch(e){if(!signal.aborted){error.textContent=failure(e,dict,known);error.hidden=false;}}finally{busy=false;button.disabled=false;button.textContent=text;form.setAttribute('aria-busy','false');}},signal);
}
export function errorNode(){return el('p',{role:'alert',hidden:true,class:'mt-1 text-xs text-band-bad'});}
