/** Slice 3: teacher students, student detail (feedback + assignment), support inbox. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as T from '../../modules/staff-final30/teacher.js';
import {createAssignment,sendFeedback} from '../../js/adapters/staff-final30/teacher.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const iso='2026-05-01T10:00:00.000Z';
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
test('students list: renders rows with onboarded flag, Telegram fallback, empty state; student role redirected; teacher allowed',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students'});h.stub({'/api/frontend/staff/teacher-students':envelope('teacher-students',{students:[{id:ID(2),name:'A',email:null,onboardingCompletedAt:iso},{id:ID(3),name:'B',email:'b@example.invalid',onboardingCompletedAt:null}]})});await h.mount({mount:T.studentsMount});
 assert.equal(h.qa('a[href^="/app/teacher/students/"]').length,2);assert(h.ctx.root.textContent.includes('Telegram account'));assert(h.ctx.root.textContent.includes('Onboarded')&&h.ctx.root.textContent.includes('New'));h.dispose();
 h=setup({role:'teacher',path:'/app/teacher/students'});h.stub({'/api/frontend/staff/teacher-students':envelope('teacher-students',{students:[]})});await h.mount({mount:T.studentsMount});assert(h.q('[data-empty-state]'));h.dispose();
 h=setup({role:'student',path:'/app/teacher/students'});h.stub({});await h.mount({mount:T.studentsMount});assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);
});
const detail=(o={})=>envelope('teacher-student',{student:{id:ID(2),name:'Stu',email:null},results:{unavailable:false,testIds:[],attempts:[],practice:{reading:null,listening:null,speaking:null,writing:1}},activation:{wordsActivated:3,averageActivation:0.5,dayStreak:2,lastSession:{accepted:4,attempts:5}},prompts:[{id:ID(30),label:'Task 1 · Charts'}],
 submissions:[{id:ID(40),status:'submitted',category:'Charts',content:'<b>text</b>',evaluation:{overallEstimate:6.5,checkedByName:'RIWI',provenanceLabel:'internal',confidence:0.82,weaknesses:['w1','w2','w3']},feedback:[{id:'f1',source:'teacher',overallBand:7,comment:'good'}]},{id:ID(41),status:'draft',category:'Maps',content:'',evaluation:null,feedback:[]}],...o});
test('student detail: sections render; draft submission has no feedback form; evaluation shows top-2 weaknesses; markup escaped',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students/'+ID(2)});h.stub({'/api/frontend/staff/teacher-student':detail()});await h.mount({mount:T.studentMount});
 assert.equal(h.q('h1').textContent,'Stu');assert(h.q('[data-teacher-activation]').textContent.includes('4/5'));assert.equal(h.qa('b').length,0);
 const s1=h.q('[data-submission="'+ID(40)+'"]'),s2=h.q('[data-submission="'+ID(41)+'"]');assert(s1.textContent.includes('w2')&&!s1.textContent.includes('w3'));assert(s1.textContent.includes('82%'));assert(s1.textContent.includes('good'));
 assert(s1.textContent.includes(dicts.en.teacher.leaveFeedback));assert(!s2.textContent.includes(dicts.en.teacher.leaveFeedback));assert(s2.textContent.includes(dicts.en.coach.noEvaluation));
});
test('student detail: invalid id and 404 (not on roster) show not-found with no data leak; admin can open',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students/xyz'});h.stub({});await h.mount({mount:T.studentMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({role:'teacher',path:'/app/teacher/students/'+ID(9)});h.stub({'/api/frontend/staff/teacher-student':new ApiError(404,'not_found')});await h.mount({mount:T.studentMount});assert(h.q('[data-staff-not-found]'));assert(!h.ctx.root.textContent.includes('Stu'));h.dispose();
 h=setup({role:'admin',path:'/app/teacher/students/'+ID(2)});h.stub({'/api/frontend/staff/teacher-student':detail()});await h.mount({mount:T.studentMount});assert.equal(h.q('h1').textContent,'Stu');
});
test('feedback: required comment, optional band sent as number, success shows sent and refreshes; failure alert; double submit once',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students/'+ID(2)});let n=0,fail=false;h.stub({'/api/frontend/staff/teacher-student':()=>detail(),'/api/teacher/feedback':async(p,o)=>{n++;await tick(2);if(fail)return new ApiError(403,'forbidden');return {ok:true};}});await h.mount({mount:T.studentMount});
 const card=()=>h.q('[data-submission="'+ID(40)+'"]');h.click([...card().querySelectorAll('button')].find(b=>b.textContent===dicts.en.teacher.leaveFeedback));
 const form=card().querySelector('form');h.submit(form);await tick(2);assert.equal(n,0,'empty comment blocked by validity');
 h.input(card().querySelector('textarea'),'nice');h.input(card().querySelector('input[type=number]'),'6.5');fail=true;h.submit(card().querySelector('form'));h.submit(card().querySelector('form'));await tick(8);assert.equal(n,1);assert(card().querySelector('[role=alert]:not([hidden])'));
 fail=false;h.submit(card().querySelector('form'));await tick(8);assert.deepEqual(h.calls.filter(c=>c.path==='/api/teacher/feedback').at(-1).body,{submissionId:ID(40),comment:'nice',overallBand:6.5});assert(card().textContent.includes(dicts.en.teacher.feedbackSent));
});
test('feedback adapter: rejects out-of-range band, empty/oversized comment, non-uuid',async()=>{
 await assert.rejects(()=>sendFeedback({submissionId:ID(1),comment:'x',overallBand:'9.5'}),TypeError);await assert.rejects(()=>sendFeedback({submissionId:ID(1),comment:''}),TypeError);await assert.rejects(()=>sendFeedback({submissionId:ID(1),comment:'x'.repeat(2001)}),TypeError);await assert.rejects(()=>sendFeedback({submissionId:'bad',comment:'x'}),TypeError);
});
test('assignment: loads assignable lazily once; canonical choice pins revision and DROPS prompt link; free-form sends prompt; title min 3',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students/'+ID(2)});let loads=0,bodies=[];
 globalThis.fetch=async(p,o={})=>{if(p==='/api/assignments/assignable'){loads++;return jres(200,{items:[{module:'reading',contentType:'passage',sourceRef:'r1',title:'Passage',versionId:'abcdef0123456789'}]});}if(p==='/api/assignments'){bodies.push(JSON.parse(o.body));return jres(200,{ok:true});}return jres(404,{});};
 h.stub({'/api/frontend/staff/teacher-student':()=>detail()});await h.mount({mount:T.studentMount});assert.equal(loads,0);
 h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.teacher.newAssignment));await tick(6);assert.equal(loads,1);
 const save=()=>h.q('[data-assignment-form] .btn-primary');assert(save().disabled);h.input(h.q('#assignment-title'),'ab');assert(save().disabled);h.input(h.q('#assignment-title'),'  Essay 1 ');assert(!save().disabled);
 h.change(h.q('#assignment-prompt'),ID(30));h.click(save());await tick(8);assert.deepEqual(bodies[0],{title:'Essay 1',description:null,targetUserId:ID(2),relatedWritingPromptId:ID(30)});
 assert(h.q('[data-assignment-form]'),'form stays open after save (source behaviour)');assert.equal(loads,1,'not reloaded');
 h.input(h.q('#assignment-title'),'Canon');h.change(h.q('[data-assignment-content-select]'),'reading:passage:r1');assert(h.q('#assignment-prompt').disabled);assert(h.q('[data-assignment-pinned-revision]').textContent.includes('abcdef01'));
 h.click(save());await tick(8);assert.deepEqual(bodies[1],{title:'Canon',description:null,targetUserId:ID(2),module:'reading',contentType:'passage',sourceRef:'r1',contentVersionId:'abcdef0123456789'});assert(!('relatedWritingPromptId' in bodies[1]));assert(h.ctx.root.textContent.includes(dicts.en.teacher.assignmentCreated));
});
test('assignment: assignable endpoint failure keeps free-form path and shows unavailable; API 403 shows localized message',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students/'+ID(2)});globalThis.fetch=async(p)=>p==='/api/assignments/assignable'?jres(500,{error:'x'}):jres(403,{error:'forbidden'});h.stub({'/api/frontend/staff/teacher-student':()=>detail()});await h.mount({mount:T.studentMount});
 h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.teacher.newAssignment));await tick(6);assert(h.q('[data-assignment-content-unavailable]'));h.input(h.q('#assignment-title'),'Free form');h.click(h.q('[data-assignment-form] .btn-primary'));await tick(8);assert(h.ctx.root.textContent.includes(dicts.en.apiErrors.forbidden));assert(h.q('#assignment-title').value==='Free form');
 await assert.rejects(()=>createAssignment({title:'x',studentId:ID(2)}),TypeError);
});
const rep=(n,status='open')=>({id:ID(n),route:'/app/reading',module:'reading',status,message:'<i>broken</i>',reporterName:'Rep',createdAt:iso,viewport:'390x844',lastErrorCode:'E42'});
test('support inbox: open/resolved states, details line, escaped message, empty state, EN/UZ',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/support',locale:'uz'});h.stub({'/api/frontend/staff/support-inbox':envelope('support-inbox',{reports:[rep(1),rep(2,'resolved')]})});await h.mount({mount:T.supportMount});
 assert.equal(h.qa('[data-report-id]').length,2);assert.equal(h.qa('i').length,0);assert(h.q('[data-report-id="'+ID(1)+'"]').textContent.includes('E42'));assert(h.q('[data-report-id="'+ID(2)+'"] [data-report-resolve]')===null);assert(h.q('[data-report-id="'+ID(1)+'"]').textContent.includes('15:00'));h.dispose();
 h=setup({role:'owner',path:'/app/teacher/support'});h.stub({'/api/frontend/staff/support-inbox':envelope('support-inbox',{reports:[]})});await h.mount({mount:T.supportMount});assert(h.q('[data-empty-state]'));
});
test('support resolve: PATCH without body then quiet refetch; 409 already resolved refreshes silently; 500 shows error and allows retry',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/support'});let status='open',mode='ok';h.stub({'/api/frontend/staff/support-inbox':()=>envelope('support-inbox',{reports:[rep(1,status)]}),'/api/support/reports/*':()=>{if(mode==='500')return new ApiError(500,'x');if(mode==='409'){status='resolved';return new ApiError(409,'already_resolved');}status='resolved';return {ok:true,status:'resolved'};}});await h.mount({mount:T.supportMount});
 mode='500';h.click(h.q('[data-report-resolve]'));await tick(6);assert(h.q('[role=alert]'));assert.equal(h.q('[data-report-resolve]').disabled,false);
 mode='409';h.click(h.q('[data-report-resolve]'));await tick(6);assert.equal(h.q('[data-report-status]').dataset.reportStatus,'resolved');assert.equal(h.calls.filter(c=>c.method==='PATCH').at(-1).body,undefined);assert.equal(h.calls.filter(c=>c.method==='PATCH').at(-1).path,'/api/support/reports/'+ID(1));
});
test('support: malformed report row fails closed; student redirected without request',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/support'});h.stub({'/api/frontend/staff/support-inbox':envelope('support-inbox',{reports:[{id:ID(1),status:'weird'}]})});await h.mount({mount:T.supportMount});assert(h.q('[data-region-failure]'));h.dispose();
 h=setup({role:'student',path:'/app/teacher/support'});h.stub({});await h.mount({mount:T.supportMount});assert.equal(h.calls.length,0);assert.equal(h.nav[0].path,'/app');
});
