import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {failure} from '../../js/request-errors.js';

/** Lesson vocabulary (original VideoVocabulary.tsx): each saved word posts only its occurrence id. The server validates
 * the occurrence against the stored lesson text. One save in flight at a time; a word saved once stays saved. */
export function createVideoVocabulary({context,id,words,dict}){
 const t=dict.videoLesson,signal=context.signal;
 const saved=new Set();
 let pending=null,inFlight=false,errorText='';
 const alert=el('p',{role:'alert',class:'text-band-bad'});
 alert.hidden=true;
 const buttons=new Map();
 const cards=words.map(word=>{
  const button=el('button',{type:'button',class:'btn-secondary mt-3'});
  button.addEventListener('click',()=>save(word),{signal});
  buttons.set(word.id,button);
  return el('article',{class:'card p-4'},
   el('p',{class:'font-semibold'},`${word.term} `,el('span',{class:'text-sm text-ink-500'},word.partOfSpeech)),
   el('p',{},word.definitionEn),
   el('p',{},word.translationUz),
   el('p',{class:'mt-2 text-sm italic'},word.exampleSentence),
   button);
 });
 const root=el('div',{class:'flex flex-col gap-3','data-video-vocabulary':''},
  el('p',{class:'text-sm text-ink-500'},`${t.vocabularyHelp} `,el('a',{href:'/app/vocabulary',class:'underline'},t.vocabularyPractice)),
  alert,...cards);
 paint();

 function paint(){
  alert.hidden=!errorText;
  alert.textContent=errorText;
  for(const word of words){
   const button=buttons.get(word.id);
   const done=saved.has(word.id);
   button.disabled=pending!==null||done;
   button.textContent=done?t.vocabularySaved:pending===word.id?dict.common.saving:t.vocabularySave;
  }
 }
 async function save(word){
  if(inFlight||signal.aborted)return;
  inFlight=true;pending=word.id;errorText='';paint();
  try{
   await api.request(`/api/video-lessons/${id}/vocabulary`,{method:'POST',body:{occurrenceId:word.occurrenceId},signal});
   if(signal.aborted)return;
   saved.add(word.id);
  }catch(error){
   if(signal.aborted)return;
   errorText=failure(error,dict);
  }finally{
   inFlight=false;pending=null;
   if(!signal.aborted)paint();
  }
 }
 return root;
}
