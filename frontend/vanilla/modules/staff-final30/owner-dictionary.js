import {el,listen,mountStaff,BackLink,put} from './kit.js';
import {dictionaryPanel} from './dictionary-panel.js';
import {dictCall,validateOverview,validateDrafts,validateHistory,validateJob,isDone} from '../../js/adapters/staff-final30/dictionary.js';
/**
 * Source: owner/dictionary/page.tsx + components/vocabulary/OwnerDictionary.tsx. All calls use the EXISTING
 * /api/owner/dictionary/* handlers. The embedded DictionaryPanel (the shared student/owner search surface, 720 lines in
 * Arena's vocabulary scope) is NOT reimplemented: it is an injectable slot `ctx.dictionaryPanel({owner,onEdit,onAddSense,onAddWord})`.
 * The panel is ported (dictionary-panel.js, owner mode); `ctx.dictionaryPanel` may override it.
 */
const POS=['noun','verb','adjective','adverb','preposition','pronoun','determiner','conjunction','interjection'];
const KIND=['word','noun_phrase','verb_phrase','phrasal_verb','idiom','collocation','fixed_expression','compound','technical_term','phrase'];
const MAX_POLL=500;
export const mount=mountStaff({name:'owner-dictionary',roles:['owner'],
 load:async ctx=>{const [s,d,h,j]=await Promise.all([dictCall('summary',undefined,undefined,ctx.signal),dictCall('drafts',undefined,undefined,ctx.signal),dictCall('history',undefined,undefined,ctx.signal),dictCall('publish',undefined,undefined,ctx.signal)]);return {overview:validateOverview(s),drafts:validateDrafts(d),history:validateHistory(h),job:validateJob(j.job)};},
 render(ctx,data,view){
  const {dict,signal}=ctx,t=dict.globalDictionary,S=(ctx.state.ownerDict??={error:'',busy:false,edit:null,editingDraftId:null});
  const errMsg=e=>e?.message==='duplicate_lexeme'?t.duplicateWord:e?.message==='duplicate_sense'?t.duplicateSense:t.unavailable;
  const set=(patch)=>{Object.assign(S,patch);view.rerender();};
  async function guarded(fn){if(S.busy||signal.aborted)return;set({busy:true,error:''});try{await fn();}catch(e){if(!signal.aborted)S.error=errMsg(e);}finally{S.busy=false;if(!signal.aborted)view.rerender();}}
  async function refresh(){await view.reload({quiet:true});}
  const ov=data.overview,job=data.job,running=!!job&&!isDone(job);
  const field=(label,node)=>el('label',{class:'block'},label,node);
  const ta=(key,opts={})=>{const n=el('textarea',{class:'input',maxlength:'6000',...opts});n.value=S.edit[key]??'';listen(n,'input',()=>{S.edit[key]=n.value;},signal);return n;};
  function editForm(){
   const e=S.edit,adding=!e.sense;
   const form=el('form',{class:'card space-y-3 p-5','data-owner-dict-form':''},el('h2',{},e.sense?t.edit:e.entry?t.addSense:t.custom));
   if(!e.entry){
    const lemma=el('input',{class:'input',required:'',maxlength:'120'});lemma.value=e.lemma??'';listen(lemma,'input',()=>{e.lemma=lemma.value;},signal);
    const pos=el('select',{class:'input'},POS.map(x=>el('option',{},x)));pos.value=e.pos;listen(pos,'change',()=>{e.pos=pos.value;},signal);
    const kind=el('select',{class:'input'},KIND.map(x=>el('option',{},x)));kind.value=e.kind;listen(kind,'change',()=>{e.kind=kind.value;},signal);
    put(form,field(t.lemma,lemma),el('label',{},t.pos,pos),el('label',{},t.type,kind));
   }
   put(form,field(t.english,ta('en',{required:'',...(e.sense?{readonly:''}:{})})));if(e.sense)put(form,el('p',{},t.upstream));
   put(form,field(t.translation,ta('uz',{required:''})),field(t.definition,ta('definition',{required:''})),el('h3',{},t.examples));
   e.examples.forEach((x,i)=>{const en=el('textarea',{class:'input',required:'','aria-label':t.english,maxlength:'6000',...(adding?{}:{readonly:''})}),uz=el('textarea',{class:'input',required:'','aria-label':t.translation,maxlength:'6000'});en.value=x.textEn;uz.value=x.textUz;listen(en,'input',()=>{x.textEn=en.value;},signal);listen(uz,'input',()=>{x.textUz=uz.value;},signal);put(form,el('div',{class:'grid gap-2 sm:grid-cols-2'},en,uz));});
   if(adding&&e.examples.length<100){const add=el('button',{type:'button',class:'btn-secondary'},`+ ${t.examples}`);listen(add,'click',()=>{e.examples.push({textEn:'',textUz:''});view.rerender();},signal);put(form,add);}
   const close=el('button',{type:'button',class:'btn-secondary'},dict.vocabulary.add.close);listen(close,'click',()=>set({edit:null,editingDraftId:null}),signal);
   put(form,el('div',{class:'flex gap-2'},el('button',{type:'submit',class:'btn-primary',disabled:S.busy},t.draft),close));
   listen(form,'submit',ev=>{ev.preventDefault();if(!form.checkValidity())return;void guarded(async()=>{
    const ex=e.examples;let changes;
    if(e.sense)changes={operation:'edit_sense',lexemeId:e.entry.lexeme_id,senseId:e.sense.sense_id,translationUz:e.uz,definitionUz:e.definition,examples:ex.map(x=>({exampleId:x.id,textUz:x.textUz}))};
    else if(e.entry)changes={operation:'add_sense',lexemeId:e.entry.lexeme_id,definitionEn:e.en,translationUz:e.uz,definitionUz:e.definition,examples:ex.map(x=>({textEn:x.textEn,textUz:x.textUz}))};
    else changes={operation:'add_lexeme',lemma:e.lemma,partOfSpeech:e.pos,lexicalType:e.kind,definitionEn:e.en,translationUz:e.uz,definitionUz:e.definition,examples:ex.map(x=>({textEn:x.textEn,textUz:x.textUz}))};
    await dictCall(S.editingDraftId?'drafts/'+S.editingDraftId:'drafts',S.editingDraftId?'PATCH':'POST',changes,signal);
    if(signal.aborted)return;S.edit=null;S.editingDraftId=null;await refresh();});},signal);
   return form;
  }
  const blankEdit=(entry,sense)=>({entry,sense,lemma:entry?.display_lemma??'',pos:entry?.part_of_speech??'noun',kind:entry?.lexical_type??'word',en:sense?.definition_en??'',uz:sense?.translations?.[0]?.text??'',definition:sense?.definition_uz??'',examples:sense?.examples?.map(x=>({id:x.example_id,textEn:x.text_en,textUz:x.text_uz}))??[]});
  async function editDraft(d){await guarded(async()=>{const c=d.changes;const entry=c.operation==='add_lexeme'?null:(await dictCall('entries/'+c.lexemeId,'GET',undefined,signal)).entry;if(signal.aborted)return;
   const sense=c.operation==='edit_sense'?entry?.senses?.find(s=>s.sense_id===c.senseId)??null:null;const e=blankEdit(entry,sense);S.editingDraftId=d.id;
   if(c.operation==='add_lexeme'){e.lemma=c.lemma;e.pos=c.partOfSpeech;e.kind=c.lexicalType;}
   if(c.operation!=='edit_sense'){e.en=c.definitionEn;e.examples=(c.examples??[]).map(x=>({textEn:x.textEn??'',textUz:x.textUz??''}));}
   else e.examples=(sense?.examples??[]).map(ex=>({id:ex.example_id,textEn:ex.text_en,textUz:c.examples?.find(x=>x.exampleId===ex.example_id)?.textUz??ex.text_uz}));
   e.uz=c.translationUz??sense?.translations?.[0]?.text??'';e.definition=c.definitionUz??sense?.definition_uz??'';S.edit=e;});}
  async function publish(resume){await guarded(async()=>{let cur=resume?job:validateJob((await dictCall('publish','POST',undefined,signal)).job);if(!cur)throw Error('unavailable');
   let n=0;while(!isDone(cur)){if(signal.aborted)return;if(++n>MAX_POLL)throw Error('unavailable');cur=validateJob((await dictCall('publish/'+cur.id,'POST',undefined,signal)).job);data.job=cur;}
   if(cur.phase==='failed')throw Error(cur.error||'unavailable');await refresh();});}
  const kv=(l,v)=>el('div',{},el('dt',{},l),el('dd',{},String(v)));
  const panelProps={owner:true,onEdit:(entry,sense)=>set({edit:blankEdit(entry,sense),editingDraftId:null}),onAddSense:entry=>set({edit:blankEdit(entry,null),editingDraftId:null}),onAddWord:()=>set({edit:blankEdit(null,null),editingDraftId:null})};
  const panel=(S.panel??=(ctx.dictionaryPanel?.(panelProps)??dictionaryPanel(ctx,panelProps)));
  const publishBtn=el('button',{type:'button',class:'btn-primary',disabled:S.busy||!data.drafts.length||running},t.publish);listen(publishBtn,'click',()=>void publish(false),signal);
  const resumeBtn=running?el('button',{type:'button',class:'btn-secondary',disabled:S.busy},t.resume):null;if(resumeBtn)listen(resumeBtn,'click',()=>void publish(true),signal);
  const rollback=el('button',{type:'button',class:'btn-secondary',disabled:S.busy||!ov.channel.previous_release_id},t.rollback);listen(rollback,'click',()=>void guarded(async()=>{await dictCall('rollback','POST',undefined,signal);if(!signal.aborted)await refresh();}),signal);
  return el('div',{class:'mx-auto max-w-6xl space-y-6','data-owner-dictionary':''},BackLink({fallbackHref:'/app/owner',label:dict.owner.title}),el('h1',{class:'section-title'},t.owner),S.error?el('p',{role:'alert'},S.error):null,
   el('section',{class:'card space-y-3 p-5'},el('h2',{class:'font-display text-xl'},t.overview),
    el('dl',{class:'grid gap-3 sm:grid-cols-3'},[['lexemes',t.lexemes],['senses',t.senses],['examples',t.examplesCount],['search_terms',t.searchTerms]].map(([k,l])=>el('div',{},el('dt',{},l),el('dd',{class:'font-display text-2xl'},ov.release.manifest[k].toLocaleString())))),
    el('p',{class:'break-all'},ov.channel.active_release_id),ov.channel.previous_release_id?el('p',{class:'break-all'},ov.channel.previous_release_id):null,
    el('dl',{class:'grid gap-3 sm:grid-cols-3'},kv(t.customLexemes,ov.custom.lexemes),kv(t.customSenses,ov.custom.senses),kv(t.drafts,ov.drafts),kv(t.indexState,ov.index_state==='validated'?t.validated:t.pending),kv(t.publishedAt,ov.published_at?new Date(ov.published_at).toISOString().slice(0,16).replace('T',' '):'—')),
    el('p',{class:'break-all text-xs'},`SHA-256: ${ov.release.manifest_sha}`)),
   panel,
   S.edit?editForm():null,
   el('section',{class:'card space-y-3 p-5'},el('h2',{class:'font-display text-xl'},t.drafts),
    data.drafts.map(d=>{const ed=el('button',{type:'button',class:'btn-secondary',disabled:S.busy},t.edit),dis=el('button',{type:'button',class:'btn-secondary',disabled:S.busy},t.discard);
     listen(ed,'click',()=>void editDraft(d),signal);listen(dis,'click',()=>void guarded(async()=>{await dictCall('drafts/'+d.id,'DELETE',undefined,signal);if(!signal.aborted)await refresh();}),signal);
     return el('div',{class:'flex flex-wrap justify-between gap-2 border-b border-ink-100 py-2','data-draft':d.id},el('span',{},`${d.changes.operation} · ${d.changes.lemma??d.changes.lexemeId??''}`),ed,dis);}),
    publishBtn,resumeBtn,job?el('p',{role:'status'},`${job.phase==='complete'?t.done:t.working} · ${job.phase}`):null),
   el('section',{class:'card space-y-3 p-5'},el('h2',{class:'font-display text-xl'},t.history),rollback,data.history.map(x=>el('p',{class:'break-all'},`${x.created_at} · ${x.operation} · ${x.result_release_id}`))));
 }});
