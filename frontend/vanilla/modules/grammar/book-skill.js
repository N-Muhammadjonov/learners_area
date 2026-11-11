import {h} from '../../js/native.js';
import {BackLink} from '../shared/presentation.js';
import {renderInteractiveBook} from './book-runtime.js';
import {skillBookIndex} from './book-skill-index.js';
import {adaptSkillUnit} from './book-skill-adapter.js';
import {api} from '../../js/api-client.js';
import {SEQUENCE_API} from '../study-plan/sequence-view.js';

const TRACKS={
 speaking:{title:'Grammar for Speaking',subtitle:'77 ta IELTS Speaking tuzilmasi va to‘rt bosqichli amaliy mashqlar.',groups:[['pre','Pre-intermediate'],['inter','Intermediate'],['upper','Upper-intermediate'],['advanced','Advanced']]},
 writing:{title:'Grammar for Writing',subtitle:'120 ta Academic Task 1, General Task 1 va Task 2 grammatik darsi.',groups:[['academic','Academic Task 1'],['general','General Task 1'],['task2','Task 2'],['advanced','Advanced Task 2']]}
};

const sourceCache = new Map();
function readSkillSource(track, group) {
  const key = track + ':' + group;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const path = '/modules/grammar/book-skill-source-' + track + '-' + group + '.json';
  let pending;
  pending = fetch(path, {credentials: 'same-origin', cache: 'force-cache',
    headers: {Accept: 'application/json'}})
    .then(response => {
      if (!response.ok) throw Error('Grammar content request failed: ' + response.status);
      return response.json();
    }).then(data => {
      if (!data || !Array.isArray(data.units)) throw Error('Invalid grammar content ' + key);
      return data;
    }).catch(error => {
      if (sourceCache.get(key) === pending) sourceCache.delete(key);
      throw error;
    });
  sourceCache.set(key, pending);
  return pending;
}
/** Static, build-revisioned curriculum only. No private API, answer attempts or scores. */
export async function warmSkillBooks(allowed = () => true) {
  const jobs = Object.entries(TRACKS).flatMap(([track,config]) =>
    config.groups.map(([group]) => [track, group]));
  let cursor = 0;
  const worker = async () => {
    while (allowed() && cursor < jobs.length) {
      const [track,group] = jobs[cursor++];
      try { await readSkillSource(track,group); }
      catch { /* A failed optional warm is retried when the lesson is opened. */ }
    }
  };
  await Promise.all([worker(),worker()]);
}

const localized=(context,uz,en)=>context.locale==='en'?en:uz;
const storageKey=(context,track)=>'la:grammar:'+track+':interactive:v1:'+(context.session?.user?.id||'anonymous');
function ensureStyle(){
 for(const name of ['book.css','book-skill.css']){
  const href='/modules/grammar/'+name;
  if(!document.querySelector('link[href="'+href+'"]'))document.head.append(h('link',{rel:'stylesheet',href}));
 }
}
function progressFor(context,track){
 try{const value=JSON.parse(localStorage.getItem(storageKey(context,track))||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}
}
function countProgress(meta,progress){
 const scores=progress[meta.id]||{};let done=0,total=0;
 for(const [stage,weights] of meta.stageWeights.entries()){
  const checked=scores[stage]||{};
  for(let block=0;block<weights.length;block++){
   total++;
   if(Object.prototype.hasOwnProperty.call(checked,block))done++;
  }
 }
 return {done,total};
}
function courseCard(meta,progress,context,track){
 const count=countProgress(meta,progress);
 const action=count.done===count.total?localized(context,'Tugallangan','Completed'):count.done?localized(context,'Davom etish','Continue'):localized(context,'Boshlash','Start');
 const href='/app/grammar?tab='+encodeURIComponent(track)+'&book='+encodeURIComponent(meta.id);
 return h('article',{class:'grammar-book-card grammar-skill-card','data-grammar-skill-unit':meta.id},
  h('div',{class:'grammar-book-card-top'},h('span',{class:'grammar-book-code'},meta.code+' · '+meta.lessons),h('span',{class:'grammar-book-stage'},localized(context,'4 bosqich','4 stages'))),
  h('h2',{class:'grammar-book-card-title'},meta.title),
  h('p',{class:'grammar-book-card-summary'},meta.summary),
  h('div',{class:'grammar-book-card-bottom'},
   h('span',{class:'grammar-book-progress'},count.done+'/'+count.total+' '+localized(context,'mashq bloki','exercise blocks')),
   h('a',{class:'btn-primary grammar-book-card-link',href,'data-grammar-skill-open':meta.id},action)));
}
export function mountSkillBookCatalog(context,host,track){
 ensureStyle();
 const config=TRACKS[track];if(!config)return;
 const progress=progressFor(context,track);
 const entries=skillBookIndex.filter(item=>item.track===track).map(meta=>({meta,node:courseCard(meta,progress,context,track)}));
 const search=h('input',{type:'search',class:'grammar-book-search',placeholder:localized(context,'Mavzuni qidiring…','Search grammar…'),'aria-label':localized(context,'Qidiruv','Search'),'data-grammar-skill-search':track});
 const searchBox=h('label',{class:'grammar-book-search-box'},h('span',{class:'grammar-book-search-icon','aria-hidden':'true'},'⌕'),search);
 const buttons=config.groups.map(([key,label])=>h('button',{type:'button',class:'btn-secondary grammar-book-level','data-grammar-skill-group':key,'aria-pressed':String(key===config.groups[0][0])},label));
 const groupBox=h('div',{class:'grammar-book-level-group grammar-skill-groups',role:'group','aria-label':localized(context,'Darajalar','Groups')},buttons);
 const grid=h('div',{class:'grammar-book-grid','data-grammar-skill-grid':track},entries.map(entry=>entry.node));
 const count=h('p',{class:'grammar-book-count',role:'status'});
 const empty=h('p',{class:'grammar-book-empty',hidden:true},localized(context,'Hech qanday dars topilmadi.','No lesson matched the search.'));
 let selected=config.groups[0][0];
 const refresh=()=>{
  const needle=search.value.trim().toLocaleLowerCase();let visible=0;
  for(const entry of entries){
   const matches=entry.meta.group===selected&&(entry.meta.title+' '+entry.meta.summary+' '+entry.meta.code).toLocaleLowerCase().includes(needle);
   entry.node.hidden=!matches;if(matches)visible++;
  }
  for(const button of buttons){
   const active=button.dataset.grammarSkillGroup===selected;
   button.setAttribute('aria-pressed',String(active));
   button.classList.toggle('btn-primary',active);
   button.classList.toggle('btn-secondary',!active);
  }
  count.textContent=visible+' '+localized(context,'ta dars','lessons');empty.hidden=visible>0;
 };
 search.addEventListener('input',refresh,{signal:context.signal});
 for(const button of buttons)button.addEventListener('click',()=>{selected=button.dataset.grammarSkillGroup;refresh()},{signal:context.signal});
 host.append(h('section',{class:'grammar-book-catalog grammar-skill-catalog','data-grammar-skill-catalog':track,'data-route-usable':'grammar-skill-'+track},
  h('header',{class:'grammar-book-heading'},h('h1',{},config.title),h('p',{},config.subtitle)),
  h('div',{class:'grammar-book-controls'},searchBox,groupBox),count,grid,empty));
 refresh();
}
export async function mountSkillBookDetail(context,host,track,unitId){
 ensureStyle();
 const meta=skillBookIndex.find(entry=>entry.track===track&&entry.id===unitId);
 const fallback='/app/grammar?tab='+encodeURIComponent(track);
 const back=()=>BackLink({fallbackHref:fallback,label:'Back',className:'btn-ghost grammar-book-back','data-grammar-skill-back':''});
 if(!meta){host.replaceChildren(back(),h('p',{role:'alert'},localized(context,'Dars topilmadi.','Lesson not found.')));return;}
 const status=h('p',{role:'status',class:'grammar-book-count'},localized(context,'Dars yuklanmoqda…','Loading lesson…'));
 const retry=h('button',{type:'button',hidden:true,class:'btn-secondary'},localized(context,'Qayta urinish','Try again'));
 const proofStatus=h('p',{role:'status',class:'grammar-book-count','data-plan-grammar-proof':''});
 let verifying=false;
 const exercise=h('div',{class:'grammar-book-exercise-host','data-grammar-skill-exercise':unitId});
 host.replaceChildren(h('section',{class:'grammar-book-detail grammar-skill-detail','data-route-usable':'grammar-skill-'+track+'-detail','data-grammar-skill-detail':unitId},
  back(),h('span',{class:'grammar-book-code'},meta.code+' · '+meta.lessons),
  h('h1',{class:'grammar-book-detail-title'},meta.title),
  h('p',{class:'grammar-book-detail-summary'},meta.summary),status,retry,proofStatus,exercise));
 const load=async()=>{
  if(context.signal.aborted)return;
  status.hidden=false;retry.hidden=true;
  status.textContent=localized(context,'Dars yuklanmoqda…','Loading lesson…');
  try{
   // Reuse the already warmed, immutable curriculum group without another request.
   const source=await readSkillSource(track,meta.group);
   if(context.signal.aborted)return;
   const raw=source.units.find(item=>item.id===unitId);
   if(!raw)throw Error('Lesson missing: '+unitId);
   const unit=adaptSkillUnit(raw,source.visuals||{});
   const shadow=exercise.shadowRoot||exercise.attachShadow({mode:'open'});
   shadow.replaceChildren();
   const css=document.createElement('link');
   css.rel='stylesheet';css.href='/modules/grammar/book-runtime.css';
   const body=document.createElement('div');body.className='grammar-book';
   body.innerHTML='<nav id="nav" hidden></nav><div id="units"></div>';
   shadow.append(css,body);
   // Keep the original Grammar engine; avoid coin awards for unregistered skill categories.
   renderInteractiveBook(shadow,[unit],context.signal,storageKey(context,track),null,
    async ({unitId:completedUnit,stage,answers})=>{
     if(context.signal.aborted||verifying||completedUnit!==unitId||stage!==0)return;
     verifying=true;proofStatus.textContent=localized(context,
       'Mashqlar tekshirilmoqda…','Verifying plan exercises…');
     try{
      const data=await api.request(SEQUENCE_API,{signal:context.signal,fresh:true});
      if(context.signal.aborted)return;
      const day=data?.days?.[data.currentDay-1];
      const task=day?.tasks?.find(entry=>entry.kind==='grammar');
      const expected='/app/grammar?tab='+encodeURIComponent(track)+'&book='+encodeURIComponent(unitId);
      if(data.state!=='active'||task?.status!=='ready'||task.href!==expected){
       proofStatus.textContent='';
       return;
      }
      const result=await api.request(SEQUENCE_API+'/grammar/verify',{
       method:'POST',signal:context.signal,body:{day:data.currentDay,answers}});
      if(context.signal.aborted)return;
      proofStatus.textContent=localized(context,
       'Grammar vazifasi tasdiqlandi. Assignments’da yangilang.',
       'Grammar task verified. Refresh Assignments.');
      if(!result?.days)throw Error('invalid_plan_response');
     }catch(error){
      if(context.signal.aborted)return;
      proofStatus.textContent=error?.status===422?
       localized(context,'To‘g‘ri javoblar 75% dan kam. Mashqlarni qayta bajaring.',
         'Fewer than 75% of answers were correct. Retry the exercises.'):
       localized(context,'Vazifani tasdiqlab bo‘lmadi. Internetni tekshiring va qayta urinib ko‘ring.',
         'Could not verify the task. Check your connection and retry.');
     }finally{verifying=false;}
    });
   status.hidden=true;
  }catch(error){
   if(context.signal.aborted)return;
   status.textContent=localized(context,'Darsni yuklab bo‘lmadi.','Could not load the lesson.');
   retry.hidden=false;
   console.error('Grammar skill lesson load failed',error);
  }
 };
 retry.addEventListener('click',()=>void load(),{signal:context.signal});
 await load();
}
