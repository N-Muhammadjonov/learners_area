import {el} from '../js/dom.js';
import {viewData,requireFields} from '../js/adapters/frontend.js';
import {dashboardDTO,openLessonsDTO,mockDTO} from '../js/adapters/dashboard.js';
import {RegionFailureNotice} from './shared/presentation.js';
/** Three independent reads/DOM lifetimes. Nested lessons may arrive before summary.
 * No settled private cache or fabricated fallback data; route signal owns all work. */
export async function mount(context){
 const {root,dict,signal,url}=context,overview=url.pathname==='/app';
 const {render}=await import(overview?'../js/generated/dashboard.js':'../js/generated/mocks.js');if(signal.aborted)return;
 const slots={},renderers={},states={},scope={slots,renderers,dict,locale:context.locale,user:context.session.user};
 const retryRegion=region=>load(region==='dashboard-open-lessons'?'openLessons':region.startsWith('dashboard-')?'dashboard':'mock');
 scope.context={...context,retryRegion};const host=el('div',{'data-dashboard-native':''},render(scope));root.append(host);
 const validators={dashboard:dashboardDTO,openLessons:openLessonsDTO,mock:mockDTO},fields={dashboard:'dashboard',openLessons:'openLessonsResult',mock:'mock'};
 function paint(key){const slot=slots[key],state=states[key];if(!slot||!state||signal.aborted)return;
  slot.setAttribute('aria-busy',String(state.pending));if(state.pending)return;
  if(state.error){slot.replaceChildren(RegionFailureNotice({region:key==='openLessons'?'dashboard-open-lessons':key==='dashboard'?'dashboard-summary':'mock-overview',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:()=>load(key)}));return;}
  slot.replaceChildren(renderers[key]());if(key==='dashboard')paint('openLessons');
 }
 async function load(key){if(signal.aborted||states[key]?.pending)return;states[key]={pending:true};paint(key);
  try{const data=await viewData(url.pathname+url.search,signal,key);if(signal.aborted)return;requireFields(data,[fields[key]]);
   // A V2 aggregate mock projection omitted finishedCount. Derive only from
   // server-supplied finishedAt facts; never fabricate attempts or outcomes.
   let dto=data[fields[key]];if(key==='mock'&&dto?.finishedCount===undefined&&Array.isArray(dto?.attempts))dto={...dto,finishedCount:dto.attempts.filter(a=>a.finishedAt).length};
   scope[fields[key]]=validators[key](dto);states[key]={pending:false};paint(key);
  }catch(error){if(!signal.aborted){states[key]={pending:false,error:true};paint(key);}}
 }
 // Start roadmap beside both siblings, not behind their response/render work.
 for(const key of overview?['openLessons','dashboard','mock']:['mock'])void load(key);
}
/** Code-only intent prewarm; no private DTO or attempt query. */
export function preload(url){return import(url.pathname==='/app'?'../js/generated/dashboard.js':'../js/generated/mocks.js');}
