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

function activePlan(currentDay=1,completedDays=0) {
  return {
    state:'active',cycleId:'fixture',totalDays:30,currentDay,completedDays,
    revision:1,level:'B2',startedOn:'2026-11-12',today:'2026-11-12',
    days:Array.from({length:30},(_,index)=>{
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
    {path:SEQUENCE_API+'/regenerate',method:'POST',body:{confirmed:true}},
  ]);
  assert.equal(host.querySelector('[data-sequence-day="2"]').getAttribute('aria-pressed'),'true');
});

test('available plan starts through authenticated POST and displays new calendar',async()=>{
  const calls=[];
  api.request=async(path,options={})=>{
    calls.push({path,method:options.method??'GET'});
    return path.endsWith('/start')?activePlan():{
      state:'available',level:'B2',totalDays:30,dailyMinutes:120,
    };
  };
  mountSequenceAssignments(context(),host);
  await flush();
  host.querySelector('button.btn-primary').click();
  await flush();
  assert.deepEqual(calls,[{path:SEQUENCE_API,method:'GET'},
    {path:SEQUENCE_API+'/start',method:'POST'}]);
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
  assert.match(host.textContent,/Day 5 \/ 30/);
  assert.equal(host.querySelector('progress').value,4);
});

test('plan failure is retryable without destroying the surrounding assignments',async()=>{
  let count=0;
  api.request=async()=>{count++;if(count===1)throw Error('network');return activePlan();};
  host.append(document.createElement('section')).textContent='Teacher assignments remain visible';
  mountSequenceAssignments(context(),host);
  await flush();
  assert.match(host.textContent,/Teacher assignments remain visible/);
  assert.match(host.textContent,/The plan could not be loaded/);
  [...host.querySelectorAll('button')].find(button=>button.textContent==='Retry').click();
  await flush();
  assert.equal(count,2);
  assert.equal(host.querySelectorAll('[data-sequence-day]').length,30);
});

test('staff permissions do not trigger plan data requests',()=>{
  let calls=0;
  api.request=async()=>{calls++;return activePlan();};
  mountSequenceAssignments(context('teacher'),host);
  mountSequenceDashboard(context('teacher'),host);
  assert.equal(calls,0);
  assert.equal(host.childElementCount,0);
});
