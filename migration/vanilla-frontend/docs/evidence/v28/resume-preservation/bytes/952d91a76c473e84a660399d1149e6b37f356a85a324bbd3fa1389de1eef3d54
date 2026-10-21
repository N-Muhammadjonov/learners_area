import {el} from '../../js/dom.js';
let nextId=0;
/** Native lifecycle of source ConfirmAction. Modal appearance uses original CSS. */
export function confirmAction({signal,...p}) {
 const id=`native-confirm-${++nextId}`;
 const trigger=el('button',{type:'button',role:p.triggerRole,class:p.triggerClassName,disabled:p.triggerDisabled,'aria-haspopup':'dialog','aria-expanded':'false','data-interaction-type':'destructive'},p.trigger);
 const dialog=el('dialog',{class:'interaction-confirm-dialog','aria-labelledby':id+'-title','aria-describedby':id+'-description'});
 const failure=el('p',{role:'alert'},p.failureMessage),cancel=el('button',{type:'button'},p.cancelLabel),confirm=el('button',{type:'button',class:'btn-primary','data-confirm-action':'','data-interaction-type':'mutation'},p.confirmLabel);
 dialog.append(el('h2',{id:id+'-title'},p.title),el('p',{id:id+'-description'},p.description),el('div',{class:'interaction-confirm-dialog__actions'},cancel,confirm));
 const node=el('span',{'data-native-confirm':'',style:{display:'contents'}},trigger,dialog);let pending=false,disposed=false,opened=false;
 function close(restore=true){if(pending||disposed)return;opened=false;trigger.setAttribute('aria-expanded','false');if(dialog.open)dialog.close();if(restore&&trigger.isConnected)trigger.focus();}
 function open(){if(disposed||pending||signal?.aborted)return;failure.remove();opened=true;trigger.setAttribute('aria-expanded','true');if(!dialog.open)dialog.showModal();confirm.focus();}
 async function execute(){if(pending||disposed||!opened)return;pending=true;failure.remove();cancel.disabled=true;confirm.disabled=true;confirm.setAttribute('aria-busy','true');confirm.textContent=p.pendingLabel||p.confirmLabel;
  try{await p.onConfirm();if(!disposed&&!signal?.aborted){pending=false;close();}}
  catch{if(!disposed&&!signal?.aborted)dialog.insertBefore(failure,dialog.lastChild);}
  finally{pending=false;if(!disposed){cancel.disabled=false;confirm.disabled=false;confirm.removeAttribute('aria-busy');confirm.textContent=p.confirmLabel;}}
 }
 const onCancel=e=>{e.preventDefault();close();},onClose=()=>{if(opened&&!pending&&!dialog.open)close();};
 trigger.addEventListener('click',open);cancel.addEventListener('click',()=>close());confirm.addEventListener('click',()=>void execute());dialog.addEventListener('cancel',onCancel);dialog.addEventListener('close',onClose);
 function dispose(){if(disposed)return;disposed=true;if(dialog.open)dialog.close();dialog.remove();signal?.removeEventListener('abort',dispose);}
 signal?.addEventListener('abort',dispose,{once:true});if(signal?.aborted)dispose();
 return {node,trigger,dialog,open,close,dispose,get pending(){return pending;}};
}
export function logoutControl(context,{label,triggerClassName='btn-ghost',triggerRole}={}) {
 const {dict}=context;
 return confirmAction({signal:context.signal,trigger:label??dict.nav.logout,triggerRole,triggerClassName,title:dict.auth.signOutConfirmTitle,description:dict.auth.signOutConfirmBody,confirmLabel:dict.auth.signOut,cancelLabel:dict.common.cancel,pendingLabel:dict.loadingPage.label,failureMessage:dict.auth.errorServer,onConfirm:async()=>{const {logoutSession}=await import('../../js/authority.js');await logoutSession(context);}}).node;
}
