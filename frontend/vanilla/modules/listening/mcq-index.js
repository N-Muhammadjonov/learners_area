import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {render} from '../../js/generated/views/listening-mcq.js';
import {BackLink,RegionFailureNotice} from '../shared/presentation.js';

export function programDTO(data){
 const count=n=>Number.isSafeInteger(n)&&n>=0;
 if(!data||!Array.isArray(data.days)||data.days.length>24||!count(data.page)||data.page<1||typeof data.hasNextPage!=='boolean'||!count(data.visibleDays)||!data.progress||['daysPublished','daysCompleted','questionsPublished','questionsCompleted'].some(k=>!count(data.progress[k])))throw Error('invalid_mcq_program');
 const seen=new Set();
 for(const day of data.days){if(!day||!count(day.day)||day.day<1||seen.has(day.day)||!uuid(day.testId)||typeof day.title!=='string'||typeof day.draft!=='boolean'||!count(day.questionCount)||!day.status||!count(day.status.total)||!count(day.status.completed)||day.status.completed>day.status.total||day.status.total!==day.questionCount||!['not_started','in_progress','completed'].includes(day.status.state))throw Error('invalid_mcq_day');seen.add(day.day);}
 return data;
}

export function mount(context){
 const {root,url,dict,signal}=context,t=dict.listening.mcqProgram;
 const host=el('main',{class:'mx-auto flex max-w-5xl flex-col gap-5','data-native-mcq-index':''});root.append(host);
 let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   const data=programDTO(await viewData(url.pathname+url.search,signal));if(signal.aborted)return;
   const p=data.progress;
   const heading=el('header',{},BackLink({fallbackHref:'/app/listening',label:dict.listening.practiceTitle}),el('h1',{class:'page-title'},'🎯 '+t.title),el('p',{class:'body-text'},t.subtitle),el('p',{class:'text-sm text-ink-500','data-listening-mcq-days-published':p.daysPublished},t.daysPublished.replace('{published}',String(p.daysPublished))),p.daysPublished?el('p',{class:'text-sm text-ink-500','data-listening-mcq-days-completed':p.daysCompleted},t.daysCompleted.replace('{done}',String(p.daysCompleted)).replace('{available}',String(p.daysPublished))):null);
   const cards=render({...data,dict,user:context.session.user,context});
   const nav=el('nav',{class:'flex justify-between gap-3','aria-label':dict.common.next});
   if(data.page>1)nav.append(el('a',{class:'btn-secondary',href:`/app/listening/mcq?page=${data.page-1}`},dict.people.previousPage));
   if(data.hasNextPage)nav.append(el('a',{class:'btn-secondary',href:`/app/listening/mcq?page=${data.page+1}`},dict.people.nextPage));
   host.replaceChildren(heading,cards,nav);
  }catch{if(!signal.aborted)host.replaceChildren(RegionFailureNotice({region:'listening-mcq',message:dict.common.error,retryLabel:dict.common.retry,refresh:load}));}
  finally{busy=false;}
 }
 void load();
}
