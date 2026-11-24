import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {
  SEQUENCE_API, ASSIGNMENTS_PATH, validateSequence,
  mountSequenceAssignments, mountSequenceDashboard,
} from '../modules/study-plan/sequence-view.js';

const KINDS=['grammar','reading','listening','writing','speaking','vocabulary'];
const MINUTES=[25,30,25,20,10,10];
const start=new Date('2026-11-12T00:00:00.000Z');
let dom,controller,request,host;
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

function activePlan(currentDay=1,completedDays=0,totalDays=30) {
  return {
    state:'active',cycleId:'fixture',totalDays,currentDay,completedDays,
    revision:1,level:'B2',startedOn:'2026-11-12',today:'2026-11-12',
    days:Array.from({length:totalDays},(_,index)=>{
      const day=index+1;
      const status=day<currentDay?'completed':day===currentDay?'active':'locked';
      return {day,date:new Date(start.getTime()+index*86400000).toISOString().slice(0,10),
        status,minutes:120,tasks:KINDS.map((kind,slot)=>{
          const taskStatus=status==='completed'?'completed':status==='locked'?'locked':'ready';
          return {slot,kind,title:kind+' exercise',minutes:MINUTES[slot],
            stage:kind==='grammar'?0:null,status:taskStatus,
            href:taskStatus==='ready'?'/app/'+kind:null};
        })};
    }),
  };
}
const context=(role='student')=>({
  root:host,dict:{common:{loading:'Loading'}},locale:'en',
  signal:controller.signal,session:{user:{id:'fixture',role,name:'Learner One'}},
  url:new URL('https://learners.invalid/app/assignments#study-plan-30'),
});
beforeEach(()=>{
  dom=new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',
    {url:'https://learners.invalid/app/assignments',pretendToBeVisual:true});
  globalThis.window=dom.window;
  globalThis.document=dom.window.document;
  globalThis.Node=dom.window.Node;
  globalThis.HTMLElement=dom.window.HTMLElement;
  controller=new AbortController();
  host=document.getElementById('root');
  request=api.request;
});
afterEach(()=>{controller.abort();api.request=request;dom.window.close();});

test('validated plan requires exactly thirty consistent days and never exposes locked URLs',()=>{
  const valid=activePlan();
  assert.equal(validateSequence(valid),valid);
  const unlocked=structuredClone(valid);
  unlocked.days[2].tasks[1].href='/app/listening';
  assert.throws(()=>validateSequence(unlocked),/locked_route_exposed/);
  const external=structuredClone(valid);
  external.days[0].tasks[0].href='https://foreign.invalid/steal';
  assert.throws(()=>validateSequence(external),/invalid_unlocked_task/);
  const malformed=structuredClone(valid);
  malformed.days[0].tasks[0].minutes=90;
  assert.throws(()=>validateSequence(malformed),/invalid_workload/);
  assert.throws(()=>validateSequence({...valid,totalDays:60}),/invalid_plan/);
  assert.equal(validateSequence(activePlan(1,0,7)).days.length,7);
});

test('owner weekly workload and daily verified retention remain separate from student plan',async()=>{
  const data=activePlan();
  const light=[25,35,25,40,20,35];
  const heavy=[25,90,85,90,70,60];
  for(const day of data.days){
    const budget=day.day%2?light:heavy;
    day.tasks.forEach((task,index)=>{task.minutes=budget[index];});
    day.minutes=day.tasks.reduce((sum,task)=>sum+task.minutes,0);
    day.retention={
      requiredReviews:10,reviewDays:[1,3,7,16].filter(n=>n<day.day),
      previousTopics:day.day>1?['Topic 1: Art']:[],
      minutesIncludedInVocabulary:day.tasks[5].minutes,
      status:day.tasks[5].status,
      href:day.status==='active'?'/app/vocabulary?tab=revision':null,
      gamesHref:day.status==='active'?'/app/vocabulary/games':null,
    };
  }
  assert.equal(validateSequence(data),data);
  api.request=async()=>data;
  mountSequenceAssignments(context('owner'),host);
  await flush();
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,30);
  assert.match(host.textContent,/alternate 3-hour light and 7-hour heavy study steps/);
  assert.match(host.textContent,/Vocabulary SRS/);
  assert(host.querySelector('[data-sequence-task-kind="vocabulary"] [data-sequence-srs]'),
    'SRS must be nested under Vocabulary rather than shown as a separate Retention pane');
  assert.equal(host.querySelector('[data-sequence-retention-open]').getAttribute('href'),
    '/app/vocabulary?tab=revision');
  assert.equal(host.querySelector('[data-sequence-retention-games]').getAttribute('href'),
    '/app/vocabulary/games');
  const broken=structuredClone(data);
  broken.days[1].retention.href='/app/vocabulary?tab=revision';
  assert.throws(()=>validateSequence(broken),/invalid_retention/);
  broken.days[1].retention.href=null;
  broken.days[1].retention.gamesHref='/app/vocabulary/games';
  assert.throws(()=>validateSequence(broken),/invalid_retention/);
});


test('owner curriculum displays actual daily Retention and date-bound Article/TED alongside embedded SRS',async()=>{
  const data=activePlan();
  for(const day of data.days){
    const weekday=new Date(day.date+'T00:00:00Z').getUTCDay();
    const course=[1,3,5].includes(weekday),sunday=weekday===0;
    const budgets=course?[15,20,33,40,40,20]:sunday?
      [20,70,80,90,90,50]:[20,68,67,90,90,40];
    day.tasks.forEach((task,index)=>{task.minutes=budgets[index];});
    const minutes=course?12:sunday?20:15;
    const status=day.status==='active'?'ready':day.status==='completed'?'completed':'locked';
    const level=day.day<=10?'A2':day.day<=20?'B1':'B2';
    day.tasks.push({slot:6,kind:'retention',title:'Retention — '+level+' blind recall',
      href:status==='ready'?'/app/reading/retention?level='+level:null,
      status,stage:null,minutes});
    if([3,5].includes(day.day)){
      const article=day.day===3,kind=article?'article':'video';
      const link=article?'/app/reading/articles/advertising':
        '/app/video-lessons/d4bf7b1f-2281-46b2-a044-c456bb1326cb';
      day.tasks[article?1:2].minutes-=20;
      day.tasks.push({slot:7,kind,
        title:article?'Article — Advertising':'TED — Better Cities',
        href:status==='ready'?link:null,status,stage:null,minutes:20});
    }
    day.minutes=day.tasks.reduce((sum,task)=>sum+task.minutes,0);
    day.retention={requiredReviews:10,reviewDays:[1,3,7,16].filter(n=>n<day.day),
      previousTopics:day.day>1?['Topic 1: Food']:[],
      minutesIncludedInVocabulary:day.tasks[5].minutes,status:day.tasks[5].status,
      href:status==='ready'?'/app/vocabulary?tab=revision':null,
      gamesHref:status==='ready'?'/app/vocabulary/games':null};
  }
  assert.equal(validateSequence(data),data);
  api.request=async()=>data;
  mountSequenceAssignments(context('owner'),host);
  await flush();
  assert.equal(host.querySelectorAll('[data-sequence-task-open]').length,7);
  assert.equal(host.querySelector('[data-sequence-task-open="retention"]').getAttribute('href'),
    '/app/reading/retention?level=A2');
  assert(host.querySelector('[data-sequence-task-kind="vocabulary"] [data-sequence-srs]'));
  assert.equal(host.querySelectorAll('[data-sequence-day="3"] .sequence-day-dots i').length,8);
  assert.equal(host.querySelectorAll('[data-sequence-day="5"] .sequence-day-dots i').length,8);
  assert.equal(host.querySelector('[data-sequence-day="3"]').disabled,true);
  const invalid=structuredClone(data);
  invalid.days[1].tasks[6].href='/app/reading/retention?level=B2';
  assert.throws(()=>validateSequence(invalid),/locked_route_exposed/);
  invalid.days[1].tasks[6].href=null;
  for (const level of ['B1','B2','C1']) {
    invalid.days[0].tasks[6].href='/app/reading/retention?level='+level;
    assert.equal(validateSequence(invalid),invalid);
  }
  invalid.days[0].tasks[6].href='/app/reading/retention?level=C2';
  assert.throws(()=>validateSequence(invalid),/invalid_retention_route/);
});

test('calendar shows thirty dates, six ready tasks and disabled future days',async()=>{
  const paths=[];
  api.request=async path=>{paths.push(path);return activePlan();};
  mountSequenceAssignments(context(),host);
  await flush();
  assert.deepEqual(paths,[SEQUENCE_API]);
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,30);
  assert.equal(host.querySelectorAll('[data-sequence-day]:disabled').length,29);
  assert.equal(host.querySelectorAll('[data-sequence-task-open]').length,6);
  assert.equal(host.querySelector('[data-sequence-day="1"]').getAttribute('aria-pressed'),'true');
  host.querySelector('[data-sequence-day="2"]').click();
  assert.equal(host.querySelector('[data-sequence-day="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(host.querySelector('[data-sequence-task-open="grammar"]').getAttribute('href'),'/app/grammar');
  assert.equal(host.querySelector('[data-study-plan-30]').id,'study-plan-30');
});

test('regeneration demands confirmation and preserves current-day progress',async()=>{
  const calls=[];
  api.request=async(path,options={})=>{
    calls.push({path,method:options.method??'GET',body:options.body});
    if(path.endsWith('/regenerate'))return {...activePlan(2,1),revision:2};
    return activePlan(2,1);
  };
  mountSequenceAssignments(context(),host);
  await flush();
  host.querySelector('[data-sequence-day="1"]').click();
  assert.equal(host.querySelector('[data-sequence-task-open]'),null,
    'completed day cannot restart an old task');
  const buttons=()=>[...host.querySelectorAll('button')];
  const replan=()=>buttons().find(button=>button.textContent==='Regenerate plan');
  replan().click();
  assert.equal(calls.filter(call=>call.method==='POST').length,0);
  buttons().find(button=>button.textContent==='Cancel').click();
  assert.equal(calls.filter(call=>call.method==='POST').length,0);
  replan().click();
  buttons().find(button=>button.textContent==='Confirm').click();
  await flush();
  assert.deepEqual(calls.filter(call=>call.method==='POST'),[
    {path:SEQUENCE_API+'/regenerate',method:'POST',body:{confirmed:true,days:30}},
  ]);
  assert.equal(host.querySelector('[data-sequence-day="2"]').getAttribute('aria-pressed'),'true');
});

test('available plan starts through authenticated POST and displays new calendar',async()=>{
  const calls=[];
  api.request=async(path,options={})=>{
    calls.push({path,method:options.method??'GET',body:options.body});
    return path.endsWith('/start')?activePlan():{
      state:'available',level:'B2',totalDays:30,dailyMinutes:120,
    };
  };
  mountSequenceAssignments(context(),host);
  await flush();
  host.querySelector('button.btn-primary').click();
  await flush();
  assert.deepEqual(calls,[{path:SEQUENCE_API,method:'GET',body:undefined},
    {path:SEQUENCE_API+'/start',method:'POST',body:{days:30}}]);
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,30);
});

test('missing level offers no silent plan creation',async()=>{
  api.request=async()=>({state:'level_required',choices:['placement_test','profile']});
  mountSequenceAssignments(context(),host);
  await flush();
  assert.match(host.textContent,/Your level is not set/);
  assert.equal(host.querySelector('button.btn-primary'),null);
});

test('dashboard card links to the Assignments plan and uses server completion',async()=>{
  api.request=async()=>activePlan(5,4);
  mountSequenceDashboard(context(),host);
  await flush();
  assert.equal(host.querySelector('[data-dashboard-plan-open]').getAttribute('href'),ASSIGNMENTS_PATH);
  assert(host.querySelector('[data-dashboard-plan-open]').classList.contains('btn-primary'));
  assert.equal(host.querySelector('[data-dashboard-plan-open]').textContent,'Open today’s plan →');
  assert.match(host.textContent,/Day 5 \/ 30/);
  assert.equal(host.querySelector('progress').value,4);
});

test('plan failure is retryable without destroying the surrounding assignments',async()=>{
  let count=0;
  api.request=async()=>{count++;if(count===1)throw Error('network');return activePlan();};
  const existing=document.createElement('section');
  existing.textContent='Teacher assignments remain visible';
  host.append(existing);
  mountSequenceAssignments(context(),host);
  await flush();
  assert.match(host.textContent,/Teacher assignments remain visible/);
  assert.match(host.textContent,/The plan could not be loaded/);
  [...host.querySelectorAll('button')].find(button=>button.textContent==='Retry').click();
  await flush();
  assert.equal(count,2);
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,30);
});

test('teacher and admin permissions do not trigger plan data requests',()=>{
  let calls=0;
  api.request=async()=>{calls++;return activePlan();};
  mountSequenceAssignments(context('teacher'),host);
  mountSequenceDashboard(context('teacher'),host);
  mountSequenceAssignments(context('admin'),host);
  mountSequenceDashboard(context('admin'),host);
  assert.equal(calls,0);
  assert.equal(host.childElementCount,0);
});

test('learner selects seven days before starting and receives seven unlocked/locked dates',async()=>{
  const calls=[];
  api.request=async(path,options={})=>{
    calls.push({path,method:options.method??'GET',body:options.body});
    if(path.endsWith('/start'))return activePlan(1,0,7);
    return {state:'available',level:'B2',totalDays:30,dailyMinutes:120,
      durationOptions:[7,30]};
  };
  mountSequenceAssignments(context(),host);
  await flush();
  const seven=host.querySelector('[data-plan-duration="7"]');
  assert(seven);
  seven.click();
  assert.equal(host.querySelector('[data-plan-duration="7"]').getAttribute('aria-pressed'),'true');
  host.querySelector('button.btn-primary').click();
  await flush();
  assert.deepEqual(calls.at(-1),{path:SEQUENCE_API+'/start',method:'POST',body:{days:7}});
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,7);
  assert.equal(host.querySelectorAll('[data-sequence-day]:disabled').length,6);
  assert.equal(host.querySelectorAll('[data-sequence-task-open]').length,6);
});

test('regenerating an existing plan chooses seven days without reopening completed work',async()=>{
  const posts=[];
  api.request=async(path,options={})=>{
    if(options.method==='POST'){
      posts.push({path,body:options.body});
      return activePlan(2,1,7);
    }
    return activePlan(2,1,30);
  };
  mountSequenceAssignments(context(),host);
  await flush();
  [...host.querySelectorAll('button')].find(b=>b.textContent==='Regenerate plan').click();
  host.querySelector('[data-plan-duration="7"]').click();
  [...host.querySelectorAll('button')].find(b=>b.textContent==='Confirm').click();
  await flush();
  assert.deepEqual(posts,[{path:SEQUENCE_API+'/regenerate',body:{confirmed:true,days:7}}]);
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,7);
  assert.equal(host.querySelector('[data-sequence-day="1"]').dataset.sequenceState,'completed');
  assert.equal(host.querySelector('[data-sequence-day="2"]').dataset.sequenceState,'active');
});

test('shortening a plan cannot erase the current day beyond seven',async()=>{
  api.request=async()=>activePlan(8,7,30);
  mountSequenceAssignments(context(),host);
  await flush();
  [...host.querySelectorAll('button')].find(b=>b.textContent==='Regenerate plan').click();
  assert(host.querySelector('[data-plan-duration="7"]').disabled);
  assert.equal(host.querySelector('[data-plan-duration="30"]').getAttribute('aria-pressed'),'true');
});

test('owner sees 7-day plan on Assignments and Dashboard without staff access escalation',async()=>{
  const calls=[];
  api.request=async path=>{calls.push(path);return activePlan(1,0,7);};
  mountSequenceAssignments(context('owner'),host);
  mountSequenceDashboard(context('owner'),host);
  await flush();
  assert.deepEqual(calls,[SEQUENCE_API,SEQUENCE_API]);
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,7);
  assert.match(host.querySelector('[data-dashboard-30-plan]').textContent,/7-day plan/);
  assert.equal(host.querySelector('[data-dashboard-30-plan] progress').max,7);
});


test('dashboard offers Create plan when no cycle exists, with or without CEFR level',async()=>{
  for(const state of ['available','level_required']){
    host.replaceChildren();
    api.request=async()=>state==='available'
      ? {state:'available',level:'B2',totalDays:30,dailyMinutes:120,durationOptions:[7,30]}
      : {state:'level_required',choices:['placement_test','profile'],durationOptions:[7,30]};
    mountSequenceDashboard(context(),host);
    await flush();
    const link=host.querySelector('[data-dashboard-plan-open]');
    assert(link,'dashboard must show a plan action');
    assert.equal(link.textContent,'Create plan');
    assert.equal(link.getAttribute('href'),ASSIGNMENTS_PATH);
    assert.equal(host.querySelector('[data-dashboard-30-plan] progress'),null);
  }
});

test('daily minimum study-time label appears for both uncreated and active plans',async()=>{
  api.request=async()=>({state:'available',level:'B2',totalDays:30,dailyMinutes:120});
  mountSequenceAssignments(context(),host);
  await flush();
  assert.match(host.textContent,/Minimum daily study time to allocate/);
  host.replaceChildren();
  api.request=async()=>activePlan();
  mountSequenceAssignments(context(),host);
  await flush();
  assert.match(host.textContent,/Minimum daily study time to allocate/);
  assert.match(host.textContent,/Allocate at least 120 minutes each day/);
});

test('overdue dates and rescheduled markers are rendered without unlocking future tasks',async()=>{
  const data=activePlan();
  data.today='2026-11-16';
  for(let i=0;i<data.days.length;i++){
    data.days[i].originalDate=data.days[i].date;
    data.days[i].date=new Date(Date.UTC(2026,10,16+i)).toISOString().slice(0,10);
    data.days[i].rescheduled=i<30;
  }
  api.request=async()=>data;
  mountSequenceAssignments(context(),host);
  await flush();
  const active=host.querySelector('[data-sequence-day="1"]');
  assert.equal(active.dataset.sequenceRescheduled,'true');
  assert.match(active.textContent,/16/);
  assert.match(active.textContent,/↻/);
  assert.equal(host.querySelector('[data-sequence-day="2"]').disabled,true);
  assert.equal(host.querySelectorAll('[data-sequence-task-open]').length,6);
});

test('calendar displays six distinct skill dots and a readable color legend',async()=>{
  api.request=async()=>activePlan();
  mountSequenceAssignments(context(),host);
  await flush();
  const dots=[...host.querySelectorAll('[data-sequence-day="1"] .sequence-day-dots i')];
  assert.deepEqual(dots.map(dot=>dot.dataset.kind),KINDS);
  const legend=[...host.querySelectorAll('.sequence-dots-legend-item i')];
  assert.deepEqual(legend.map(dot=>dot.dataset.kind),KINDS);
  assert.equal(host.querySelectorAll('[data-sequence-day="2"] .sequence-day-dots i[data-state="locked"]').length,6);
});

test('plan opens a book Grammar lesson in a separate focus view but preserves canonical proof URL',async()=>{
  const plan=activePlan();
  plan.days[0].tasks[0].href='/app/grammar/lessons?book=b2-65';
  api.request=async()=>plan;
  mountSequenceAssignments(context(),host);
  await flush();
  const link=host.querySelector('[data-sequence-task-open="grammar"]');
  assert.equal(link.getAttribute('href'),
    '/app/grammar/practice?book=b2-65&from=plan');
  assert.equal(plan.days[0].tasks[0].href,
    '/app/grammar/lessons?book=b2-65');
});

test('dashboard plan button has the same primary style and correct Uzbek label',async()=>{
 api.request=async()=>activePlan();
 const ctx=context();ctx.locale='uz';
 mountSequenceDashboard(ctx,host);
 await flush();
 const action=host.querySelector('[data-dashboard-plan-open]');
 assert(action);
 assert(action.classList.contains('btn-primary'));
 assert.equal(action.textContent,'Bugungi rejani ochish →');
 assert.equal(action.getAttribute('href'),ASSIGNMENTS_PATH);
});
