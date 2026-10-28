/** Teacher homework and recorded assessment detail tests. All API responses are synthetic fixtures. */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID,envelope} from './harness.mjs';
import {homeworkMount,assignmentMount,assessmentMount} from '../../modules/staff-final30/homework.js';

let h;
afterEach(()=>h?.dispose());
const iso='2026-10-25T10:00:00.000Z';
const summary={assigned:1,completed:0,inProgress:0,notStarted:1,overdue:0};
const homework=()=>envelope('teacher-homework',{
 filters:{student:'',assignment:'',module:null,status:null,dueFrom:null,dueTo:null},
 summary,completionPercent:0,
 students:[{id:ID(2),name:'Learner',assigned:1,completed:0,inProgress:0,notStarted:1,overdue:0,completionPercent:0}],
 studentPage:1,studentPages:1,totalStudents:1,
 assignments:[{id:ID(3),title:'Reading response',studentId:ID(2),studentName:'Learner',module:'reading',contentType:'reading_set',sourceRef:'reading-fixture',status:'not_started',state:'not_started',dueAt:iso,completedAt:null,createdAt:iso}],
 assignmentPage:1,assignmentPages:1,totalAssignments:1,
});

 test('homework matrix separates assigned status counts and links to assignment detail',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/homework'});
 h.stub({'/api/frontend/staff/teacher-homework*':homework()});
 await h.mount({mount:homeworkMount});
 assert(h.q('[data-teacher-homework]'));
 assert.equal(h.q('[data-homework-summary]').textContent.includes('0.0%'),true);
 assert.equal(h.q('[data-homework-matrix] tbody tr').textContent.includes('Learner'),true);
 assert.equal(h.q('[data-homework-matrix] tbody tr').textContent.includes('1'),true);
 assert(h.q('a[href="/app/teacher/students/'+ID(2)+'/assignments/'+ID(3)+'"]'));
 assert(h.calls[0].path.startsWith('/api/frontend/staff/teacher-homework'));
 assert.equal(h.calls[0].method,'GET');
});

test('homework filters preserve their values in same-origin navigation without mutating records',async()=>{
 h=setup({role:'owner',path:'/app/teacher/homework'});
 h.stub({'/api/frontend/staff/teacher-homework*':homework()});
 await h.mount({mount:homeworkMount});
 const form=h.q('[data-homework-filters]');
 h.input(h.q('[data-homework-filter="student"]'),'Learner');
 h.input(h.q('[data-homework-filter="assignment"]'),'Reading');
 h.change(h.q('[data-homework-filter="module"]'),'reading');
 h.change(h.q('[data-homework-filter="status"]'),'not_started');
 h.submit(form);
 await tick();
 assert.equal(h.nav.at(-1).path,'/app/teacher/homework?student=Learner&assignment=Reading&module=reading&status=not_started');
 assert(h.ctx.root.textContent.includes('All centre students'));
 assert(h.calls.every(c=>c.method==='GET'));
});

test('assignment detail reads the saved student response/evaluation and sends no write',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/students/'+ID(2)+'/assignments/'+ID(3)});
 h.stub({'/api/frontend/staff/teacher-assignment*':envelope('teacher-assignment',{
  student:{id:ID(2),name:'Learner',email:null},
  assignment:{id:ID(3),title:'Essay task',description:'Recorded instructions',instructions:null,module:'writing',contentType:'essay',sourceRef:null,contentVersionId:null,createdAt:iso,dueAt:iso,completedAt:iso,status:'completed',
   response:{content:'A saved learner response.',createdAt:iso,updatedAt:iso},
   evaluation:{verdict:'meets_task',overallEstimate:7,strengths:['Clear position'],weaknesses:['Add evidence'],createdAt:iso}},
 })});
 await h.mount({mount:assignmentMount});
 assert(h.q('[data-teacher-assignment-review]'));
 assert(h.ctx.root.textContent.includes('A saved learner response.'));
 assert(h.ctx.root.textContent.includes('Clear position'));
 assert(h.ctx.root.textContent.includes('Add evidence'));
 assert(h.calls.every(c=>c.method==='GET'));
});

test('Mock attempt detail uses saved section_results only and never invents question answers',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/assessments/'+ID(2)+'/mocks/'+ID(4)});
 h.stub({'/api/frontend/staff/teacher-assessment*':envelope('teacher-assessment',{
  student:{id:ID(2),name:'Learner'},module:'mocks',title:'Full Mock',answerKeyAvailable:false,
  attempt:{id:ID(4),status:'submitted',startedAt:iso,submittedAt:iso,score:null,totalQuestions:null,rawScore:null,estimatedBand:null},
  questions:[],speaking:null,
  sectionResults:[{skill:'reading',sourceRef:'section-1',raw:22,total:40,band:6.0,contentVersionId:null,attemptId:null}],
 })});
 await h.mount({mount:assessmentMount});
 assert(h.q('[data-mock-sections]'));
 assert(h.ctx.root.textContent.includes('22 / 40'));
 assert.equal(h.qa('[data-assessment-question]').length,0);
 assert.equal(h.ctx.root.textContent.includes('correct answer'),false);
});

test('Speaking attempt detail reads saved recording, transcript and evaluation without a feedback write path',async()=>{
 h=setup({role:'owner',path:'/app/teacher/assessments/'+ID(2)+'/speaking/'+ID(5)});
 h.stub({'/api/frontend/staff/teacher-assessment*':envelope('teacher-assessment',{
  student:{id:ID(2),name:'Learner'},module:'speaking',title:'Speaking Part 2',answerKeyAvailable:false,
  attempt:{id:ID(5),status:'reviewed',startedAt:iso,submittedAt:iso,score:null,totalQuestions:null,rawScore:null,estimatedBand:6.5},
  questions:[],sectionResults:[],
  speaking:{part:'part2',topic:'A place',prompt:'Describe a place you visited.',cueCard:'Where it was; who with; why.',transcript:'The saved transcript is here.',transcriptOrigin:'saved',recordingUrl:'/api/resources/recording-fixture',evaluation:{overallEstimate:6.5,confidence:0.8,verdict:'good',strengths:['Fluent'],weaknesses:['Develop detail'],createdAt:iso}},
 })});
 await h.mount({mount:assessmentMount});
 assert(h.q('[data-speaking-review]'));
 assert.equal(h.q('[data-speaking-recording]').getAttribute('src'),'/api/resources/recording-fixture');
 assert(h.ctx.root.textContent.includes('The saved transcript is here.'));
 assert(h.ctx.root.textContent.includes('Fluent'));
 assert(h.ctx.root.textContent.includes('Develop detail'));
 assert(h.calls.every(c=>c.method==='GET'));
});

test('Admin is routed away from teacher-only detailed assessment before any API request',async()=>{
 h=setup({role:'admin',path:'/app/teacher/assessments/'+ID(2)+'/mocks/'+ID(4)});
 h.stub({});
 await h.mount({mount:assessmentMount});
 assert.equal(h.nav[0].path,'/app');
 assert.equal(h.calls.length,0);
});
