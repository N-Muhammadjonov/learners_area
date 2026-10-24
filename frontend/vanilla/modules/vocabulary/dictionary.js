import {h,card,button,primary,select,notice,loading,fail,request,guardArray,params,notifyLedger,uuid} from './shared.js';
/** Dictionary lookup is sense-specific: never guess an entry from text or fabricate a definition. */
export function mountDictionary(ctx,host){const {dict,signal,url}=ctx,t=dict.globalDictionary;let query=(url.searchParams.get('q')??'').slice(0,80),direction=url.searchParams.get('direction')==='UZ'?'UZ':'EN',release='',hits=[],entry=null,entryPresentation=null,saved=[],folders=[],recent=[],searchSeq=0,entrySeq=0,timer;
 const searchHost=h('div'),results=h('div'),detail=h('div'),history=h('div');host.className='space-y-4';host.append(searchHost,history,results,detail);
 async function lookup(){const token=++searchSeq;results.replaceChildren(loading(dict,'dictionary-search'));detail.replaceChildren();entry=null;if(!query.trim()){results.replaceChildren(notice(t.startHint));return;}try{const d=await request(`/api/dictionary/search?${params({q:query,direction})}`,{signal});if(signal.aborted||token!==searchSeq)return;release=d.release_id;hits=guardArray(d,'results');renderResults();const deep=url.searchParams.get('entry');if(deep&&uuid.test(deep)&&hits.some(x=>x.lexeme_id===deep)){url.searchParams.delete('entry');void openEntry(deep);} }catch{if(!signal.aborted&&token===searchSeq)results.replaceChildren(fail(ctx,'dictionary-search',lookup));}}
 function renderSearch(){const input=h('input',{class:'input w-full',type:'search',value:query,maxLength:80,placeholder:t.search,'aria-label':t.search});const directionSelect=select('Language',[{value:'EN',label:'EN → UZ'},{value:'UZ',label:'UZ → EN'}],v=>{direction=v;void lookup();},direction);const form=h('form',{role:'search',class:'flex flex-col gap-2 sm:flex-row sm:items-end'},input,directionSelect,h('button',{type:'submit',class:'btn-primary min-h-[40px]'},t.search));form.addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);query=input.value.slice(0,80);void lookup();});input.addEventListener('input',()=>{query=input.value.slice(0,80);clearTimeout(timer);timer=setTimeout(()=>lookup(),150);},{signal});searchHost.replaceChildren(card(h('h2',{class:'font-display text-xl'},t.search),form));}
 function renderResults(){results.replaceChildren(card(h('h3',{class:'font-semibold'},t.results),hits.length?h('ul',{class:'divide-y divide-ink-100'},hits.map(x=>h('li',{class:'py-2'},button(`${x.display_lemma} · ${x.part_of_speech||''} · ${x.translation_uz||''}`,()=>openEntry(x.lexeme_id),{class:'text-left underline min-h-[44px]'})))):notice(t.empty)));}
 async function loadMeta(){try{const [f,r]=await Promise.all([request('/api/vocabulary/folders',{signal}),request('/api/dictionary/recent',{signal})]);if(signal.aborted)return;folders=guardArray(f,'folders');recent=guardArray(r,'recent');renderRecent();}catch{if(!signal.aborted)history.replaceChildren(fail(ctx,'dictionary-recent',loadMeta));}}
 function renderRecent(){history.replaceChildren(card(h('div',{class:'flex justify-between'},h('h3',{class:'font-semibold'},t.recent),button(t.clear,async()=>{try{await request('/api/dictionary/recent',{method:'DELETE',signal});recent=[];renderRecent();}catch{history.append(notice(t.unavailable,'alert'));}})),h('div',{class:'flex flex-wrap gap-2'},recent.slice(0,10).map(r=>button(r.query??r.term??'',()=>{query=r.query??r.term??'';direction=r.direction==='UZ'?'UZ':'EN';renderSearch();void lookup();})))));}
 async function openEntry(id){const token=++entrySeq;detail.replaceChildren(loading(dict,'dictionary-entry'));try{const d=await request(`/api/dictionary/entries/${id}${release?'?release_id='+encodeURIComponent(release):''}`,{signal});if(signal.aborted||token!==entrySeq)return;entry=d.entry;entryPresentation=d.presentation??null;saved=Array.isArray(d.saved)?d.saved:[];renderEntry();try{await request(`/api/dictionary/entries/${id}`,{method:'POST',body:{query,direction,releaseId:entry.release_id},signal});void loadMeta();}catch{/* History cannot hide a good dictionary entry. */}}catch{if(!signal.aborted&&token===entrySeq)detail.replaceChildren(fail(ctx,'dictionary-entry',()=>openEntry(id)));}}
 function renderEntry(){
  if(!entry)return;
  const senses=Array.isArray(entry.senses)?entry.senses:[];
  const presentationEntry=entryPresentation;
  const title=entry.display_lemma??entry.lemma??'';
  detail.replaceChildren(card(
   h('div',{class:'flex justify-between items-center gap-3'},
    h('div',{},h('h2',{class:'font-display text-2xl'},title),
     h('p',{class:'text-xs text-ink-500'},[entry.part_of_speech,entry.lexical_type].filter(Boolean).join(' · ')),
     h('p',{class:'text-xs'},Array.isArray(entry.pronunciations)?entry.pronunciations.map(p=>`/${p.ipa}/`).join(' · '):'')),
    button(t.back,()=>detail.replaceChildren())),
   h('p',{class:'text-sm'},`${t.allSenses} · ${senses.length}`),
   h('div',{class:'flex flex-wrap gap-2'},
    button(t.expandAll??t.allSenses,()=>detail.querySelectorAll('details[data-dictionary-sense]').forEach(x=>x.open=true)),
    button(t.collapseAll??t.close,()=>detail.querySelectorAll('details[data-dictionary-sense]').forEach(x=>x.open=false))),
   senses.map(s=>{
    const id=s.sense_id;
    const translation=Array.isArray(s.translations)?s.translations.map(x=>x.text).filter(Boolean).join(' / '):(s.translation_uz??'');
    const pv=presentationEntry?.senses?.[id]??{};
    const examples=Array.isArray(pv.examples)?pv.examples:Array.isArray(s.examples)?s.examples:[];
    const related=(title,items)=>Array.isArray(items)&&items.length?h('details',{class:'mt-2'},h('summary',{},title),h('ul',{class:'list-disc pl-5'},items.map(x=>h('li',{},x.text)))):null;
    const content=h('div',{class:'space-y-2 mt-2 text-sm'},
      h('p',{},s.definition_en??s.definitionEn??''),
      s.definition_uz?h('p',{lang:'uz'},s.definition_uz):null,
      ...examples.map(e=>h('div',{class:'rounded bg-paper-sunken p-2'},h('p',{},e.text_en??''),h('p',{lang:'uz'},e.text_uz??''))),
      related(t.synonyms,pv.synonyms),related(t.collocations,pv.collocations));
    const fold=h('details',{'data-dictionary-sense':id,class:'border-t border-ink-100 py-3'},
      h('summary',{class:'font-semibold cursor-pointer'},translation||s.definition_en||t.allSenses),content);
    const picker=h('select',{class:'input w-full text-xs','aria-label':t.folder},
      h('option',{value:''},t.defaultFolder),folders.map(f=>h('option',{value:f.id},f.name)));
    const msg=h('p');
    const save=primary(saved.includes(id)?t.saved:t.save,async()=>{
      if(saved.includes(id))return;save.disabled=true;
      try{
       await request('/api/dictionary/save',{method:'POST',body:{lexemeId:entry.lexeme_id,senseId:id,releaseId:entry.release_id,folderId:picker.value||null},signal});
       if(signal.aborted)return;
       saved.push(id);save.textContent=t.saved;msg.replaceChildren(notice(t.saved));notifyLedger();
      }catch{msg.replaceChildren(notice(t.unavailable,'alert'));save.disabled=false;}
    },{disabled:saved.includes(id)});
    return h('section',{},fold,h('div',{class:'flex flex-wrap gap-2'},picker,save),msg);
   })
  ));
 }
 signal.addEventListener('abort',()=>{clearTimeout(timer);++searchSeq;++entrySeq;host.replaceChildren();},{once:true});renderSearch();void loadMeta();if(query)void lookup();else results.append(notice(t.startHint));}
