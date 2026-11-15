import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mount} from '../modules/staff-final30/academy-leads.js';
import {ID,setup,tick} from './staff-final30/harness.mjs';

const PATH='/app/management/leads';
const API='/api/staff/academy';
const row={id:ID(10),name:'Synthetic Applicant',source:'Website',stage:'trial_completed',
 email:'lead@example.test',course_id:ID(30),revision:4,trial_at:'2026-11-15T07:00:00Z'};

test('CRM filters due work and creates a lead using a stable identifier',async()=>{
 const h=setup({path:PATH+'?mine=true',role:'admin'});
 h.stub({[API+'/leads']:(path,options)=>options.method==='POST'?{id:options.body.id}:
  {leads:[row],stages:{enrolled:3,lost:1},followUpDue:2,hasNext:false}});
 try{
  await mount(h.ctx);
  assert(h.calls.some(call=>call.path.includes('mine=true')));
  assert.match(h.ctx.root.textContent,/75%/);
  assert.match(h.ctx.root.textContent,/Follow-ups due · 2/);
  const form=h.q('[data-academy-lead-form]'),fields=form.querySelectorAll('input');
  fields[0].value='New Applicant';fields[1].value='Website';fields[2].value='a@example.test';
  h.submit(form);h.submit(form);await tick();
  const writes=h.calls.filter(call=>call.method==='POST');
  assert.equal(writes.length,1);
  assert.equal(writes[0].body.email,'a@example.test');
  assert.equal(h.nav.at(-1).path,PATH+'?lead='+writes[0].body.id);
 }finally{h.dispose();}
});

test('completed trial selects existing student and course-matched group for conversion',async()=>{
 const h=setup({path:PATH+'?lead='+row.id,role:'owner'});
 let enroll=false;
 h.stub({
  [API+'/leads/'+row.id]:()=>({lead:enroll?{...row,stage:'enrolled',student_user_id:ID(12)}:row,notes:[],hasNext:false}),
  [API+'/leads/'+row.id+'/convert']:()=>{enroll=true;return {id:row.id};},
  [API+'/lookups/student']:{options:[{id:ID(12),label:'Existing Student'}]},
  [API+'/groups']:{groups:[{id:ID(21),name:'IELTS 1',branch:'Tashkent'}]},
 });
 try{
  await mount(h.ctx);
  const form=h.q('[data-academy-lead-convert]');
  assert(form);
  for(const picker of form.querySelectorAll('fieldset')){
   const buttons=picker.querySelectorAll('button');
   h.click(buttons[0]);await tick();
   h.click(buttons[1]);
  }
  assert(h.calls.some(call=>call.path.includes('courseId='+row.course_id)));
  h.submit(form);h.submit(form);await tick();
  const operations=h.calls.filter(call=>call.method==='POST');
  assert.equal(operations.length,1);
  assert.deepEqual(operations[0].body,{studentId:ID(12),groupId:ID(21),revision:4});
  assert.equal(h.q('[data-academy-lead-convert]'),null);
  assert(h.q('a[href="/app/admin/people/'+ID(12)+'"]'));
 }finally{h.dispose();}
});
