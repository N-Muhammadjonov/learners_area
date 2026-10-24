import {el,listen,put,setChildren} from './kit.js';
import {dictCall} from '../../js/adapters/staff-final30/dictionary.js';
import {isObj,bad,str,arr} from '../../js/adapters/staff-final30/core.js';
/**
 * components/vocabulary/DictionaryPanel.tsx — OWNER mode only (search -> entry -> sense actions). The student mode (recent searches,
 * folders, save) belongs to the vocabulary module and is intentionally not part of the staff slice. Owner reads use the existing
 * /api/owner/dictionary/{search,entries/:id}; responses are validated, text is rendered as text, and a late response never
 * overwrites a newer search (request counter + abort).
 */
const POS={n:'noun',v:'verb',a:'adjective',s:'adjective',r:'adverb'};
export const dictionaryPos=v=>POS[v]??v;
const t0=(v,max=2000)=>str(v??'',{max});
function entryOf(d){
 const e=d?.entry;if(!isObj(e)||typeof e.lexeme_id!=='string')throw bad();
 return {lexeme_id:e.lexeme_id,release_id:t0(e.release_id,100),display_lemma:t0(e.display_lemma,300),part_of_speech:t0(e.part_of_speech,40),lexical_type:t0(e.lexical_type,40),
  pronunciations:arr(e.pronunciations??[],20).map(p=>({ipa:t0(p?.ipa,100)})),
  senses:arr(e.senses??[],200).map(s=>{if(!isObj(s)||typeof s.sense_id!=='string')throw bad();return {...s,sense_id:s.sense_id,definition_en:t0(s.definition_en),definition_uz:t0(s.definition_uz),translations:arr(s.translations??[],50).map(x=>({text:t0(x?.text,500)})),examples:arr(s.examples??[],200).map(x=>({example_id:t0(x?.example_id,100),text_en:t0(x?.text_en),text_uz:t0(x?.text_uz)})),cefr:s.cefr==null?null:t0(s.cefr,10),register:s.register==null?null:t0(s.register,40),usage_label:s.usage_label==null?null:t0(s.usage_label,60),domain_tags:arr(s.domain_tags??[],30).map(x=>t0(x,60))};}),
  forms:arr(e.forms??[],200).map(f=>({surface_form:t0(f?.surface_form,200)})),collocations:arr(e.collocations??[],200).map(c=>({text:t0(c?.text,300)})),
  relations:arr(e.relations??[],200).map(r=>({relation_type:t0(r?.relation_type,40),target_lexeme_id:t0(r?.target_lexeme_id,100),display_lemma:t0(r?.display_lemma,300),part_of_speech:t0(r?.part_of_speech,40)})),
  attribution:arr(e.attribution??[],50).map(a=>({snapshot_id:t0(a?.snapshot_id,100),source_name:t0(a?.source_name,200),attribution_text:t0(a?.attribution_text,5000)}))};
}
function hitsOf(d){return {release:t0(d?.release_id,100),results:arr(d?.results??[],200).map(h=>{if(!isObj(h)||typeof h.lexeme_id!=='string')throw bad();return {lexeme_id:h.lexeme_id,display_lemma:t0(h.display_lemma,300),part_of_speech:t0(h.part_of_speech,40),translation_uz:t0(h.translation_uz,500)};})};}
export function dictionaryPanel(ctx,{onEdit,onAddSense,onAddWord}){
 const {dict,signal}=ctx,t=dict.globalDictionary,S={query:'',direction:'EN',hits:[],release:'',entry:null,expanded:[],error:'',loading:false,active:-1,retry:0},debounce=ctx.dictionaryDebounceMs??220;
 const node=el('section',{class:'mx-auto w-full max-w-[1120px] space-y-4','data-global-dictionary':''});let stamp=0,abort=null,timer=null;
 signal.addEventListener('abort',()=>{abort?.abort();clearTimeout(timer);},{once:true});
 const alive=()=>!signal.aborted;
 async function read(path,sig){try{return await dictCall(path,'GET',undefined,sig);}catch(e){if(sig?.aborted||signal.aborted)throw e;throw new Error(t.unavailable);}}
 function runSearch(){
  abort?.abort();clearTimeout(timer);const my=++stamp;S.entry=null;S.active=-1;S.hits=[];S.error='';
  if(!S.query.trim()){S.loading=false;paintBody();return;}
  S.loading=true;paintBody();abort=new AbortController();const sig=AbortSignal.any([signal,abort.signal]);
  timer=setTimeout(()=>{void read(`search?q=${encodeURIComponent(S.query)}&direction=${S.direction}`,sig).then(d=>{if(my!==stamp||!alive())return;const r=hitsOf(d);S.hits=r.results;S.release=r.release;}).catch(()=>{if(my===stamp&&alive()&&!sig.aborted)S.error=t.unavailable;}).finally(()=>{if(my===stamp&&alive()){S.loading=false;paintBody();}});},debounce);
 }
 async function open(hit){
  const my=++stamp;S.loading=true;S.error='';paintAll();
  try{const pin=S.release?`?release_id=${encodeURIComponent(S.release)}`:'';const d=await read(`entries/${encodeURIComponent(hit.lexeme_id)}${pin}`,signal);if(my!==stamp||!alive())return;S.entry=entryOf(d);S.release=S.entry.release_id;S.expanded=[];}
  catch{if(my===stamp&&alive())S.error=t.unavailable;}
  finally{if(my===stamp&&alive()){S.loading=false;paintAll();}}
 }
 const btn=(text,cls,fn,attrs={})=>{const b=el('button',{type:'button',class:cls,...attrs},text);listen(b,'click',fn,signal);return b;};
 const bodyHost=el('div',{class:'min-w-0'}),errHost=el('div'),barHost=el('div');
 function bar(){
  const i=el('input',{class:'min-h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none','aria-label':t.search,placeholder:t.search,maxlength:'80',role:'combobox','aria-autocomplete':'list','aria-controls':'dictionary-results','aria-expanded':String(S.hits.length>0),'data-dictionary-search':'','data-focus-key':'dp-search'});i.value=S.query;
  listen(i,'input',()=>{S.query=i.value;runSearch();},signal);
  listen(i,'keydown',e=>{if(!S.hits.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();S.active=e.key==='ArrowDown'?Math.min(S.active+1,S.hits.length-1):Math.max(0,S.active-1);paintBody();}if(e.key==='Enter'&&S.hits[S.active>=0?S.active:0]){e.preventDefault();void open(S.hits[S.active>=0?S.active:0]);}},signal);
  return el('div',{class:'flex min-w-0 items-center gap-2 rounded-xl border border-ink-100 bg-paper-raised p-2'},el('span',{'aria-hidden':'true',class:'pl-1 text-ink-500'},'⌕'),i,S.query?btn('×','btn-ghost min-h-11 min-w-11 px-2',()=>{S.query='';runSearch();paintAll();},{'aria-label':t.clear,'data-dictionary-clear':''}):null,
   el('div',{class:'flex shrink-0 gap-1',role:'group','aria-label':t.search},['EN','UZ'].map(l=>btn(l,`${S.direction===l?'btn-primary':'btn-secondary'} min-h-11 px-3`,()=>{S.direction=l;S.release='';runSearch();paintAll();},{'aria-pressed':String(S.direction===l),'data-dictionary-direction':l}))));
 }
 function hitList(){
  if(S.loading)return el('div',{role:'status','aria-label':dict.common.loading,class:'space-y-2'},[0,1,2].map(()=>el('div',{class:'h-20 animate-pulse rounded-xl bg-paper-sunken'})));
  if(!S.query.trim())return el('div',{class:'flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-ink-100 bg-sky-50/40 p-6 text-center sm:min-h-64'},el('span',{'aria-hidden':'true',class:'text-4xl text-sky-600'},'⌕'),el('h2',{class:'text-lg font-semibold'},t.startTitle),el('p',{class:'max-w-md text-sm text-ink-500'},t.startHint));
  return el('div',{},el('h2',{class:'mb-2 text-sm font-semibold'},t.results),!S.error&&S.hits.length===0?el('p',{class:'card p-5','data-dictionary-empty':''},t.empty):null,
   el('ul',{id:'dictionary-results',role:'listbox','aria-label':t.results,class:'space-y-2'},S.hits.map((h,i)=>{
    const b=btn('','w-full rounded-xl border bg-paper-raised p-3 text-left '+(S.active===i?'border-signal-600':'border-ink-100'),()=>void open(h),{'data-dictionary-hit':h.lexeme_id});
    put(b,el('span',{class:'flex min-w-0 items-start gap-2'},el('span',{class:'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1'},el('strong',{class:'break-words text-base'},h.display_lemma),el('span',{class:'rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-700'},dictionaryPos(h.part_of_speech))),el('span',{'aria-hidden':'true'},'›')),el('span',{class:'mt-1 block truncate text-sm text-ink-500'},h.translation_uz));
    return el('li',{role:'option','aria-selected':String(S.active===i),id:`dictionary-hit-${i}`},b);})));
 }
 function senseView(e,s,i){
  const open=S.expanded.includes(s.sense_id),custom=e.attribution.some(a=>a.source_name==='Learners Area');
  const head=el('h3',{},btn('','flex min-h-14 w-full items-start gap-3 p-4 text-left',()=>{S.expanded=open?S.expanded.filter(x=>x!==s.sense_id):[...S.expanded,s.sense_id];paintAll();},{'aria-expanded':String(open),'aria-controls':`dictionary-sense-${s.sense_id}`,'data-dictionary-sense-toggle':s.sense_id}));
  put(head.firstChild,el('span',{'aria-hidden':'true',class:'text-sky-600'},open?'⊖':'⊕'),el('strong',{class:'min-w-0 flex-1 break-words text-base'},`${i+1}. ${s.translations.map(x=>x.text).join(' · ')}`),el('span',{'aria-hidden':'true'},open?'⌃':'⌄'));
  const ex=x=>el('blockquote',{class:'rounded-lg bg-paper-sunken p-3'},el('p',{},el('span',{class:'mr-2 text-xs font-semibold text-sky-700'},t.exampleEn),x.text_en),el('p',{class:'mt-1 text-sm text-ink-500'},el('span',{class:'mr-2 text-xs font-semibold'},t.exampleUz),x.text_uz));
  const tags=[s.cefr,s.register,s.usage_label,...s.domain_tags].filter(Boolean);
  return el('section',{class:'overflow-hidden rounded-xl border border-ink-100 bg-paper-raised','data-dictionary-sense':s.sense_id},head,open?el('div',{id:`dictionary-sense-${s.sense_id}`,class:'space-y-4 px-4 pb-5 sm:px-5 lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-6 lg:space-y-0'},
   el('div',{class:'max-w-[70ch] space-y-4'},el('div',{},el('h4',{class:'mb-1 text-sm font-semibold'},t.english),el('p',{class:'text-base leading-relaxed'},s.definition_en)),el('div',{},el('h4',{class:'mb-1 text-sm font-semibold text-sky-700'},t.definition),el('p',{class:'text-base leading-relaxed'},s.definition_uz)),
    s.examples.length?el('div',{},el('h4',{class:'mb-2 text-sm font-semibold'},t.examples),el('div',{class:'space-y-2'},s.examples.slice(0,2).map(ex))):null,
    s.examples.length>2?el('details',{class:'rounded-lg border border-ink-100 p-3'},el('summary',{class:'min-h-11 cursor-pointer py-2 font-semibold'},t.moreExamples),s.examples.slice(2).map(x=>el('div',{class:'mt-2'},ex(x)))):null),
   el('div',{class:'space-y-3'},el('p',{class:'text-sm text-ink-500'},custom?t.custom:t.upstream),btn(t.edit,'btn-primary w-full',()=>onEdit?.(e,s),{'data-dictionary-edit':s.sense_id}),el('div',{class:'flex flex-wrap gap-2'},tags.map(x=>el('span',{class:'rounded-lg bg-paper-sunken px-2 py-1 text-xs text-ink-700'},x))))):null);
 }
 function entryView(){
  const e=S.entry,all=e.senses.every(s=>S.expanded.includes(s.sense_id)),syn=e.relations.filter(r=>['synonym','synonymy'].includes(r.relation_type.toLowerCase())),rel=e.relations.filter(r=>!['synonym','synonymy'].includes(r.relation_type.toLowerCase()));
  const relBtn=r=>btn('','btn-secondary',()=>void open({lexeme_id:r.target_lexeme_id,display_lemma:r.display_lemma}),{'data-dictionary-relation':r.target_lexeme_id});
  const section=(label,rows)=>rows.length?el('details',{class:'card p-4'},el('summary',{class:'min-h-11 cursor-pointer py-2 font-semibold'},label),el('div',{class:'flex flex-wrap gap-2'},rows.map(r=>{const b=relBtn(r);put(b,r.display_lemma+' ',el('span',{class:'text-xs'},dictionaryPos(r.part_of_speech)));return b;}))):null;
  return el('article',{class:'space-y-4','data-dictionary-entry':e.lexeme_id},el('nav',{class:'flex min-h-11 items-center gap-2 text-sm','aria-label':t.allSenses},btn(t.back,'btn-ghost',()=>{stamp++;S.entry=null;S.loading=false;paintAll();},{'data-dictionary-back':''}),el('span',{'aria-hidden':'true'},'›'),el('span',{class:'truncate'},e.display_lemma)),
   el('header',{class:'flex flex-wrap items-start justify-between gap-4'},el('div',{class:'min-w-0'},el('h2',{class:'break-words text-3xl font-bold sm:text-4xl'},e.display_lemma),el('div',{class:'mt-2 flex flex-wrap items-center gap-2 text-sm'},e.pronunciations.map(p=>el('span',{class:'text-ink-500'},`/${p.ipa}/`)),el('span',{class:'rounded-lg bg-sky-50 px-2 py-1 text-sky-700'},dictionaryPos(e.part_of_speech)),el('span',{class:'rounded-lg bg-paper-sunken px-2 py-1 text-ink-700'},e.lexical_type.replaceAll('_',' ')))),btn(all?t.collapseAll:t.expandAll,'btn-primary min-h-11',()=>{S.expanded=all?[]:e.senses.map(s=>s.sense_id);paintAll();},{'data-dictionary-expand-all':''})),
   el('div',{class:'space-y-3'},e.senses.map((s,i)=>senseView(e,s,i))),btn(t.addSense,'btn-secondary',()=>onAddSense?.(e),{'data-dictionary-add-sense':''}),
   e.forms.length?el('details',{class:'card p-4'},el('summary',{class:'min-h-11 cursor-pointer py-2 font-semibold'},t.forms),el('p',{class:'leading-relaxed'},e.forms.map(f=>f.surface_form).join(' · '))):null,
   e.collocations.length?el('details',{class:'card p-4'},el('summary',{class:'min-h-11 cursor-pointer py-2 font-semibold'},t.collocations),el('div',{class:'flex flex-wrap gap-2'},e.collocations.map(c=>el('span',{class:'rounded-lg bg-paper-sunken px-3 py-2'},c.text)))):null,
   section(t.synonyms,syn),section(t.relations,rel),el('details',{class:'text-xs text-ink-500'},el('summary',{class:'min-h-11 cursor-pointer py-3'},t.attribution),e.attribution.map(a=>el('p',{class:'mb-2 max-w-[85ch] break-words leading-relaxed'},a.attribution_text))));
 }
 function paintBody(){
  const inp=barHost.querySelector('[data-dictionary-search]');if(inp){inp.setAttribute('aria-expanded',String(S.hits.length>0));if(S.active>=0)inp.setAttribute('aria-activedescendant',`dictionary-hit-${S.active}`);else inp.removeAttribute('aria-activedescendant');}
  setChildren(errHost,S.error?el('div',{role:'alert',class:'card flex flex-wrap items-center gap-3 p-4','data-dictionary-error':''},el('p',{},S.error),btn(t.retry,'btn-secondary',()=>{S.entry=null;S.release='';S.retry++;runSearch();paintAll();},{'data-dictionary-retry':''})):null);
  setChildren(bodyHost,S.entry?entryView():hitList());
 }
 function paintAll(){setChildren(barHost,S.entry?null:bar());paintBody();}
 setChildren(node,barHost,errHost,bodyHost,btn(t.custom,'btn-secondary',()=>onAddWord?.(),{'data-dictionary-add-word':''}));paintAll();
 return node;
}
