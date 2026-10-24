import {anySignal} from '../../js/signals.js';
import {el,listen,mountStaff,put,setChildren} from './kit.js';
import {READING_SOURCE_ACCEPT,readReadingSource,parseGeneralReadingBundle,sendReadingImport} from '../../js/adapters/staff-final30/reading-import.js';
const fold=s=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
/** Source: components/import/ReadingTryout.tsx — preview exercises are local only; nothing is published by trying them. */
function tryout(dict,bundle,signal){
 const t=dict.importPreview,parsed=parseGeneralReadingBundle(bundle);if(!parsed.success)return el('p',{role:'alert'},t.invalid);
 const rows=parsed.data.passages,S={passage:0,answers:{},checked:false},host=el('section',{class:'space-y-4 rounded-2xl border border-ink-100 p-4','data-reading-tryout':''});
 const paint=()=>{const cur=rows[S.passage]??rows[0];
  const qs=cur.questions.map(q=>{const key=`${cur.passageNo}:${q.questionNo}`,ans=S.answers[key]??'',ok=[q.answer,...q.accepted].map(fold).includes(fold(ans));
   const opts=q.options?.length?q.options:q.type==='true_false_not_given'?['TRUE','FALSE','NOT GIVEN']:q.type==='yes_no_not_given'?['YES','NO','NOT GIVEN']:[];
   const ctl=opts.length?el('select',{class:'input mt-2','data-tryout-answer':key},el('option',{value:''},t.choose),opts.map(o=>el('option',{value:/^([A-Z])[.)\s]/.exec(o)?.[1]??o},o))):el('input',{class:'input mt-2','data-tryout-answer':key});ctl.value=ans;
   listen(ctl,opts.length?'change':'input',()=>{S.answers[key]=ctl.value;},signal);
   return el('div',{class:'space-y-2'},el('label',{},`${q.questionNo}. ${q.text}`,ctl),S.checked?el('p',{'data-tryout-result':ok?'correct':'wrong'},`${ok?'✓':'✗'} ${q.answer} ${q.explanation}`):null);});
  const check=el('button',{type:'button',class:'btn-secondary','data-tryout-check':''},t.check),reset=el('button',{type:'button',class:'btn-secondary ml-2','data-tryout-reset':''},t.reset);
  listen(check,'click',()=>{S.checked=true;paint();},signal);listen(reset,'click',()=>{S.answers={};S.checked=false;paint();},signal);
  setChildren(host,el('h2',{class:'text-xl font-semibold'},t.title),el('p',{class:'text-sm text-ink-500'},t.hint),
   el('nav',{class:'flex flex-wrap gap-2','aria-label':t.passages},rows.map((p,i)=>{const b=el('button',{type:'button',class:i===S.passage?'btn-primary':'btn-secondary','data-tryout-passage':String(p.passageNo)},p.title);listen(b,'click',()=>{S.passage=i;S.checked=false;paint();},signal);return b;})),
   el('div',{class:'grid gap-5 xl:grid-cols-2'},el('article',{class:'whitespace-pre-wrap'},el('h3',{class:'font-semibold'},cur.title),cur.body),el('div',{class:'space-y-4'},qs)),
   cur.vocabulary.length?el('details',{},el('summary',{},t.vocabulary),el('ul',{},cur.vocabulary.map(w=>el('li',{class:'mt-2'},el('strong',{},w.word),` (${w.pos}) · ${w.def} · ${w.uz}`,el('p',{},w.ex))))):null,check,reset);};
 paint();return host;
}
/** Source: admin/reading/import/page.tsx + components/admin/ReadingImport.tsx. One long-lived widget (the file input must survive repaints). */
export const mount=mountStaff({name:'reading-import',roles:['admin','owner'],load:async()=>({}),
 render(ctx){
  const {dict,signal}=ctx,t=dict.readingImport;
  if(ctx.state.readingImportNode)return ctx.state.readingImportNode;
  const W={source:null,bundle:null,name:'',error:'',busy:false,result:null,active:null,flight:false};
  const node=el('div',{class:'card space-y-4','data-reading-import':''}),body=el('div',{class:'space-y-4'});
  const input=el('input',{class:'mt-2 block',type:'file',accept:READING_SOURCE_ACCEPT,'data-reading-import-file':''});
  const importBtn=el('button',{type:'button',class:'btn-primary min-h-11','data-reading-import-send':''},t.import);
  const ok=()=>W.bundle&&parseGeneralReadingBundle(W.bundle).success;
  function paint(){
   input.disabled=W.busy;importBtn.disabled=!W.bundle||W.busy||!!W.result||!ok();
   const r=W.result;
   setChildren(body,W.name?el('p',{class:'text-sm','data-reading-import-name':''},W.name):null,
    W.source?.kind==='supplemental'?el('div',{role:'status',class:'space-y-2','data-reading-import-supplemental':''},el('p',{},t.supplemental),el('a',{class:'btn-secondary',href:'/app/admin/materials'},t.manageMaterials),W.source.textPreview?el('pre',{class:'max-h-48 overflow-auto rounded bg-paper-sunken p-2 text-xs whitespace-pre-wrap'},W.source.textPreview):null):null,
    W.source?.kind==='structured'?tryout(dict,W.source.bundle,signal):null,W.error?el('p',{role:'alert',class:'text-red-700','data-reading-import-error':''},W.error):null,
    el('div',{class:'flex flex-wrap gap-2'},importBtn),
    r?el('div',{role:'status','data-reading-import-result':''},el('p',{},r.dryRun?t.checked:r.created?t.created:t.exists),el('ul',{class:'text-sm'},r.passages.map(p=>el('li',{},t.passageLine.replace('{n}',String(p.passageNo)).replace('{resolved}',String(p.resolved)).replace('{unresolved}',String(p.unresolved))))),!r.dryRun?el('a',{class:'btn-secondary',href:'/app/admin/reading'},t.backToList):null):null);
  }
  async function pick(file){
   W.active?.abort();const c=new AbortController(),link=anySignal([signal,c.signal]);W.active=c;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;c.abort();},ctx.readingSourceTimeoutMs??30000);
   W.busy=true;W.error='';W.result=null;W.bundle=null;W.source=null;W.name=file.name;paint();
   try{const cancelled=new Promise((_,rej)=>link.addEventListener('abort',()=>rej(new DOMException('Aborted','AbortError')),{once:true}));const parsed=await Promise.race([readReadingSource(file,link,{readPdfTextLayer:ctx.readPdfTextLayer}),cancelled]);if(W.active!==c||link.aborted)return;W.source=parsed;if(parsed.kind==='structured')W.bundle=parsed.bundle;}
   catch{if(W.active===c)W.error=timedOut?t.errors.unknown:t.errors.invalid_bundle;}
   finally{clearTimeout(timer);if(W.active===c){W.active=null;W.busy=false;}if(!signal.aborted)paint();}
  }
  async function send(dry){
   if(!W.bundle||W.busy||W.flight)return;W.flight=true;const c=new AbortController(),link=anySignal([signal,c.signal]);W.active=c;W.busy=true;W.error='';paint();
   try{const res=await sendReadingImport(W.bundle,dry,link);if(W.active!==c||link.aborted)return;W.result=res;}
   catch(e){if(W.active===c&&!link.aborted)W.error=t.errors[e.code]??t.errors.unknown;}
   finally{W.flight=false;if(W.active===c){W.active=null;W.busy=false;}if(!signal.aborted)paint();}
  }
  listen(input,'change',()=>{const f=input.files?.[0];if(f)void pick(f);},signal);listen(importBtn,'click',()=>void send(false),signal);
  signal.addEventListener('abort',()=>W.active?.abort(),{once:true});
  put(node,el('h1',{class:'font-display text-xl'},t.title),el('p',{},t.intro),el('label',{class:'block'},t.fileLabel,input),body);paint();
  ctx.state.readingImportNode=node;return node;
 }});
