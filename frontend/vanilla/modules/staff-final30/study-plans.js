/** Scoped staff view of server-verified sequenced learning plans. */
import {api} from '../../js/api-client.js';
import {el,mountStaff,BackLink,heading,pageParam} from './kit.js';

const API='/api/study-plan/monthly/sequence/staff';
const roles=['teacher','admin','owner'];
const title=ctx=>ctx.locale==='uz'?'O‘quvchilar o‘quv rejalari':'Learner study plans';
const label=(ctx,uz,en)=>ctx.locale==='uz'?uz:en;
const URL_ROOT='/app/management/study-plans';
const stateLabel=(ctx,state)=>({
  active:label(ctx,'Davom etmoqda','In progress'),
  completed:label(ctx,'Yakunlangan','Completed'),
  locked:label(ctx,'Qulflangan','Locked'),
  ready:label(ctx,'Boshlanmagan','Not started'),
  uncreated:label(ctx,'Reja yaratilmagan','No plan yet'),
})[state]??'—';
const currentText=(ctx,row)=>row.state==='uncreated'
  ?stateLabel(ctx,'uncreated')
  :label(ctx,'Kun ','Day ')+row.currentDay+' / '+row.totalDays;
const link=(row,page)=>URL_ROOT+'?'+new URLSearchParams({student:row.studentId,page:String(page)});
function progressRow(ctx,row,page){
  const finished=row.state==='uncreated'?null:
    el('progress',{max:row.totalTasks,value:row.completedTasks,
      'aria-label':label(ctx,'Yakunlangan mashqlar','Completed exercises')});
  return el('tr',{'data-plan-staff-student':row.studentId,class:'border-b border-ink-100'},
    el('th',{scope:'row',class:'py-3 pr-3 text-left'},
      el('a',{href:link(row,page),class:'underline font-semibold'},row.name)),
    el('td',{class:'py-3 pr-3'},row.level??'—'),
    el('td',{class:'py-3 pr-3'},currentText(ctx,row)),
    el('td',{class:'py-3 pr-3'},row.state==='uncreated'?'—':
      row.currentCompleted+' / '+row.currentTotal),
    el('td',{class:'py-3 pr-3 min-w-40'},finished,
      row.state==='uncreated'?'—':row.completedTasks+' / '+row.totalTasks));
}
function listView(ctx,data){
  const page=data.page,href=n=>URL_ROOT+'?page='+n;
  return el('div',{class:'max-w-6xl mx-auto space-y-4','data-staff-plan-list':''},
    BackLink({fallbackHref:'/app/management',label:ctx.dict.common.back}),
    heading(title(ctx),label(ctx,
      'O‘quvchilarning tasdiqlangan kunlik mashqlari. Bajarilmagan kunlar keyingi sanaga ko‘chadi.',
      'Verified daily progress. Unfinished days roll forward without losing work.')),
    data.students.length?el('div',{class:'overflow-x-auto card p-4'},
      el('table',{class:'w-full text-left text-sm min-w-[680px]'},
        el('thead',{},el('tr',{},
          [label(ctx,'O‘quvchi','Learner'),label(ctx,'Daraja','Level'),
           label(ctx,'Joriy kun','Current day'),label(ctx,'Bugungi mashqlar','Current exercises'),
           label(ctx,'Jami progress','Overall progress')]
            .map(x=>el('th',{scope:'col',class:'pb-2 pr-3'},x)))),
        el('tbody',{},data.students.map(x=>progressRow(ctx,x,page)))))
      :el('p',{class:'card p-5'},label(ctx,'O‘quvchilar mavjud emas.','No learners available.')),
    el('nav',{class:'flex justify-between items-center gap-3','aria-label':'Pages'},
      page>1?el('a',{class:'btn-secondary',href:href(page-1)},
        label(ctx,'Oldingi','Previous')):el('span',{}),
      el('span',{},String(page)),
      data.hasMore?el('a',{class:'btn-secondary',href:href(page+1)},
        label(ctx,'Keyingi','Next')):el('span',{})));
}
function detailView(ctx,data){
  const plan=data.plan;
  if(!plan)return el('div',{class:'max-w-5xl mx-auto space-y-4','data-staff-plan-detail':''},
    BackLink({fallbackHref:URL_ROOT,label:ctx.dict.common.back}),
    heading(data.name,title(ctx)),
    el('p',{class:'card p-4'},stateLabel(ctx,'uncreated')));
  const day=plan.days[Math.max(0,plan.currentDay-1)];
  const status=kind=>({
    completed:label(ctx,'Bajarilgan','Completed'),
    ready:label(ctx,'Boshlanmagan','Not completed'),
    locked:label(ctx,'Qulflangan','Locked'),
  })[kind];
  const completed=day.tasks.filter(t=>t.status==='completed').length;
  return el('div',{class:'max-w-6xl mx-auto space-y-5','data-staff-plan-detail':''},
    BackLink({fallbackHref:URL_ROOT,label:ctx.dict.common.back}),
    heading(data.name,plan.level+' · '+plan.totalDays+' '+
      label(ctx,'kunlik reja','day plan')+' · '+stateLabel(ctx,plan.state)),
    el('div',{class:'card p-4 space-y-3'},
      el('h2',{class:'font-semibold text-xl'},currentText(ctx,{
        state:plan.state,currentDay:plan.currentDay,totalDays:plan.totalDays})),
      el('p',{},day.date+' · '+completed+'/6 '+
        label(ctx,'mashq bajarilgan','exercises completed')),
      el('progress',{max:6,value:completed,'aria-label':label(ctx,'Kunlik progress','Daily progress')}),
      el('ul',{class:'grid gap-2 sm:grid-cols-2','data-staff-plan-task-list':''},
        day.tasks.map(task=>el('li',{
          class:'border rounded-lg border-ink-100 p-3 flex justify-between gap-2',
          'data-plan-task-kind':task.kind,'data-plan-task-status':task.status},
          el('span',{},task.title),el('strong',{},status(task.status)))))),
    el('section',{class:'card p-4 space-y-3'},
      el('h2',{class:'font-semibold text-lg'},label(ctx,'Barcha kunlar','All study days')),
      el('div',{class:'grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7','data-staff-plan-calendar':''},
        plan.days.map(row=>el('div',{
          class:'rounded-lg border border-ink-100 p-3 min-w-0',
          'data-staff-plan-day':row.day,'data-staff-plan-status':row.status},
          el('strong',{},label(ctx,'Kun ','Day ')+row.day),
          el('small',{class:'block text-ink-500'},row.date),
          el('small',{class:'block text-ink-500'},stateLabel(ctx,row.status)),
          el('span',{class:'block'},String(row.tasks.filter(t=>t.status==='completed').length)+'/6'))))));
}
export const mount=mountStaff({
  name:'management-study-plans',roles,
  load:ctx=>{
    const student=ctx.url.searchParams.get('student');
    if(student && /^[0-9a-f-]{36}$/i.test(student))
      return api.request(API+'/'+encodeURIComponent(student),{signal:ctx.signal,fresh:true});
    const page=pageParam(ctx.url);
    return api.request(API+'?page='+page,{signal:ctx.signal,fresh:true});
  },
  render:(ctx,data)=>data.students?listView(ctx,data):detailView(ctx,data),
  notFoundBack:{href:URL_ROOT,label:'Plans'},
});
