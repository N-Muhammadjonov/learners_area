import {beginActionMeasurement} from '../../js/diagnostics.js';
import {el,listen} from '../../js/dom.js';
let sequence=0;
/** Presentation changes only after onConfirm acknowledges. Caller owns server validation. */
export function confirmSelect({signal,value,options,ariaLabel,className,disabled=false,...p}){const id='native-select-'+(++sequence);let confirmed=value,requested=null,pending=false,disposed=false,revision=0;
 const select=el('select',{class:className,'aria-label':ariaLabel,'data-interaction-type':'destructive',disabled},options.map(o=>el('option',{value:o.value},o.label))),dialog=el('dialog',{class:'interaction-confirm-dialog','aria-labelledby':id+'-title','aria-describedby':id+'-description'}),requestedLabel=el('p'),failure=el('p',{role:'alert'},p.failureMessage),cancel=el('button',{type:'button'},p.cancelLabel),confirm=el('button',{type:'button',class:'btn-primary','data-confirm-action':'','data-interaction-type':'mutation'},p.confirmLabel),node=el('span',{style:{display:'contents'}},select,dialog);
 select.value=confirmed;dialog.append(el('h2',{id:id+'-title'},p.title),el('p',{id:id+'-description'},p.description),requestedLabel,el('div',{class:'interaction-confirm-dialog__actions'},cancel,confirm));
 function sync(){select.disabled=disabled||pending;cancel.disabled=confirm.disabled=pending;select.setAttribute('aria-busy',String(pending));confirm.setAttribute('aria-busy',String(pending));confirm.textContent=pending?p.pendingLabel:p.confirmLabel;}
 function close(){if(disposed||pending)return;requested=null;if(dialog.open)dialog.close();if(select.isConnected)select.focus();}
 listen(select,'change',()=>{if(disposed||pending||select.disabled)return;const next=select.value;select.value=confirmed;if(next===confirmed||!options.some(o=>o.value===next))return;requested=next;failure.remove();requestedLabel.textContent=options.find(o=>o.value===next).label;if(!dialog.open)dialog.showModal();confirm.focus();},signal);
 listen(cancel,'click',close,signal);listen(dialog,'cancel',e=>{e.preventDefault();close();},signal);listen(dialog,'close',()=>{if(!dialog.open&&!pending&&!disposed&&requested!==null)close();},signal);
 listen(confirm,'click',async()=>{if(disposed||pending||!requested||!dialog.open)return;const target=requested,generation=revision;pending=true;failure.remove();sync();const complete=beginActionMeasurement('destructive',signal);try{await p.onConfirm(target);complete('success');if(disposed||signal?.aborted)return;if(generation===revision){confirmed=target;select.value=confirmed;}pending=false;close();}catch{complete('failure');if(!disposed&&!signal?.aborted&&generation===revision)dialog.insertBefore(failure,dialog.lastChild);}finally{pending=false;if(!disposed)sync();}},signal);
 function update(next){if(disposed||!options.some(o=>o.value===next))return;revision++;confirmed=next;select.value=next;if(!pending)close();}
 function dispose(){if(disposed)return;disposed=true;if(dialog.open)dialog.close();dialog.remove();signal?.removeEventListener('abort',dispose);}
 if(signal?.aborted)dispose();else signal?.addEventListener('abort',dispose,{once:true});return {node,select,dialog,update,dispose};
}
