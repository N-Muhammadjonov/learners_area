import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {api} from '../js/api-client.js';
import {studentPlanInline,planSummary} from '../modules/staff-final30/student-plan-inline.js';
import {mount as staffStudentEntry} from '../modules/staff-final30/staff-student-entry.js';
import {managementAreas} from '../modules/staff-final30/management-hub.js';

const STUDENT=ID(31);
const days=Array.from({length:7},(_,i)=>({
 day:i+1,date:`2026-11-${String(13+i).padStart(2,'0')}`,
 status:i===0?'completed':i===1?'active':'locked',
 tasks:Array.from({length:6},(_,n)=>({
  kind:['grammar','reading','listening','writing','speaking','vocabulary'][n],
  title:`Task ${i+1}.${n+1}`,
  status:i===0||i===1&&n<3?'completed':i===1?'ready':'locked',
  minutes:20,
 })),
}));
const sample={studentId:STUDENT,name:'Sample Learner',state:'active',trackedStudySeconds:7260,
 plan:{state:'active',level:'B2',totalDays:7,currentDay:2,completedDays:1,days}};

test('daily plan summary shows real counts, started-day average and tracked study time',()=>{
 const h=setup({path:'/app/teacher/students/'+STUDENT,role:'teacher',locale:'uz'});
 try{
  const n=planSummary(h.ctx,sample);
  document.querySelector('#root').append(n);
  assert.equal(n.querySelector('[data-plan-inline-metric="days"]').textContent.includes('1 / 7'),true);
  assert.match(n.querySelector('[data-plan-inline-metric="tasks"]').textContent,/9 \/ 42/);
  assert.match(n.querySelector('[data-plan-inline-metric="average"]').textContent,/75%/);
  assert.match(n.querySelector('[data-plan-inline-metric="duration"]').textContent,/2 soat 1 daqiqa/);
  assert.equal(n.querySelectorAll('[data-plan-inline-day]').length,7);
  assert.equal(n.querySelectorAll('[data-plan-task-kind]').length,42);
  assert(n.textContent.includes('server tomonidan qayd etilgan'));
  assert.equal(n.querySelector('a[href*="study-plans"]'),null);
 }finally{h.dispose();}
});

for(const role of ['owner','teacher','admin']){
 test(`${role} reads verified daily plan directly inside a student page`,async()=>{
  const h=setup({path:'/app/admin/people/'+STUDENT,role,locale:'uz'});
  const original=api.request,calls=[];
  try{
   api.request=async path=>{calls.push(path);return sample;};
   const root=studentPlanInline(h.ctx,STUDENT);h.ctx.root.append(root);
   await tick(6);
   assert.deepEqual(calls,['/api/study-plan/monthly/sequence/staff/'+STUDENT]);
   assert.equal(root.querySelectorAll('[data-plan-inline-day]').length,7);
   assert.match(root.querySelector('h2').textContent,/Sample Learner/);
   assert.equal(root.querySelector('a'),null);
  }finally{api.request=original;h.dispose();}
 });
}

test('daily plan fetch error never redirects away from student results or logs out',async()=>{
 const h=setup({path:'/app/teacher/students/'+STUDENT,role:'teacher',locale:'uz'});
 const original=api.request;let requests=0;
 try{
  api.request=async()=>{requests++;throw Object.assign(new Error('not_found'),{status:404});};
  h.ctx.root.append(studentPlanInline(h.ctx,STUDENT));
  await tick(6);
  assert.equal(requests,1);
  assert(h.q('[data-student-plan-inline] [role=alert]'));
  assert.deepEqual(h.nav,[]);
  h.click(h.q('[data-student-plan-inline] button'));
  await tick(4);
  assert.equal(requests,2);
  assert.deepEqual(h.nav,[]);
 }finally{api.request=original;h.dispose();}
});

test('admins open only their bounded plan view; the existing owner full view stays separate',async()=>{
 const h=setup({path:'/app/admin/people/'+STUDENT,role:'admin',locale:'uz'});
 const original=api.request;
 try{
  api.request=async()=>sample;
  await staffStudentEntry(h.ctx);
  await tick(5);
  assert(h.q('[data-admin-student-plan]'));
  assert(h.q('[data-student-plan-inline]'));
  assert.equal(h.q('[data-student-full-review]'),null);
  assert.equal(h.q('[data-student-plan-inline] [data-plan-inline-day]')!==null,true);
 }finally{api.request=original;h.dispose();}
});

test('Guardians follow People/Students in the Management menu for every staff role',()=>{
 for(const role of ['owner','admin','teacher']){
  const h=setup({role,locale:'uz'});
  try{
   const paths=managementAreas(h.ctx.dict,role).map(x=>x.href);
   const anchor=role==='teacher'?'/app/teacher/students':'/app/admin/people';
   assert.equal(paths.indexOf('/app/management/guardians'),paths.indexOf(anchor)+1);
   assert.equal(paths.filter(x=>x==='/app/management/guardians').length,1);
  }finally{h.dispose();}
 }
});
