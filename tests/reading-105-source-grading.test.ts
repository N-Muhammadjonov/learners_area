import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync,strFromU8 } from "fflate";
import { gradeReadingQuestion,readingQuestionDescriptor,readingStorageType } from "../src/lib/reading/question-model";

test("All 1406 authored source keys grade correctly, including SEN and legacy TFNG with explicit YES/NO choices",()=>{
  const member='learnersarea_reading_supabase_ready_v1/data/reading_bundle_01_105.json';
  type Choice={option_key:string;option_text:string;position:number};
  const bundle=JSON.parse(strFromU8(unzipSync(readFileSync('data/import-sources/learnersarea_reading_105.zip'),{filter:e=>e.name===member})[member]!)) as {
    assessment_questions:{ref:string;group_ref:string;answer_constraint:Record<string,unknown>}[];
    assessment_groups:{ref:string;type_code:string;config:{shared_choices?:Choice[]}}[];
    assessment_answers:{ref:string;question_ref:string;canonical_answer:string}[];
    assessment_answer_variants:{answer_ref:string;accepted_answer:string}[];
    assessment_question_options:(Choice&{question_ref:string})[];
  };
  let sentences=0,yesNoOverrides=0;
  for(const row of bundle.assessment_questions){
    const group=bundle.assessment_groups.find(g=>g.ref===row.group_ref)!;
    const answer=bundle.assessment_answers.find(a=>a.question_ref===row.ref)!;
    const choices=(rows:Choice[])=>rows.sort((a,b)=>a.position-b.position).map(o=>`${o.option_key}) ${o.option_text}`);
    const q={type:readingStorageType(group.type_code),typeCode:group.type_code,correctAnswer:answer.canonical_answer,
      acceptedAnswers:bundle.assessment_answer_variants.filter(v=>v.answer_ref===answer.ref).map(v=>v.accepted_answer),
      options:choices(bundle.assessment_question_options.filter(o=>o.question_ref===row.ref)),answerConstraint:row.answer_constraint};
    assert.equal(gradeReadingQuestion(q.correctAnswer,q,choices(group.config.shared_choices??[])),true,`${row.ref}: ${group.type_code}`);
    assert.equal(gradeReadingQuestion('deliberately incorrect fixture answer',q,choices(group.config.shared_choices??[])),false);
    if(group.type_code==='SEN')sentences++;
    if(group.type_code==='TFNG'&&readingQuestionDescriptor(q)?.id==='yes_no_not_given')yesNoOverrides++;
  }
  assert.equal(bundle.assessment_questions.length,1406);assert.equal(sentences,77);assert.equal(yesNoOverrides,5);
});
