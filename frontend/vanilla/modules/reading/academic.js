import {answerProgress} from '../shared/progress.js';
import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {api} from '../../js/api-client.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {readingAcademicCatalogueDTO,readingAcademicSetDTO} from '../../js/adapters/reading-v44.js';
import {RegionFailureNotice,Button} from '../shared/presentation.js';
import {EmptyState} from '../../js/generated/ui.js';
import {missing} from '../listening/catalogue-v9.js';
import {failure} from '../../js/request-errors.js';
/** Original src/app/app/(shell)/reading/academic/page.tsx: the Academic catalogue, one card per set. */
export function mountAcademicCatalogue(context){
 const {root,url,signal,dict}=context,host=el('div',{'data-native-view':'reading-academic'});root.append(host);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;
  host.replaceChildren(el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,'data-async-loading':'reading-academic-sets',class:'h-32 animate-pulse rounded-xl bg-ink-50'}));
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   const {sets}=readingAcademicCatalogueDTO(raw);const page=Math.max(1,Math.min(10000,parseInt(url.searchParams.get('page')??'1',10)||1));
   host.replaceChildren(el('div',{class:'mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5','data-route-usable':'reading-academic'},
    el('p',{class:'body-text'},dict.readingHub.academicExamHint),
    sets.length===0?EmptyState({icon:'▤',title:dict.readingHub.academicEmpty,body:dict.readingHub.academicExamHint}):null,
    el('div',{class:'grid gap-4 sm:grid-cols-2 lg:grid-cols-3'},sets.slice(0,24).map(set=>el('article',{class:'card flex flex-col gap-3 p-5','data-academic-set':set.id,'data-academic-locked':String(set.locked)},
     el('h2',{class:'card-title'},set.title),
     set.locked?null:el('ol',{},set.passages.map(p=>el('li',{},`${dict.generalReading.passageN.replace('{n}',String(p.passageNo))}: ${p.title}`))),
     answerProgress({state:set.assessmentStatus,done:set.answeredCount,total:set.totalQuestions,label:set.assessmentStatus==='completed'?dict.readingHub.stateCompleted:set.assessmentStatus==='in_progress'?dict.readingHub.stateInProgress:dict.readingHub.stateNotStarted,attrs:{'data-academic-state':set.assessmentStatus}}),
     set.locked?el('p',{'data-academic-locked-hint':true},`🔒 ${dict.readingHub.lockedHint}`):el('a',{class:'btn-primary self-start',href:set.attemptId?`/app/reading/attempts/${set.attemptId}`:`/app/reading/academic/${set.id}`},set.assessmentStatus==='completed'?dict.readingV4.review:set.attemptId?dict.readingHub.actionResume:dict.readingV4.open))))));const nav=el('nav',{class:'flex gap-3','aria-label':dict.readingHub.page});if(page>1)nav.append(el('a',{class:'btn-secondary',href:`?page=${page-1}`,rel:'prev'},dict.readingHub.prevPage));if(sets.length>24)nav.append(el('a',{class:'btn-secondary',href:`?page=${page+1}`,rel:'next'},dict.readingHub.nextPage));host.append(nav);
  }catch(e){
   if(signal.aborted)return;
   if(e.status===404){host.replaceChildren(missing(dict));return;}
   host.replaceChildren(RegionFailureNotice({region:'reading-academic',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
/** Original src/app/app/(focus)/reading/academic/[setId]/page.tsx: the intro for one Academic test and its start. */
export function mountAcademicSet(context){
 const {root,url,signal,dict}=context,setId=url.pathname.split('/')[4],host=el('div',{'data-native-view':'reading-academic-set'});root.append(host);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   if(!uuid(setId)){host.replaceChildren(missing(dict));return;}
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   if(raw.kind==='not_found'){host.replaceChildren(missing(dict));return;}
   const set=readingAcademicSetDTO(raw,setId);
   const start=Button({variant:'primary','data-passage-action':'start',children:dict.generalReading.full});
   const message=el('span',{class:'text-[0.8125rem] text-band-bad','data-passage-action-error':true});
   message.hidden=true;
   start.addEventListener('click',async()=>{
    start.disabled=true;message.hidden=true;
    try{const result=await api.request('/api/reading/academic',{method:'POST',body:{setId},signal});
     if(result?.id){void context.navigate(`/app/reading/attempts/${result.id}`);return;}
     message.textContent=dict.errors.unknown;message.hidden=false;
    }catch(e){if(signal.aborted)return;message.textContent=failure(e,dict,{unknown:dict.errors.unknown});message.hidden=false;}
    finally{if(!signal.aborted)start.disabled=false;}
   },{signal});
   host.replaceChildren(el('div',{class:'reading-exam-intro','data-academic-reading-start':true},
    el('h1',{class:'page-title'},set.title),
    el('p',{class:'body-text'},dict.readingHub.academicExamHint),
    el('ol',{class:'grid gap-3'},set.passages.map(section=>el('li',{class:'card p-4'},
     el('span',{class:'meta-text'},dict.generalReading.passageN.replace('{n}',String(section.passageNo))),
     el('h2',{class:'card-title'},section.title)))),
    el('span',{class:'flex flex-col items-start gap-1'},start,message)));
  }catch(e){
   if(signal.aborted)return;
   if(e.status===404){host.replaceChildren(missing(dict));return;}
   host.replaceChildren(RegionFailureNotice({region:'reading-academic-set',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
