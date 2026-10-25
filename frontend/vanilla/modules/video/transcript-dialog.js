import {el} from '../../js/dom.js';
import {clickableText} from '../vocabulary/clickable-text.js';

/** Original VideoTranscriptDialog.tsx: a native modal with a lookup-enabled transcript. Closes on Escape, the Close
 * button or a backdrop click. Removed from the DOM on close and on route teardown. */
let styled=false;
function ensureStyles(){
 if(styled||document.querySelector('link[data-video-css]'))return;
 styled=true;
 const link=document.createElement('link');
 link.rel='stylesheet';link.href='/modules/video/video.css';link.setAttribute('data-video-css','');
 document.head.append(link);
}

export function openTranscriptDialog({context,id,text,dict,attribution,onClose}){
 ensureStyles();
 const t=dict.videoLesson;
 let done=false;
 const body=clickableText(context,{text,sourceType:'video',sourceId:id,className:'mt-5 text-base leading-8',catalogueLookup:true,phraseAware:true});
 const close=el('button',{type:'button',class:'btn-secondary'},dict.globalDictionary.close);
 const dialog=el('dialog',{class:'video-transcript-dialog','aria-labelledby':'video-transcript-heading'},
  el('header',{class:'flex items-center justify-between gap-4'},el('h2',{id:'video-transcript-heading',class:'text-xl font-semibold'},t.tabs.transcript),close),
  body.node,attribution?el('p',{class:'mt-3 text-xs text-ink-500'},`${t.transcriptProvenance}: ${attribution}`):null);
 function finish(){
  if(done)return;
  done=true;
  body.stop?.();
  if(dialog.open)dialog.close();
  dialog.remove();
  onClose?.();
 }
 close.addEventListener('click',finish);
 dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
 dialog.addEventListener('click',event=>{if(event.target===dialog)finish();});
 context.signal.addEventListener('abort',finish,{once:true});
 document.body.append(dialog);
 dialog.showModal();
 close.focus();
 return {close:finish};
}
