import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {failure} from '../../js/request-errors.js';
export function field(label,name,attrs={}){const input=el('input',{id:name,name,class:'input',...attrs});return {input,node:el('div',{},el('label',{for:name,class:'mb-1.5 block text-sm font-medium text-ink-700'},label),input)};}
export function formSubmit({form,button,error,dict,signal,endpoint,body,success,known={},validate=()=>true}){
 let busy=false;const text=button.textContent;
 listen(form,'submit',async e=>{e.preventDefault();if(busy||!validate())return;busy=true;button.disabled=true;button.textContent=dict.common.loading;error.textContent='';try{const result=await api.request(endpoint,{method:'POST',body:body(),signal});if(!signal.aborted)await success(result);}catch(e){if(!signal.aborted)error.textContent=failure(e,dict,known);}finally{busy=false;button.disabled=false;button.textContent=text;}},signal);
}
export function errorNode(){return el('p',{role:'alert',class:'mt-1 text-xs text-band-bad'});}
