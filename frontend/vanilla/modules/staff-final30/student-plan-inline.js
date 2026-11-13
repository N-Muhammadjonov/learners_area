import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';

const ENDPOINT='/api/study-plan/monthly/sequence/staff/';
const STAFF=new Set(['owner','teacher','admin']);
const STATUS={
 completed:['Bajarilgan','Completed'],
 active:['Davom etmoqda','In progress'],
 ready:['Boshlanmagan','Not started'],
 locked:['Qulflangan','Locked'],
};
const nvalue=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const percent=(done,total)=>total?Math.round(Math.min(100,done/total*100)):0;
const duration=(seconds,locale)=>{
 const mins=Math.floor(nvalue(seconds)/60),hours=Math.floor(mins/60);
 return hours
  ? locale==='uz'?`${hours} soat ${mins%60} daqiqa`:`${hours}h ${mins%60}m`
  : locale==='uz'?`${mins} daqiqa`:`${mins}m`;
};
const label=(ctx,uz,en)=>ctx.locale==='uz'?uz:en;
const stateLabel=(ctx,state)=>STATUS[state]?.[ctx.locale==='uz'?0:1]??'—';
const taskCount=day=>(day.tasks??[]).filter(task=>task.status==='completed').length;

function metric(ctx,name,value,tag){
 return el('div',{class:'card flex min-w-0 flex-col gap-1 p-4','data-plan-inline-metric':tag},
  el('span',{class:'text-xs text-ink-500'},name),
  el('strong',{class:'font-display text-2xl text-ink-900'},value));
}

export function planSummary(ctx,data){
 const plan=data.plan;
 if(!plan)return el('p',{class:'card p-5','data-plan-inline-uncreated':''},
  label(ctx,'Bu o‘quvchi hali kunlik reja yaratmagan.','This learner has not created a daily plan yet.'));
 const days=plan.days??[];
 const total=days.reduce((n,day)=>n+(day.tasks??[]).length,0);
 const completed=days.reduce((n,day)=>n+taskCount(day),0);
 const reachedDays=Math.min(days.length,Math.max(0,nvalue(plan.currentDay)));
 const started=days.filter(day=>day.day<=reachedDays);
 const available=started.reduce((n,day)=>n+(day.tasks??[]).length,0);
 const achieved=started.reduce((n,day)=>n+taskCount(day),0);
 const avg=percent(achieved,available);
 const completeDays=days.filter(day=>day.status==='completed').length;
 const tracked=nvalue(data.trackedStudySeconds);
 const summary=el('div',{class:'grid grid-cols-2 gap-3 lg:grid-cols-4','data-plan-inline-summary':''},
  metric(ctx,label(ctx,'Bajarilgan kunlar','Completed days'),`${completeDays} / ${days.length}`,'days'),
  metric(ctx,label(ctx,'Bajarilgan mashqlar','Completed tasks'),`${completed} / ${total}`,'tasks'),
  metric(ctx,label(ctx,'Boshlangan kunlar o‘rtachasi','Average of started days'),avg+'%','average'),
  metric(ctx,label(ctx,'Qayd etilgan o‘qish vaqti','Recorded study time'),duration(tracked,ctx.locale),'duration'));
 const calendar=el('div',{class:'grid gap-3 md:grid-cols-2','data-plan-inline-calendar':''},
  days.map(day=>{
   const done=taskCount(day),count=(day.tasks??[]).length,value=percent(done,count);
   const lines=(day.tasks??[]).map(task=>el('li',{class:'flex items-start justify-between gap-3 py-1','data-plan-task-status':task.status,'data-plan-task-kind':task.kind},
    el('span',{},task.title),el('span',{class:'shrink-0 text-xs text-ink-500'},stateLabel(ctx,task.status))));
   const details=el('details',{class:'mt-3','data-plan-day-tasks':day.day},
    el('summary',{class:'cursor-pointer text-sm font-medium text-ink-700'},
      label(ctx,'Mashqlarni ko‘rish','View exercises')),
    el('ul',{class:'mt-2 divide-y divide-ink-100'},lines));
   return el('article',{class:'card min-w-0 p-4','data-plan-inline-day':day.day,'data-plan-day-status':day.status},
    el('div',{class:'flex flex-wrap items-start justify-between gap-2'},
     el('div',{},el('h3',{class:'font-semibold text-ink-900'},label(ctx,'Kun ','Day ')+day.day),
      el('p',{class:'text-xs text-ink-500'},String(day.date??''))),
     el('span',{class:'badge bg-paper-sunken text-ink-700'},stateLabel(ctx,day.status))),
    el('p',{class:'mt-2 text-sm text-ink-700'},`${done} / ${count} · ${value}%`),
    el('progress',{class:'mt-2 w-full',max:count||1,value:done,
      'aria-label':label(ctx,'Bajarilgan mashqlar','Completed exercises')}),
    details);
  }));
 return el('div',{class:'space-y-4'},summary,
  el('p',{class:'text-xs text-ink-500','data-plan-inline-duration-scope':''},
   label(ctx,'Vaqt: reja boshlanganidan beri saytda server tomonidan qayd etilgan o‘qish daqiqalari. Faqat reja topshiriqlariga ajratilgan vaqt emas.',
    'Time is server-recorded learning activity across the site since the plan started, not time attributed exclusively to plan tasks.')),
  el('h3',{class:'font-display text-lg text-ink-900'},label(ctx,'Kunlar bo‘yicha bajarilish','Progress by day')),
  calendar);
}

/** A self-contained read-only staff panel. A fetch failure never changes the route or session. */
export function studentPlanInline(ctx,studentId){
 const host=el('section',{class:'card min-w-0 space-y-4 p-5','data-student-plan-inline':studentId});
 const title=el('h2',{class:'font-display text-2xl text-ink-900'},
  label(ctx,'Kunlik reja natijalari','Daily plan progress'));
 const status=el('div',{role:'status'},ctx.dict.common.loading);
 host.append(el('div',{class:'flex items-center justify-between gap-3'},title),status);
 if(!STAFF.has(ctx.session?.user?.role)) {
  status.replaceChildren(el('p',{role:'alert'},label(ctx,'Ruxsat yo‘q.','Access denied.')));
  return host;
 }
 let requestId=0;
 async function load(){
  const ticket=++requestId;
  status.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const data=await api.request(ENDPOINT+encodeURIComponent(studentId),{signal:ctx.signal,fresh:true});
   if(ctx.signal.aborted||ticket!==requestId||!host.isConnected)return;
   title.textContent=label(ctx,'Kunlik reja natijalari','Daily plan progress')+
    (typeof data.name==='string'&&data.name.trim()?' · '+data.name.trim():'');
   status.replaceChildren(planSummary(ctx,data));
  }catch(error){
   if(ctx.signal.aborted||ticket!==requestId||!host.isConnected)return;
   const message=el('p',{role:'alert'},label(ctx,
    'Kunlik reja natijalarini olishda xatolik yuz berdi. Talaba ko‘rigi ochiq qoladi.',
    'Could not load daily plan progress. The student view remains open.'));
   const retry=el('button',{type:'button',class:'btn-secondary'},ctx.dict.common.retry);
   listen(retry,'click',()=>void load(),ctx.signal);
   status.replaceChildren(message,retry);
  }
 }
 queueMicrotask(()=>{if(!ctx.signal.aborted&&host.isConnected)void load();});
 return host;
}
