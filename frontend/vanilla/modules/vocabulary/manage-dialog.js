import {h} from './shared.js';
import {vocabularyCopy} from './copy.js';
let serial=0;
/** A mutation only starts after this modal's explicit confirmation. */
export function openVocabularyDialog(ctx,{title,description='',value=null,confirmLabel,onConfirm}){
 const t=vocabularyCopy(ctx),id='vocabulary-dialog-'+(++serial),focus=document.activeElement,life=new window.AbortController();let pending=false;
 const dialog=h('dialog',{class:'interaction-confirm-dialog vocabulary-action-dialog','data-vocabulary-dialog':'','aria-labelledby':id+'-title','aria-describedby':id+'-description'}),form=h('form'),error=h('p',{role:'alert',hidden:true}),input=value===null?null:h('input',{class:'input',value,maxLength:80,required:true,'aria-label':t.name,'data-folder-rename-input':''}),cancel=h('button',{type:'button',class:'btn-secondary'},t.cancel),confirm=h('button',{type:'submit',class:'btn-primary','data-vocabulary-confirm':''},confirmLabel??t.save);
 form.append(h('h2',{id:id+'-title',class:'font-display text-xl'},title),h('p',{id:id+'-description'},description));if(input)form.append(h('label',{class:'flex flex-col gap-2'},t.name,input));form.append(error,h('div',{class:'interaction-confirm-dialog__actions'},cancel,confirm));dialog.append(form);
 function stop(){life.abort();if(dialog.open)dialog.close();dialog.remove();ctx.signal.removeEventListener('abort',stop);if(focus?.isConnected)focus.focus();}
 function close(){if(!pending)stop();}
 cancel.addEventListener('click',close,{signal:life.signal});dialog.addEventListener('cancel',e=>{e.preventDefault();close();},{signal:life.signal});
 form.addEventListener('submit',async e=>{e.preventDefault();if(pending||input&&!input.value.trim())return;pending=true;error.hidden=true;cancel.disabled=confirm.disabled=true;if(input)input.disabled=true;confirm.setAttribute('aria-busy','true');try{await onConfirm(input?.value.trim());if(!ctx.signal.aborted){pending=false;stop();}}catch(e){if(!ctx.signal.aborted){error.textContent=e?.code==='folder_exists'?t.duplicate:e?.code==='vocabulary_not_found'?t.wordsMissing:ctx.dict.errors.unknown;error.hidden=false;}}finally{pending=false;cancel.disabled=confirm.disabled=false;if(input)input.disabled=false;confirm.removeAttribute('aria-busy');}},{signal:life.signal});
 ctx.signal.addEventListener('abort',stop,{once:true});if(ctx.signal.aborted)return {close:stop};document.body.append(dialog);dialog.showModal();(input??cancel).focus();return {close:stop};
}
