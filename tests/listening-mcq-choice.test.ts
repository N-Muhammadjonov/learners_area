import test from "node:test";
import assert from "node:assert/strict";
import { advance } from "../src/lib/services/listening/mcq-mastery";
import { mcqKeyOptions, mcqChoiceCorrect } from "../src/lib/listening/mcq-choice";
import { mcqDayProblems } from "../src/lib/listening/mcq-program";
const options=["A) one","B) two","C) three"];
test("MCQ multi uses the existing stage engine, accepts authored choices only",()=>{
 assert.equal(advance("revealed",{step:"chosen",text:JSON.stringify([options[0],options[2]]),options,multi:true}).ok,true);
 for(const text of ['["missing"]','["A) one","A) one"]','not json'])assert.equal(advance("revealed",{step:"chosen",text,options,multi:true}).ok,false);
 assert.equal(advance("committed",{step:"chosen",text:'["A) one"]',options,multi:true}).ok,false);
 assert.equal(advance("revealed",{step:"chosen",text:'["A) one"]',options}).ok,false);
});
test("multi grading is set-equal, not order-dependent or single-choice",()=>{
 assert.ok(mcqChoiceCorrect(JSON.stringify([options[2],options[0]]),"A,C",options,true));
 assert.equal(mcqChoiceCorrect(JSON.stringify([options[0]]),"A,C",options,true),false);
 assert.equal(mcqChoiceCorrect(JSON.stringify(options),"A,C",options,true),false);
 assert.ok(mcqChoiceCorrect("A","A",options,false), "historical stored letter remains correct");
 assert.equal(advance("revealed",{step:"chosen",text:"A",options}).ok,false,"new submissions still use actual option values");
 for(const key of ["A","one","A) one"])assert.ok(mcqChoiceCorrect(options[0]!,key,options,false));
});
test("publication rejects ungradeable/duplicate keys, permits proven multi-answer keys",()=>{
 assert.equal(mcqKeyOptions("Z",options,false),null);assert.equal(mcqKeyOptions("A,A",options,true),null);
 const day=Array.from({length:5},(_,i)=>({number:i+1,typeCode:"mcq_multi",options,correctAnswer:"A,C"}));
 assert.deepEqual(mcqDayProblems(day),[]);
 assert.ok(mcqDayProblems(day.map(q=>({...q,correctAnswer:"Z"}))).length);
});
