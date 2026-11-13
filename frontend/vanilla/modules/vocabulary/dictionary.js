import {h} from './shared.js';
import {api} from '../../js/api-client.js';
import {privateScope} from '../../js/private-scope.js';
import {anySignal} from '../../js/signals.js';
import {dictionaryFolderDialog,dictionaryRecent} from './dictionary-learner-ui.js';

const pos=value=>({n:'noun',v:'verb',a:'adjective',s:'adjective',r:'adverb'}[value]??value??'');
const text=value=>String(value??'');
/** Native learner reader, rebuilt from copymain's layout and interaction contract.
 * Every meaning and sense mapping comes from the existing authenticated API. */
export function mountDictionary(ctx,host){
 const {dict,signal}=ctx,t=dict.globalDictionary,button=(label,action,attrs={})=>h('button',{type:'button',...attrs,onClick:action},label);
 const S={query:(ctx.url.searchParams.get('q')??'').slice(0,80),direction:ctx.url.searchParams.get('direction')==='UZ'?'UZ':'EN',hits:[],recent:[],folders:[],entry:null,presentation:null,release:'',saved:[],expanded:[],phraseSaved:new Set(),active:-1,loading:false,error:''};
 const node=h('section',{class:'dictionary-reader vocabulary-dictionary','data-global-dictionary':'','data-vocabulary-dictionary':''}),barHost=h('div'),errorHost=h('div'),bodyHost=h('div',{class:'dictionary-results-area'});node.append(barHost,errorHost,bodyHost);host.append(node);
 let serial=0,timer,searchLife,recentView,folderDialog;
 const alive=()=>!signal.aborted;
 function bar(){
  const input=h('input',{type:'text',role:'combobox',maxLength:80,autoComplete:'off',value:S.query,placeholder:t.search,'aria-label':t.search,'aria-autocomplete':'list','aria-controls':'dictionary-results','aria-expanded':!S.entry&&S.hits.length>0,'data-dictionary-search':''});
  const clear=button('×',()=>{S.query='';input.value='';search();clear.hidden=true;input.focus();},{class:'dictionary-clear','aria-label':t.clear,'data-dictionary-clear':'',hidden:!S.query});
  input.addEventListener('input',()=>{S.query=input.value.slice(0,80);clear.hidden=!S.query;search();},{signal});
  input.addEventListener('keydown',e=>{if(S.entry||!S.hits.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();S.active=e.key==='ArrowDown'?Math.min(S.active+1,S.hits.length-1):Math.max(0,S.active-1);paint();}else if(e.key==='Enter'){e.preventDefault();void open(S.hits[S.active<0?0:S.active]);}},{signal});
  const form=h('form',{role:'search',class:'dictionary-search',onSubmit:e=>{e.preventDefault();search(0);}},h('button',{type:'submit',class:'dictionary-search-submit','aria-label':t.search,title:t.search},h('svg',{'aria-hidden':'true',width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round'},h('circle',{cx:10.5,cy:10.5,r:5.5}),h('path',{d:'m15 15 4 4'}))),input,clear,h('div',{role:'group',class:'dictionary-directions','aria-label':t.search},['EN','UZ'].map(lang=>button(lang,()=>{if(S.direction===lang)return;S.direction=lang;S.release='';search();bar();},{'aria-pressed':S.direction===lang,'data-dictionary-direction':lang}))));
  barHost.replaceChildren(form);
 }
 function search(delay=ctx.dictionaryDebounceMs??220){
  clearTimeout(timer);searchLife?.abort();const version=++serial;S.entry=null;S.presentation=null;S.active=-1;S.hits=[];S.error='';S.loading=!!S.query.trim();paint();if(!S.query.trim())return;
  searchLife=new window.AbortController();const own=anySignal([signal,searchLife.signal]),query=S.query,direction=S.direction;
  timer=setTimeout(async()=>{try{const result=await api.request('/api/dictionary/search?'+new URLSearchParams({q:query,direction}),{signal:own});if(!alive()||version!==serial)return;if(!Array.isArray(result.results))throw Error('invalid_search');S.hits=result.results;S.release=result.release_id??'';}catch{if(alive()&&version===serial&&!own.aborted)S.error=t.unavailable;}finally{if(alive()&&version===serial){S.loading=false;paint();}}},delay);
 }
 async function open(hit,query=S.query,direction=S.direction,senseId){
  clearTimeout(timer);searchLife?.abort();const version=++serial;S.loading=true;S.error='';S.entry=null;S.query=query||hit.display_lemma||'';S.direction=direction==='UZ'?'UZ':'EN';bar();paint();
  try{const pin=S.release?'?release_id='+encodeURIComponent(S.release):'',result=await api.request('/api/dictionary/entries/'+encodeURIComponent(hit.lexeme_id)+pin,{signal});if(!alive()||version!==serial)return;
   const entry=result.entry;if(!entry||typeof entry.lexeme_id!=='string'||!Array.isArray(entry.senses))throw Error('invalid_entry');
   S.presentation=result.presentation??null;const order=S.presentation?.senseOrder??[],ranks=new Map(order.map((id,i)=>[id,i]));S.entry={...entry,senses:[...entry.senses].sort((a,b)=>(ranks.get(a.sense_id)??999)-(ranks.get(b.sense_id)??999))};S.release=entry.release_id;S.saved=Array.isArray(result.saved)?result.saved:[];S.expanded=senseId&&entry.senses.some(s=>s.sense_id===senseId)?[senseId]:[];S.loading=false;paint();
   try{await api.request('/api/dictionary/entries/'+encodeURIComponent(entry.lexeme_id),{method:'POST',body:{query:S.query,direction:S.direction,releaseId:entry.release_id},signal});const history=await api.request('/api/dictionary/recent',{signal});if(alive()&&version===serial)S.recent=Array.isArray(history.recent)?history.recent:[];}catch{if(alive()&&version===serial)S.error=t.unavailable;}
  }catch{if(alive()&&version===serial)S.error=t.unavailable;}finally{if(alive()&&version===serial){S.loading=false;paint();}}
 }
 function chooseFolder(entry,sense,onSaved){folderDialog?.stop();folderDialog=dictionaryFolderDialog(ctx,{entry,sense,folders:S.folders,onSave:async folderId=>{const result=await api.request('/api/dictionary/save',{method:'POST',body:{lexemeId:entry.lexeme_id,senseId:sense.sense_id,releaseId:entry.release_id,folderId},signal});if(result.ok!==true)throw Error('save_failed');if(alive()){onSaved?.();if(S.entry?.lexeme_id===entry.lexeme_id)S.saved=[...new Set([...S.saved,sense.sense_id])];privateScope.invalidate('vocabulary:');paint();}},onCreate:async name=>{const result=await api.request('/api/vocabulary/folders',{method:'POST',body:{name},signal});if(!result.folder?.id)throw Error('invalid_folder');privateScope.invalidate('vocabulary:');return result.folder;}});}
 function pronounce(word){const status=h('span',{role:'status'}),b=button('',()=>{if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){status.textContent=t.pronunciationUnavailable;return;}window.speechSynthesis.cancel();const sound=new window.SpeechSynthesisUtterance(word);sound.lang='en-GB';sound.onend=()=>b.setAttribute('aria-pressed','false');sound.onerror=()=>{b.setAttribute('aria-pressed','false');status.textContent=t.pronunciationUnavailable;};b.setAttribute('aria-pressed','true');window.speechSynthesis.speak(sound);},{class:'dictionary-pronounce','aria-label':dict.vocabulary.games.pronounce+': '+word,'aria-pressed':false});b.append(h('svg',{'aria-hidden':'true',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},h('path',{d:'M11 5 6 9H3v6h3l5 4V5ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14'})));return h('div',{class:'dictionary-pronunciation'},b,status);}
 function related(items){return (items??[]).map(item=>item.lexemeId?button(item.text,()=>void open({lexeme_id:item.lexemeId,display_lemma:item.text},item.text,'EN',item.senseId)):h('span',{},item.text));}
 function meaning(entry,sense,index){
  const expanded=S.expanded.includes(sense.sense_id),saved=S.saved.includes(sense.sense_id),view=S.presentation?.senses?.[sense.sense_id]??{examples:sense.examples??[],synonyms:[],collocations:[]};
  const example=x=>h('blockquote',{},h('p',{},'• '+text(x.text_en)),h('p',{lang:'uz'},x.text_uz));
  return h('section',{class:'dictionary-meaning','data-dictionary-sense':sense.sense_id},h('div',{class:'dictionary-meaning-header'},button(saved?'✓':'+',()=>chooseFolder(entry,sense),{class:'dictionary-add-meaning','aria-label':saved?t.saved:t.save,title:saved?t.saved:t.save,disabled:saved,'data-dictionary-save':sense.sense_id}),h('h3',{},button('',()=>{S.expanded=expanded?S.expanded.filter(id=>id!==sense.sense_id):[...S.expanded,sense.sense_id];paint();},{class:'dictionary-meaning-toggle','aria-expanded':expanded,'aria-controls':'dictionary-sense-'+sense.sense_id,'data-dictionary-sense-toggle':sense.sense_id}))),expanded?h('div',{class:'dictionary-meaning-body',id:'dictionary-sense-'+sense.sense_id},h('div',{class:'dictionary-definition'},h('h4',{},t.english),h('p',{},sense.definition_en)),h('hr',{class:'dictionary-translation-divider'}),h('div',{class:'dictionary-definition'},h('h4',{},t.definition),h('p',{},sense.definition_uz)),view.examples?.length?h('div',{class:'dictionary-examples','aria-label':t.examples},view.examples.slice(0,2).map(example)):null,view.examples?.length>2?h('details',{class:'dictionary-disclosure'},h('summary',{},t.moreExamples),h('div',{class:'dictionary-examples'},view.examples.slice(2).map(example))):null,h('div',{class:'dictionary-sense-details'},h('details',{class:'dictionary-disclosure'},h('summary',{},t.synonyms),h('div',{class:'dictionary-related-items'},view.synonyms?.length?related(view.synonyms):h('p',{},t.noSynonyms))),h('details',{class:'dictionary-disclosure'},h('summary',{},t.antonyms??(ctx.locale==='uz'?'Antonimlar':'Antonyms')),h('div',{class:'dictionary-related-items'},view.antonyms?.length?related(view.antonyms):h('p',{},ctx.locale==='uz'?'Bu ma’no uchun antonim mavjud emas.':'No antonyms for this meaning.'))))):null);
 }
 async function addCollocation(item){
  try{let target=item.lexemeId;
   if(!target){const result=await api.request('/api/dictionary/search?'+new URLSearchParams({q:item.text,direction:'EN',release_id:S.release}),{signal});target=result.results?.find(hit=>hit.display_lemma.normalize('NFKC').toLowerCase()===item.text.normalize('NFKC').toLowerCase())?.lexeme_id;}
   if(!alive())return;
   if(target){const result=await api.request('/api/dictionary/entries/'+encodeURIComponent(target)+'?release_id='+encodeURIComponent(S.release),{signal});if(!alive())return;const entry=result.entry;
    const sense=item.senseId?entry.senses.find(s=>s.sense_id===item.senseId):(entry.senses.length===1?entry.senses[0]:null);
    if(item.senseId&&!sense)throw Error('dictionary_target_sense_missing');
    if(sense){chooseFolder(entry,sense,()=>S.phraseSaved.add(item.text));return;}
   }
   // Authored phrases without a standalone dictionary entry use the existing
   // personal-word path. Never save the parent word/sense under another spelling.
   const entry={display_lemma:item.text,lexical_type:'collocation',pronunciations:[]},sense={translations:[]};
   folderDialog?.stop();folderDialog=dictionaryFolderDialog(ctx,{entry,sense,folders:S.folders,onSave:async folderId=>{const result=await api.request('/api/vocabulary',{method:'POST',body:{items:[{term:item.text,definitionEn:item.text}],folderId,sourceType:'manual'},signal});if(result.ok!==true)throw Error('save_failed');if(alive()){S.phraseSaved.add(item.text);privateScope.invalidate('vocabulary:');paint();}},onCreate:async name=>{const result=await api.request('/api/vocabulary/folders',{method:'POST',body:{name},signal});if(!result.folder?.id)throw Error('invalid_folder');return result.folder;}});
  }catch{if(alive()){S.error=t.unavailable;paint();}}
 }
 function collocationsView(entry){
  const items=new Map();
  for(const item of S.presentation?.collocations??[...(entry.collocations??[]),...Object.values(S.presentation?.senses??{}).flatMap(s=>s.collocations??[])]){
   const key=JSON.stringify([item.text.normalize('NFKC').toLowerCase(),item.lexemeId??null,item.senseId??null]);items.set(key,item);
  }
  if(!items.size)return null;
  const cards=[...items.values()].map(item=>{
   const add=button(S.phraseSaved.has(item.text)?'✓':'+',()=>void addCollocation(item),{class:'dictionary-add-meaning','aria-label':t.save+': '+item.text,disabled:S.phraseSaved.has(item.text),'data-dictionary-collocation-save':item.text});
   const title=item.lexemeId?button(item.text,()=>void open({lexeme_id:item.lexemeId,display_lemma:item.text},item.text,'EN',item.senseId),{class:'dictionary-meaning-toggle'}):h('strong',{class:'dictionary-collocation-text'},item.text);
   return h('section',{class:'dictionary-meaning'},h('div',{class:'dictionary-meaning-header'},add,h('h3',{},title)));
  });
  return h('section',{class:'dictionary-entry-collocations','data-dictionary-all-collocations':''},h('h3',{class:'dictionary-list-title'},t.collocations),h('div',{class:'dictionary-meanings'},cards));
 }
 function entryView(){const entry=S.entry,all=entry.senses.every(s=>S.expanded.includes(s.sense_id)),article=h('article',{class:'dictionary-entry','data-dictionary-entry':entry.lexeme_id},h('nav',{class:'dictionary-entry-nav','aria-label':t.allSenses},button(t.back,()=>{serial++;S.entry=null;S.loading=false;paint();},{'data-dictionary-back':''})),h('header',{class:'dictionary-entry-heading'},h('div',{},h('div',{class:'dictionary-word-heading'},h('h2',{},entry.display_lemma),pronounce(entry.display_lemma)),h('div',{class:'dictionary-entry-meta'},h('span',{class:'dictionary-pos'},pos(entry.part_of_speech)),(entry.pronunciations??[]).map(p=>h('span',{},'/'+text(p.ipa)+'/')))),button(all?t.collapseAll:t.expandAll,()=>{S.expanded=all?[]:entry.senses.map(s=>s.sense_id);paint();},{class:'dictionary-expand-all','data-dictionary-expand-all':''})),h('div',{class:'dictionary-meanings'},entry.senses.map((s,i)=>meaning(entry,s,i))),collocationsView(entry));
  for(const [i,sense]of entry.senses.entries()){const toggle=article.querySelectorAll('[data-dictionary-sense-toggle]')[i];toggle.append(h('strong',{},(entry.senses.length>1?(i+1)+'. ':'')+(sense.sense_id===S.presentation?.primarySenseId?S.presentation.primaryTranslation:(sense.translations??[]).map(x=>x.text).join(' / '))),h('span',{class:'dictionary-pos'},pos(entry.part_of_speech)),...(sense.cefr?[h('span',{class:'dictionary-level'},sense.cefr)]:[]),h('span',{class:'dictionary-chevron','aria-hidden':'true'},S.expanded.includes(sense.sense_id)?'⌃':'⌄'));}
  return article;
 }
 function paint(){if(!alive())return;const input=barHost.querySelector('input');if(input){input.setAttribute('aria-expanded',String(!S.entry&&S.hits.length>0));if(!S.entry&&S.active>=0)input.setAttribute('aria-activedescendant','dictionary-hit-'+S.active);else input.removeAttribute('aria-activedescendant');}
  errorHost.replaceChildren(...(S.error?[h('div',{class:'dictionary-error',role:'alert','data-dictionary-error':''},h('p',{},S.error),button(t.retry,()=>{void metadata();search(0);}))]:[]));recentView?.dispose();recentView=null;
  if(S.entry){bodyHost.replaceChildren(entryView());return;}
  if(S.loading){bodyHost.replaceChildren(h('div',{role:'status','aria-label':dict.common.loading},[0,1,2].map(()=>h('div',{class:'dictionary-loading'}))));return;}
  if(!S.query.trim()){recentView=dictionaryRecent(ctx,S.recent,{pos,onOpen:r=>void open(r,r.query_display,r.direction),onClear:async()=>{try{await api.request('/api/dictionary/recent',{method:'DELETE',signal});if(alive()){S.recent=[];paint();}}catch{S.error=t.unavailable;paint();}}});bodyHost.replaceChildren(recentView.node,...(!S.recent.length?[h('div',{class:'dictionary-empty'},h('h2',{},t.startTitle),h('p',{},t.startHint))]:[]));return;}
  bodyHost.replaceChildren(h('h2',{class:'dictionary-list-title'},t.results),h('ul',{class:'dictionary-result-list',role:'listbox',id:'dictionary-results','aria-label':t.results},S.hits.map((hit,index)=>h('li',{role:'option',id:'dictionary-hit-'+index,'aria-selected':S.active===index},button('',()=>void open(hit),{class:'dictionary-result-row','data-dictionary-hit':hit.lexeme_id,'data-active':S.active===index})))),...(!S.error&&!S.hits.length?[h('p',{class:'dictionary-empty','data-dictionary-empty':''},t.empty)]:[]));
  for(const [index,b]of [...bodyHost.querySelectorAll('[data-dictionary-hit]')].entries()){const hit=S.hits[index];b.append(h('span',{class:'dictionary-result-heading'},h('strong',{},hit.display_lemma),h('span',{class:'dictionary-pos'},pos(hit.part_of_speech)),hit.cefr?h('span',{class:'dictionary-level'},hit.cefr):null),h('span',{class:'dictionary-preview'},hit.translation_uz));}
 }
 async function metadata(){const results=await Promise.allSettled([api.request('/api/dictionary/recent',{signal}),api.request('/api/vocabulary/folders',{signal})]);if(!alive())return;if(results[0].status==='fulfilled')S.recent=results[0].value.recent??[];if(results[1].status==='fulfilled')S.folders=results[1].value.folders??[];if(results.some(r=>r.status==='rejected'))S.error=t.unavailable;paint();}
 signal.addEventListener('abort',()=>{serial++;clearTimeout(timer);searchLife?.abort();recentView?.dispose();folderDialog?.stop();window.speechSynthesis?.cancel();node.remove();},{once:true});bar();paint();void metadata();const initial=ctx.url.searchParams.get('entry');if(initial)void open({lexeme_id:initial,display_lemma:S.query});else if(S.query)search();return node;
}

