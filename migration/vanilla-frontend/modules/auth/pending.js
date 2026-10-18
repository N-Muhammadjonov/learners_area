import {logoutControl} from '../shared/confirm-action.js';
import {el,listen} from '../../js/dom.js';
import {authShell} from '../../js/components/auth-shell.js';
import {api} from '../../js/api-client.js';
import {failure} from '../../js/request-errors.js';
export function renderPending(context,{openRequest}){
 const {dict,session,signal,refresh}=context,t=dict.admission,user=session.user,status=user.accountStatus;
 const body=el('div',{class:'flex flex-col gap-4'},el('p',{class:'rounded-sm bg-paper-sunken p-3 text-xs leading-relaxed text-ink-500'},t.explainer),el('div',{class:'flex items-center justify-between rounded-sm border border-ink-100 px-3 py-2'},el('span',{class:'text-sm text-ink-700'},t.statusPending),el('span',{'data-account-status':status,class:status==='pending'?'badge bg-band-warn/10 text-band-warn':'badge bg-band-bad/10 text-band-bad'},status==='pending'?t.statusPending:status==='suspended'?t.statusSuspended:t.statusRejected)));
 if(openRequest)body.append(el('p',{class:'text-sm text-ink-500'},t.requestOpen));else if(['pending','rejected'].includes(status)){
 const holder=el('div',{class:'flex flex-col gap-2'}),message=el('textarea',{id:'access-message',class:'input min-h-[160px] resize-y font-sans leading-relaxed min-h-[90px]',placeholder:t.messagePlaceholder}),button=el('button',{type:'button',class:'btn-primary'},t.requestButton),error=el('p',{role:'alert',class:'text-xs text-band-bad'});
 holder.append(el('label',{for:'access-message',class:'mb-1.5 block text-sm font-medium text-ink-700'},t.messageLabel),message,el('p',{class:'text-xs text-ink-300'},t.contactHint),error,button);
 listen(button,'click',async()=>{if(button.disabled)return;button.disabled=true;message.disabled=true;error.textContent='';button.textContent=dict.common.saving;try{await api.request('/api/admission/request',{method:'POST',body:{message:message.value.trim()||undefined},signal});if(!signal.aborted){holder.replaceChildren(el('p',{class:'text-sm text-band-good'},t.requestSent));await refresh();}}catch(e){if(!signal.aborted)error.textContent=failure(e,dict);}finally{button.disabled=false;message.disabled=false;button.textContent=t.requestButton;}},signal);body.append(holder);}
 body.append(el('a',{href:'/',class:'btn-secondary'},dict.common.backToSite));
 const logout=logoutControl(context,{label:t.signOut});
 return authShell(context,{title:status==='suspended'?t.suspendedTitle:status==='rejected'?t.rejectedTitle:t.title,subtitle:status==='suspended'?t.suspendedBody:status==='rejected'?t.rejectedBody:t.subtitle,children:body,footer:el('div',{class:'flex items-center justify-center gap-3'},el('span',{},user.name),logout)});
}
