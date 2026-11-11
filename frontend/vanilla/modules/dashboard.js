import {el} from '../js/dom.js';
import {anySignal} from '../js/signals.js';
import {viewData,viewSnapshot,requireFields} from '../js/adapters/frontend.js';
import {dashboardDTO,openLessonsDTO,mockDTO} from '../js/adapters/dashboard.js';
import {RegionFailureNotice} from './shared/presentation.js';
import {mountSequenceDashboard} from './study-plan/sequence-view.js';
import {fluencyCompanion} from './speaking/fluency-art.js';
/** Three independent reads/DOM lifetimes. Nested lessons may arrive before summary.
 * No settled private cache or fabricated fallback data; route signal owns all work. */
export async function mount(context){
 const {root,dict,signal,url}=context,overview=['/app','/app/dashboard'].includes(url.pathname);
 const {render}=await import(overview?'../js/generated/dashboard.js':'../js/generated/mocks.js');if(signal.aborted)return;
 const inFlight=new Map();const slots={},renderers={},states={},scope={slots,renderers,dict,locale:context.locale,user:context.session.user};
 const retryRegion=region=>load(region==='dashboard-open-lessons'?'openLessons':region.startsWith('dashboard-')?'dashboard':'mock',{fresh:true});
 scope.context={...context,retryRegion};const host=el('div',{'data-dashboard-native':''},render(scope));root.append(host);
 const validators={dashboard:dashboardDTO,openLessons:openLessonsDTO,mock:mockDTO},fields={dashboard:'dashboard',openLessons:'openLessonsResult',mock:'mock'};
 function paint(key){const slot=slots[key],state=states[key];if(!slot||!state||signal.aborted)return;
  slot.setAttribute('aria-busy',String(state.pending));if(state.pending)return;
  if(state.error){const notice=RegionFailureNotice({region:key==='openLessons'?'dashboard-open-lessons':key==='dashboard'?'dashboard-summary':'mock-overview',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:()=>load(key,{fresh:true})});slot.replaceChildren(notice,...(key==='dashboard'&&slots.openLessons?[slots.openLessons]:[]));return;}
  slot.replaceChildren(renderers[key]());
 }
 async function load(key,{fresh=false}={}){if(signal.aborted||inFlight.has(key))return;const request=new AbortController(),requestSignal=anySignal([signal,request.signal]);inFlight.set(key,request);
  const route=url.pathname+url.search,snapshot=viewSnapshot(route,key);let shown=false;
  if(snapshot)try{requireFields(snapshot.data,[fields[key]]);scope[fields[key]]=validators[key](snapshot.data[fields[key]]);states[key]={pending:false};paint(key);shown=true;}catch{}
  if(shown&&!snapshot.stale&&!fresh){inFlight.delete(key);return;}
  if(!shown){states[key]={pending:true};paint(key);}
  try{const data=await viewData(route,requestSignal,key,{fresh:fresh||shown});if(requestSignal.aborted)return;requireFields(data,[fields[key]]);
   // A V2 aggregate mock projection omitted finishedCount. Derive only from
   // server-supplied finishedAt facts; never fabricate attempts or outcomes.
   let dto=data[fields[key]];if(key==='mock'&&dto?.finishedCount===undefined&&Array.isArray(dto?.attempts))dto={...dto,finishedCount:dto.attempts.filter(a=>a.finishedAt).length};
   scope[fields[key]]=validators[key](dto);states[key]={pending:false};paint(key);
  }catch(error){if(!requestSignal.aborted){states[key]={pending:false,error:true};paint(key);}}finally{if(inFlight.get(key)===request)inFlight.delete(key);}
 }
 // Start roadmap beside both siblings, not behind their response/render work.
 const keys=overview?['openLessons','dashboard','mock']:['mock'];for(const key of keys)void load(key);
 if(overview && ['student','owner'].includes(context.session.user.role)){
  const hero=host.querySelector('.la-dashboard-hero');
  const heading=hero?.querySelector('h1');
  if(hero){
   const top=el('div',{'class':'la-dashboard-top-grid','data-dashboard-top-grid':''});
   hero.replaceWith(top);
   top.append(hero);
   if(heading){
   const mascot=fluencyCompanion();
   const shortcut=el('a',{
     href:'/app/speaking/speak-or-die',
     class:'la-dashboard-companion-link',
     'data-dashboard-companion-link':'',
     'aria-label':context.locale==='uz'?'Speak or Die mashqini ochish':'Open Speak or Die',
   },mascot.node);
   mascot.node.classList.add('la-dashboard-companion');
   heading.after(shortcut);
  }
  mountSequenceDashboard(context,top);
  }
 }
 context.onPause?.(()=>{for(const request of inFlight.values())request.abort();inFlight.clear();});
 context.onResume?.(()=>{for(const key of keys)void load(key);});
}
/** Code-only intent prewarm; no private DTO or attempt query. */
export function preload(url){return import(['/app','/app/dashboard'].includes(url.pathname)?'../js/generated/dashboard.js':'../js/generated/mocks.js');}
