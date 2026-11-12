import {test,afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {mount} from '../modules/staff-final30/study-plans.js';

const STUDENT='00000000-0000-4000-8000-000000000001';
let dom,controller,root,original;
const ctx=(role,query='')=>({
  root,signal:controller.signal,locale:'uz',
  session:{user:{role,id:'actor'}},
  dict:{common:{loading:'Yuklanmoqda',back:'Back',retry:'Qayta urinish'},
    errors:{notFound:'Topilmadi'},auth:{errorServer:'Server xatosi'},
    errorPage:{retry:'Qayta urinish'}},
  url:new URL('https://fixture.invalid/app/management/study-plans'+query),
  navigate:path=>{root.dataset.redirect=path;},
});
const sample={
  page:1,pageSize:25,hasMore:false,
  students:[{studentId:STUDENT,name:'Existing Learner',state:'active',
    level:'B2',totalDays:7,currentDay:2,completedTasks:8,
    totalTasks:42,currentCompleted:2,currentTotal:6}],
};
beforeEach(()=>{
  dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{
    url:'https://fixture.invalid/app/management/study-plans'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.Node=dom.window.Node;globalThis.HTMLElement=dom.window.HTMLElement;
  controller=new AbortController();root=document.querySelector('main');
  original=api.request;
});
afterEach(()=>{
  controller.abort();api.request=original;dom.window.close();
});

test('owner, teacher, and admin all have a visible verified plan progress view',async()=>{
  for(const role of ['owner','admin','teacher']){
    root.replaceChildren();
    const calls=[];
    api.request=async path=>{calls.push(path);return sample;};
    await mount(ctx(role));
    assert.deepEqual(calls,['/api/study-plan/monthly/sequence/staff?page=1']);
    const row=root.querySelector('[data-plan-staff-student]');
    assert(row);
    assert.equal(row.querySelector('a').textContent,'Existing Learner');
    assert.match(row.textContent,/2 \/ 6/);
    assert.match(row.textContent,/8 \/ 42/);
    assert(row.querySelector('a').getAttribute('href').includes(STUDENT));
  }
});

test('student account cannot fetch staff records',async()=>{
  let calls=0;
  api.request=async()=>{calls++;return sample;};
  await mount(ctx('student'));
  assert.equal(calls,0);
  assert.equal(root.dataset.redirect,'/app');
});

test('staff student detail shows each of six server-verified daily tasks and all dates',async()=>{
  const kinds=['grammar','reading','listening','writing','speaking','vocabulary'];
  api.request=async path=>{
    assert(path.endsWith('/staff/'+STUDENT));
    return {studentId:STUDENT,name:'Existing Learner',state:'active',plan:{
      state:'active',level:'B2',totalDays:7,currentDay:1,
      days:Array.from({length:7},(_,i)=>({
        day:i+1,status:i===0?'active':'locked',date:'2026-11-'+String(15+i).padStart(2,'0'),
        tasks:kinds.map((kind,k)=>({
          kind,title:kind+' lesson',status:i===0&&k<2?'completed':i===0?'ready':'locked',
        })),
      })),
    }};
  };
  await mount(ctx('teacher','?student='+STUDENT));
  assert.equal(root.querySelectorAll('[data-staff-plan-task-list] li').length,6);
  assert.equal(root.querySelectorAll('[data-staff-plan-calendar] [data-staff-plan-day]').length,7);
  assert.match(root.textContent,/2\/6/);
  assert.match(root.textContent,/Existing Learner/);
});

test('uncreated plan is shown as uncreated, without fabricated progress',async()=>{
  api.request=async()=>({
    page:1,pageSize:25,hasMore:false,
    students:[{studentId:STUDENT,name:'Existing Learner',state:'uncreated',
      level:null,totalDays:null,currentDay:null,
      completedTasks:0,totalTasks:0,currentCompleted:0,currentTotal:0}],
  });
  await mount(ctx('admin'));
  assert.match(root.textContent,/Reja yaratilmagan/);
  assert.equal(root.querySelector('progress'),null);
});
