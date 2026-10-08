import test from "node:test";
import assert from "node:assert/strict";
import { questionTypesFor } from "../src/lib/content/question-types";
import { gradeReadingQuestion } from "../src/lib/reading/question-model";
import { generalReadingBundle } from "../src/lib/reading/import-schema";
import { importGeneralReadingSet } from "../src/lib/services/reading/general-import";
import { saveGeneralProgress } from "../src/lib/data/general-reading";
import { createTestDatabase } from "./support/pglite";
import { questionTypeLabel } from "../src/lib/reading-labels";
const types=questionTypesFor('reading');
const key=(kind:string)=>kind==='ternary'?'TRUE':kind==='choice_multi'?'A, B':kind==='text'?'answer':'A';
for(const type of types) test(`R-V4-19 registry grading and localized identity: ${type.id}`,()=>{
 const answer=type.id==='yes_no_not_given'?'YES':key(type.answerModel.kind);
 const q={type:type.storageType,typeCode:type.id,correctAnswer:answer,options:['A) first','B) second','C) third'],acceptedAnswers:[]};
 assert.equal(gradeReadingQuestion(answer,q),true);assert.equal(gradeReadingQuestion('wrong',q),false);
 assert.ok(questionTypeLabel(type.id,'uz'));assert.notEqual(questionTypeLabel(type.id,'uz'),type.id);
});
test('Reading multi-select requires exactly the authored keys, rejects extras and duplicates; authored word limit enforced',()=>{
 const q={type:'multiple_choice',typeCode:'multiple_choice_multi',correctAnswer:'A, B',answerConstraint:{selection_count:2}};
 for(const answer of ['A, B, C','A, A','A',''])assert.equal(gradeReadingQuestion(answer,q),false);
 assert.equal(gradeReadingQuestion('B, A',q),true);
 assert.equal(gradeReadingQuestion('two words',{type:'short_answer',correctAnswer:'two words',answerConstraint:{max_words:1}}),false);
});
test('all 16 canonical types actually import into existing rows, preserve groups, and Check with the registry',async()=>{
 assert.equal(types.length,16);
 const env=await createTestDatabase();
 try {
  const [user]=await env.query<{id:string}>("insert into users(name) values ('Types QA') returning id");
  const bundle=generalReadingBundle.parse({sourceRef:'qa-sixteen-types',title:'QA authored material',publish:true,passages:[{passageNo:1,title:'QA passage',body:'The authored passage contains the answer.',groups:types.filter(t=>t.group).map(t=>({key:t.id,typeCode:t.id,instructionsText:'Authored group instruction',sharedChoices:['A) first','B) second','C) third']})),questions:types.map((t,i)=>({questionNo:i+1,type:t.id,text:'Actual authored question',answer:t.id==='yes_no_not_given'?'YES':key(t.answerModel.kind),groupKey:t.group?t.id:undefined,options:['A) first','B) second','C) third'],explanation:'Authored explanation',evidence:'the answer'}))}]});
  const imported=await env.db.transaction(tx=>importGeneralReadingSet(tx,bundle));
  const rows=await env.query<{id:string;type_code:string;correct_answer:string;group_id:string|null}>("select * from reading_questions where passage_id=$1",[imported.passages[0]!.passageId]);
  assert.equal(rows.length,16);assert.deepEqual(new Set(rows.map(q=>q.type_code)),new Set(types.map(t=>t.id)));
  for(const row of rows)assert.equal(Boolean(row.group_id),types.find(t=>t.id===row.type_code)!.group);
  const result=await saveGeneralProgress({userId:user!.id,role:'student',passageId:imported.passages[0]!.passageId,answers:Object.fromEntries(rows.map(q=>[q.id,q.correct_answer])),check:true},env.db);
  assert.equal(result!.progress.score,16);assert.equal(result!.result!.length,16);
 } finally {await env.close();}
});
