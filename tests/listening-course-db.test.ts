import test from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {createTestDatabase} from './support/pglite';
import {authoredBatchPackage} from '../scripts/listening-authored-batch-package';
import {originalListeningStorageKey} from '../src/lib/listening/original-listening';
import {COURSE_PROGRESS_KEY,originalCourseSpec,readCourseWork,courseStatus,mergeCourseAnswers} from '../src/lib/listening/course-progress';
import {recordOriginalCourseWork} from '../src/lib/data/listening-course';
import {saveOriginalListeningState} from '../src/lib/data/listening-original-state';
import {listeningSequenceAccess} from '../src/lib/data/listening-sequence';
import {academicListeningCards} from '../src/lib/data/listening-academic';
import {mcqDayFor,mcqProgramDays} from '../src/lib/data/listening-mcq';
import {MCQ_PROGRAM_REF} from '../src/lib/listening/mcq-program';
import {users,listeningTests,listeningQuestions,listeningPackages,listeningMcqSessions,listeningAuthoredCheckpoints} from '../src/db/schema';

test('all activities automatically unlock exactly the next test; fake checkpoint completion and another account cannot unlock it',async()=>{
 const d=await createTestDatabase();
 try{
  const [owner]=await d.db.insert(users).values({name:'Course owner',role:'owner'}).returning();
  const [student,other]=await d.db.insert(users).values([{name:'Course learner',role:'student'},{name:'Other learner',role:'student'}]).returning();
  const ids:string[]=[];
  for(const n of [2,3,4]){
   const {stored:pkg}=authoredBatchPackage(n);
   const [row]=await d.db.insert(listeningTests).values({title:pkg.title,createdByUserId:owner!.id,audioType:'audio',publicationState:'published',createdAt:new Date('2026-01-0'+n)}).returning();ids.push(row!.id);
   await d.db.insert(listeningPackages).values({testId:row!.id,sourceId:pkg.testId,payload:pkg,audioObjectKey:'fixture/'+n+'.mp3',sourceHash:'0'.repeat(64)});
   await d.db.insert(listeningQuestions).values(pkg.questions.map(q=>({testId:row!.id,order:q.number,type:'short_answer' as const,questionText:q.text,correctAnswer:q.key,explanation:q.evidence.why})));
  }
  const user={id:student!.id,role:'student' as const},db=d.db;
  assert.equal(await listeningSequenceAccess(user,ids[0]!,db),true);
  assert.equal(await listeningSequenceAccess(user,ids[1]!,db),false);
  const pkg=authoredBatchPackage(2).stored,key=originalListeningStorageKey(pkg.testId),spec=originalCourseSpec(pkg.testId)!;
  const fake={version:spec.version,exam:true,retry:[],units:Object.fromEntries(Object.entries(spec.activities).map(([name,value])=>[name,value.units]))};
  await saveOriginalListeningState(user.id,ids[0]!,{[COURSE_PROGRESS_KEY]:JSON.stringify(fake),[key]:'{}'},pkg,db);
  assert.equal(await listeningSequenceAccess(user,ids[1]!,db),false);
  const answers=Object.fromEntries(pkg.questions.map(q=>[q.number,'wrong but attempted']));
  await saveOriginalListeningState(user.id,ids[0]!,{[key]:JSON.stringify({attemptStatus:'in_progress',answers})},pkg,db);
  await saveOriginalListeningState(user.id,ids[0]!,{[key]:JSON.stringify({attemptStatus:'submitted',answers})},pkg,db);
  assert.equal(await listeningSequenceAccess(user,ids[1]!,db),false,'exam alone never unlocks next test');
  for(const [activity,requirement]of Object.entries(spec.activities)){
   if(activity==='exam'||activity==='vocab'||!requirement.units.length)continue;
   await recordOriginalCourseWork(user.id,ids[0]!,pkg.testId,activity,Object.fromEntries(requirement.units.map(id=>[id,activity==='multi'?'A,B':'attempted'])),db);
  }
  await recordOriginalCourseWork(user.id,ids[0]!,pkg.testId,'vocab',Object.fromEntries(spec.activities.vocab!.units.slice(0,9).map(id=>[id,'attempted'])),db);
  assert.equal(await listeningSequenceAccess(user,ids[1]!,db),false,'one unfinished activity keeps next test locked');
  const final=await recordOriginalCourseWork(user.id,ids[0]!,pkg.testId,'vocab',{[spec.activities.vocab!.units[9]!]: 'attempted'},db);
  assert.equal(final.complete,true);
  assert.equal(await listeningSequenceAccess(user,ids[1]!,db),true);
  assert.equal(await listeningSequenceAccess(user,ids[2]!,db),false);
  assert.equal(await listeningSequenceAccess({id:other!.id,role:'student'},ids[1]!,db),false);
  assert.equal(await listeningSequenceAccess({id:owner!.id,role:'owner'},ids[2]!,db),true);
  // A delayed runtime save cannot overwrite server-owned coverage, even if it sends a forged entry.
  await saveOriginalListeningState(user.id,ids[0]!,{[key]:JSON.stringify({attemptStatus:'submitted',answers}),[COURSE_PROGRESS_KEY]:'{}'},pkg,db);
  const checkpoint=await db.query.listeningAuthoredCheckpoints.findFirst({where:eq(listeningAuthoredCheckpoints.testId,ids[0]!)});
  assert.equal(courseStatus(spec,readCourseWork(checkpoint!.values,spec)).complete,true);
  const catalogue=await academicListeningCards(user.id,99,db);
  assert.equal(catalogue.cards.length,3);assert.equal(catalogue.hasMore,false);assert.deepEqual(catalogue.cards.map(c=>c.locked),[false,false,true]);
  await assert.rejects(recordOriginalCourseWork(user.id,ids[0]!,pkg.testId,'exam',{'1':'fake'},db),/invalid_activity/);
  await assert.rejects(recordOriginalCourseWork(user.id,ids[0]!,pkg.testId,'completion',{'foreign question':'fake'},db),/invalid_answers/);
 }finally{await d.close();}
});

test('MCQ programme unlocks automatically only after all five current questions reach reasoned, with one scrolling catalogue',async()=>{
 const d=await createTestDatabase();
 try{
  const [owner,student]=await d.db.insert(users).values([{name:'MCQ owner',role:'owner'},{name:'MCQ learner',role:'student'}]).returning();
  const ids:string[]=[];const questions:{id:string}[][]=[];
  for(let day=1;day<=3;day++){
   const [row]=await d.db.insert(listeningTests).values({title:'Day fixture '+day,createdByUserId:owner!.id,audioType:'audio',publicationState:'published',programRef:MCQ_PROGRAM_REF,programOrdinal:day}).returning();ids.push(row!.id);
   questions.push(await d.db.insert(listeningQuestions).values(Array.from({length:5},(_,i)=>({testId:row!.id,order:i+1,type:'multiple_choice' as const,typeCode:'mcq_single',questionText:'Question '+i,correctAnswer:'A',options:['A) first','B) second'],explanation:'Fixture explanation'}))).returning({id:listeningQuestions.id}));
  }
  const user={id:student!.id,role:'student' as const};
  assert.deepEqual((await mcqProgramDays(user,{page:100},d.db)).days.map(c=>c.locked),[false,true,true]);
  assert.equal(await mcqDayFor(2,user,{},d.db),null);
  for(const [index,q]of questions[0]!.entries())await d.db.insert(listeningMcqSessions).values({userId:user.id,testId:ids[0]!,questionId:q.id,stage:index===4?'chosen':'reasoned'});
  assert.equal(await listeningSequenceAccess(user,ids[1]!,d.db),false);
  await d.db.update(listeningMcqSessions).set({stage:'reasoned'}).where(eq(listeningMcqSessions.questionId,questions[0]![4]!.id));
  assert.deepEqual((await mcqProgramDays(user,{},d.db)).days.map(c=>c.locked),[false,false,true]);
  assert.equal(await listeningSequenceAccess(user,ids[1]!,d.db),true);
  assert.equal(await listeningSequenceAccess(user,ids[2]!,d.db),false);
  assert.ok(await mcqDayFor(2,user,{},d.db));
 }finally{await d.close();}
});

test('perfect exams need no weak-area retry; incomplete multi selections cannot count as finished work',()=>{
 const spec=originalCourseSpec('listening-test-1')!;
 const work={...readCourseWork({},spec),exam:true,retry:[],units:Object.fromEntries(Object.entries(spec.activities).map(([key,value])=>[key,value.units]))};
 assert.equal(courseStatus(spec,work).activities.retry!.complete,true);
 assert.equal(courseStatus(spec,work).complete,true);
 const unit=spec.activities.multi!.units[0]!;
 assert.throws(()=>mergeCourseAnswers(spec,work,'multi',{[unit]:'A'}),/invalid_answers/);
});
