import {anySignal} from '../../js/signals.js';
import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {failure} from '../../js/request-errors.js';
import {privateScope} from '../../js/private-scope.js';
/** Original src/components/vocabulary/ClickableText.tsx WordPopover for the CONTEXTUAL Reading and Retention sources
 * (the current main). A place in a passage has one checked meaning or none:
 *  - the lookup is by the occurrence the text projection supplies; without one the server is asked for the spelling
 *    and must answer unresolved, so the learner sees "not linked yet";
 *  - an unresolved place is never saved with an invented meaning, so the manual meaning form is not offered;
 *  - a resolved place can be saved to the chosen folder, and its study notes (synonyms, collocations, examples)
 *    are shown when the server projects them.
 * Listening keeps the shared popover in ./word-popover.js. */
const enc=encodeURIComponent;
function speak(word){if(!('speechSynthesis'in window))return;const u=new SpeechSynthesisUtterance(word);u.lang='en-GB';speechSynthesis.cancel();speechSynthesis.speak(u);}
export function contextualWordPopover(context,props){
 const {dict,signal}=context,{word,anchor,sourceType,sourceId,occurrenceId:initialOccurrenceId,startChar,endChar,section,onSavedStatus,onClose,sourceTitle,localMeaning}=props,t=dict.vocabulary;
 let occurrenceId=initialOccurrenceId,alternatives=[],contextual=null,unresolved=false,known=null,loading=true,saved=false,needsMeaning=false,busy=false,error=null,folders=[],folderId='',position=null,popup=null,version=0,stopped=false,focused=false;
 const controller=new AbortController(),localSignal=anySignal([signal,controller.signal]);
 let observer=null;
 function place(){if(!popup||stopped)return;position={left:null,top:null};popup.style.removeProperty('left');popup.style.removeProperty('top');popup.style.visibility='visible';}
 const controls=()=>popup?[...popup.querySelectorAll('button,input,select,textarea')]:[];
 function draw(){
  if(localSignal.aborted)return;
  // Keep keyboard focus on the same control across a redraw (for example, when the folder changes).
  const focusIndex=popup&&popup.contains(document.activeElement)?controls().indexOf(document.activeElement):-1;
  const next=view();
  if(popup)popup.replaceWith(next);else document.body.append(next);
  popup=next;observer?.disconnect();observer?.observe(popup);place();
  if(focusIndex>=0)(controls()[focusIndex]??popup).focus({preventScroll:true});
  else if(!focused){focused=true;popup.focus({preventScroll:true});}
 }
 async function lookup(){
  const current=++version;loading=true;error=null;unresolved=false;contextual=null;known=null;saved=false;draw();
  const contextualUrl=`/api/vocabulary/meaning?sourceType=${enc(sourceType)}&sourceId=${enc(sourceId)}&q=${enc(word)}${Number.isInteger(startChar)&&Number.isInteger(endChar)?`&startChar=${startChar}&endChar=${endChar}`:''}${Number.isInteger(section)?`&section=${section}`:''}`;
  const url=occurrenceId
   ?`/api/vocabulary/lookup?sourceType=${enc(sourceType)}&sourceId=${enc(sourceId)}&occurrenceId=${enc(occurrenceId)}`
   :contextualUrl;
  const lookupRequest=async()=>{
   if(sourceType==='listening'&&occurrenceId&&localMeaning?.definitionEn&&localMeaning?.translationUz)
    return {status:'resolved',contextual:localMeaning,occurrenceId,known:null};
   try{return await api.request(url,{signal:localSignal});}
   catch(e){
    if(occurrenceId&&e?.status===404&&Number.isInteger(startChar)&&Number.isInteger(endChar))
     return api.request(contextualUrl,{signal:localSignal});
    throw e;
   }
  };
  try{
   const [lookupResult,folderResult]=await Promise.allSettled([lookupRequest(),api.request('/api/vocabulary/folders',{signal:localSignal})]);
   if(localSignal.aborted||current!==version)return;
   if(lookupResult.status==='rejected')error=failure(lookupResult.reason,dict);
   else{
    let data=lookupResult.value;
    if(data?.status==='unresolved'&&occurrenceId&&Number.isInteger(startChar)&&Number.isInteger(endChar)){data=await api.request(contextualUrl,{signal:localSignal});if(localSignal.aborted||current!==version)return;}
    alternatives=sourceType==='listening'?[]:Array.isArray(data?.alternatives)?data.alternatives:[];
    if(data?.status==='unresolved')unresolved=true;
    else if(typeof data?.contextual?.definitionEn==='string'){contextual=data.contextual;if(data.occurrenceId)occurrenceId=data.occurrenceId;if(data.known)known={...data.known,...data.contextual};onSavedStatus?.(Boolean(data.known));}
    else if(data?.contextual===null)unresolved=true;
    else error=dict.auth.errorServer;
   }
   if(folderResult.status==='fulfilled'&&Array.isArray(folderResult.value?.folders))folders=folderResult.value.folders.filter(f=>typeof f?.id==='string'&&typeof f.name==='string');
   else error=folderResult.status==='rejected'?failure(folderResult.reason,dict):dict.auth.errorServer;
  }catch(e){if(!localSignal.aborted&&current===version)error=failure(e,dict);
  }finally{
   if(!localSignal.aborted&&current===version){loading=false;draw();}
  }
 }
 async function save(){
  if(busy||!contextual||(!occurrenceId&&!contextual.dictionary))return;
  busy=true;error=null;needsMeaning=false;draw();
  try{
   const result=contextual.dictionary
    ?await api.request('/api/dictionary/save',{method:'POST',body:{...contextual.dictionary,folderId:folderId||null},signal:localSignal})
    :await api.request('/api/vocabulary',{method:'POST',body:{items:[{term:word,translationUz:null}],sourceType,sourceId,occurrenceId,folderId:folderId||null},signal:localSignal});
   if(localSignal.aborted)return;
   if(result?.ok===true){privateScope.invalidate('vocabulary:');saved=true;onSavedStatus?.(true);}
   else error=dict.auth.errorServer;
  }catch(e){
   if(localSignal.aborted)return;
   if(e?.code==='needs_definition')needsMeaning=true;else error=failure(e,dict);
  }finally{
   busy=false;if(!localSignal.aborted)draw();
  }
 }
 const button=(className,attrs,label,onClick)=>{const b=el('button',{type:'button',class:className,...attrs},label);b.addEventListener('click',onClick);return b;};
 function knownBlock(){
  return el('div',{class:'mt-2 flex flex-col gap-1 text-xs'},
   el('p',{class:'text-ink-700'},known.definitionEn),
   known.translationUz?[el('hr',{class:'dictionary-translation-divider'}),el('p',{class:'text-ink-500'},known.translationUz)]:null,
   el('p',{class:'text-ink-300'},`${t.tab.words} · ${t.mastery[known.mastery]??known.mastery}`));
 }
 function contextualBlock(){
  const lexical=[contextual.partOfSpeech,contextual.lexicalType&&contextual.lexicalType!=='word'?t.lexicalTypeLabel?.[contextual.lexicalType]??null:null].filter(Boolean).join(' · ');
  return el('div',{class:'text-sm text-ink-700'},
   (contextual.partOfSpeech||contextual.lexicalType||contextual.ipa)?el('p',{class:'text-xs text-ink-500','data-word-lexical':true},lexical,contextual.ipa?el('span',{class:'ml-1 font-mono','data-word-ipa':true},`/${contextual.ipa}/`):null):null,
   el('p',{},contextual.definitionEn),
   contextual.translationUz?[el('hr',{class:'dictionary-translation-divider'}),el('p',{},contextual.translationUz)]:null);
 }
 function folderAndSave(){
  const select=el('select',{class:'input mt-1',value:folderId},el('option',{value:''},sourceType==='listening'?(sourceTitle||'Listening Test'):sourceType==='reading'?'Reading':sourceType==='retention'?'Retention':t.folders.unassigned),...folders.map(f=>el('option',{value:f.id},f.name)));
  select.value=folderId;select.addEventListener('change',()=>{folderId=select.value;});
  return [el('label',{class:'text-xs text-ink-500'},t.games.set.folder,select),
   el('div',{class:'flex items-center gap-2'},button('btn-primary text-xs',{disabled:busy?true:null,'data-word-save':true},busy?dict.common.saving:t.add.button,()=>void save()))];
 }
 function studyBlock(study){
  const synonyms=study.synonyms??[],collocations=study.collocations??[],examples=study.examples??[],g=dict.globalDictionary;
  return el('div',{class:'mt-3 space-y-2 border-t border-ink-100 pt-2 text-sm','data-word-study':true},
   synonyms.length?el('details',{'data-word-synonyms':true},el('summary',{class:'cursor-pointer font-semibold'},g.synonyms),el('div',{class:'mt-2 flex flex-wrap gap-1'},synonyms.map(item=>el('span',{class:'rounded border border-ink-100 px-2 py-1','data-related-sense':item.senseId},item.text)))):null,
   collocations.length?el('details',{'data-word-collocations':true},el('summary',{class:'cursor-pointer font-semibold'},g.collocations),el('ul',{class:'mt-2 list-disc'},collocations.map(item=>el('li',{'data-related-sense':item.senseId},item.text)))):null,
   examples.length?el('details',{'data-word-examples':true},el('summary',{class:'cursor-pointer font-semibold'},g.moreExamples),el('div',{class:'mt-2 space-y-2'},examples.map(example=>el('div',{},el('p',{},example.text_en),el('p',{class:'mt-1 text-xs'},example.text_uz))))):null);
 }
 function view(){
  const study=!loading?contextual?.study:null;
  return el('div',{tabIndex:-1,role:'dialog','aria-label':word,'data-word-popover':true,'data-word-source':sourceType,class:'dictionary-context-panel fixed overflow-y-auto whitespace-normal rounded-md border border-ink-100 bg-paper-raised p-3 shadow-raised',style:{visibility:position?'visible':'hidden'}},
   el('div',{class:'flex items-start justify-between gap-2'},
    el('span',{class:'font-display text-lg text-ink-900'},word),
    button('btn-ghost px-2 py-1 text-xs',{'aria-label':t.games.pronounce},'🔊',()=>speak(word)),
    button('btn-ghost px-2 py-1 text-xs',{},t.add.close,()=>{stop();onClose?.();})),
   error?el('div',{class:'mt-2 text-xs text-band-warn'},el('p',{role:'alert'},error),button('btn-ghost mt-1 text-xs',{disabled:loading||busy?true:null},dict.errorPage.retry,()=>void lookup())):null,
   loading?el('p',{class:'mt-2 text-xs text-ink-300'},dict.common.loading):null,
   !loading&&known?knownBlock():null,
   !loading&&!known&&!saved?el('div',{class:'mt-2 flex flex-col gap-2'},
    unresolved?el('div',{role:'status',class:'text-xs text-ink-500','data-word-unresolved':true},alternatives.length?el('div',{class:'space-y-2'},el('p',{},context.locale==='uz'?"Matnga mos ma’noni tanlang:":'Choose the meaning used here:'),alternatives.map(candidate=>button('w-full rounded-md border p-2 text-left',{'data-context-alternative':''},candidate.definitionEn+(candidate.translationUz?' · '+candidate.translationUz:''),()=>{contextual=candidate;unresolved=false;draw();}))):el('p',{},context.locale==='uz'?'Bu kontekstdagi ma’no hali tasdiqlanmagan.':'The meaning in this context has not been verified yet.')):null,
    contextual?[contextualBlock(),...folderAndSave()]:null):null,
   study?studyBlock(study):null,
   saved?el('p',{class:'mt-2 text-xs text-band-good','data-word-saved':true},`${t.add.added} · ${t.tab.words}`):null,
   needsMeaning?el('p',{class:'mt-2 text-xs text-band-warn','data-word-needs-meaning':true},t.add.needsMeaning):null);
 }
 const dismiss=event=>{if(event.type==='keydown'){if(event.key==='Escape'){event.preventDefault();stop();onClose?.();}return;}if(popup&&!popup.contains(event.target)&&event.target!==anchor&&!anchor?.contains(event.target)){stop();onClose?.();}};
 document.addEventListener('pointerdown',dismiss,true);document.addEventListener('keydown',dismiss,true);
 function stop(){
  if(stopped)return;stopped=true;document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',dismiss,true);controller.abort();observer?.disconnect();
  window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);
  popup?.remove();popup=null;signal.removeEventListener('abort',stop);
 }
 observer=typeof ResizeObserver==='function'?new ResizeObserver(place):null;
 window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
 signal.addEventListener('abort',stop,{once:true});
 void lookup();
 return {stop};
}
