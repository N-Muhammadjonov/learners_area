// Deterministic synthetic DOM/CPU benchmark. These timings are NOT browser INP.
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const base=resolve(process.argv[2]??'frontend/vanilla');
const output=process.argv[3];
const {setup,ID}=await import(pathToFileURL(resolve(base,'tests/staff-final30/harness.mjs')));
const {mountExam}=await import(pathToFileURL(resolve(base,'modules/reading/exam.js')));
const runs=20,edits=50,rows=[],originalFetch=globalThis.fetch;
for(let run=0;run<runs;run++){
 const h=setup({path:'/app/reading/attempts/'+ID(99),role:'student'});
 let created=0,replacements=0,removed=0,detached=0,focusLoss=0,selectionLoss=0;
 const timings=[];
 try{
  globalThis.fetch=async()=>new Response('{}',{status:200});
  const questions=Array.from({length:40},(_,i)=>({id:ID(i+1),order:i+1,questionNo:i+1,type:'short_answer',typeCode:null,renderMode:null,answerConstraint:null,questionText:'Synthetic question '+(i+1),options:[],groupId:null}));
  mountExam(h.ctx,{attemptId:ID(99),passageTitle:'Synthetic passage',passageBody:'Synthetic fixture only.',passageMeta:null,questions,groups:[],paragraphs:[],savedAnswers:{},startedAt:new Date().toISOString(),suggestedMinutes:60,parts:[0,1,2].map(i=>({title:'Passage '+(i+1),body:'Synthetic fixture only.',paragraphs:[],questionIds:questions.slice(i*13,i===2?40:(i+1)*13).map(q=>q.id),groupIds:[]}))});
  const make=document.createElement.bind(document),makeNS=document.createElementNS.bind(document);
  document.createElement=(...args)=>{created++;return make(...args);};
  document.createElementNS=(...args)=>{created++;return makeNS(...args);};
  const observer=new window.MutationObserver(()=>{});observer.observe(h.ctx.root,{subtree:true,childList:true});
  for(let n=0;n<edits;n++){
   const field=h.q('#answer-'+ID(1));field.focus();field.value='synthetic-'+n;field.setSelectionRange(2,4);
   const start=performance.now();field.dispatchEvent(new window.Event('input',{bubbles:true}));timings.push(performance.now()-start);
   const current=h.q('#answer-'+ID(1));
   detached+=Number(field!==current);focusLoss+=Number(document.activeElement!==current);selectionLoss+=Number(current.selectionStart!==2||current.selectionEnd!==4);
   for(const r of observer.takeRecords()){
    replacements+=Number(r.target.id==='reading-questions-pane'&&r.removedNodes.length>0);
    for(const node of r.removedNodes)removed+=1+(node.querySelectorAll?.('*').length??0);
   }
  }
  observer.disconnect();rows.push({run,created,replacements,removed,detached,focusLoss,selectionLoss,timings});
 }finally{h.dispose();globalThis.fetch=originalFetch;}
}
const times=rows.flatMap(r=>r.timings).sort((a,b)=>a-b),quantile=p=>times[Math.ceil(times.length*p)-1];
const total=key=>rows.reduce((n,r)=>n+r[key],0);
const result={method:'jsdom synthetic event dispatch; no browser layout/paint; not INP',node:process.version,runs,editsPerRun:edits,samples:times.length,latencyMs:{p50:quantile(.5),p95:quantile(.95),p99:quantile(.99)},createdElements:total('created'),questionsPaneReplacements:total('replacements'),removedNodes:total('removed'),inputIdentityChanges:total('detached'),focusLoss:total('focusLoss'),selectionLoss:total('selectionLoss'),rows};
if(output)writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,rows:undefined},null,2));
