import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSpeakingSummary } from "../src/lib/data/speaking-session-summary";
import type { EvaluationRecord } from "../src/lib/data/evaluations";

type Inputs = Parameters<typeof aggregateSpeakingSummary>;
const session = { id:"session",userId:"owner",mode:"part1",status:"completed",limitations:[] } as unknown as Inputs[0];
const items = [1,2].map(n=>({id:`item${n}`,sessionId:"session",promptId:`prompt${n}`,attemptId:`attempt${n}`,status:"answered"})) as Inputs[1];
const attempts = [1,2].map(n=>({id:`attempt${n}`,userId:"owner",aiSessionId:"session",aiSessionItemId:`item${n}`,promptId:`prompt${n}`,status:"submitted",recordingDurationMs:1000,transcript:"I enjoy reading books."})) as Inputs[2];
const evaluation = (n:number):EvaluationRecord=>({id:`eval${n}`,userId:"owner",sourceType:"speaking_attempt",sourceId:`attempt${n}`,evaluationType:"speaking",criteria:[...['fluency','lexical','grammar'].map(key=>({key,label:key,band:6,limited:false,note:null})),{key:"pronunciation",label:"Pronunciation",band:null,limited:true,note:null}],strengths:["Clear idea","Clear idea"],weaknesses:[],issues:[{category:"SPEAKING_FILLERS",severity:"low",message:"Fixture",excerpt:"I enjoy reading",suggestion:null},{category:"SPEAKING_FILLERS",severity:"low",message:"Fixture",excerpt:"books",suggestion:null}]}) as unknown as EvaluationRecord;
const map = ()=>new Map([['attempt1',evaluation(1)],['attempt2',evaluation(2)]]);

test("summary counts recurrence across distinct answers and derives only the three supported textual criteria",()=>{
 const summary=aggregateSpeakingSummary(session,items,attempts,map());assert.equal(summary.textBasedEstimate,6);assert.equal(summary.evaluated,2);assert.equal(summary.completeEvidence,true);assert.equal(summary.totalDurationMs,2000);
 assert.deepEqual(summary.recurringWeaknesses,[{category:"SPEAKING_FILLERS",count:2}]);assert.deepEqual(summary.pronunciation,{assessed:false,band:null});assert.equal(summary.criteria.length,3);
 const one=aggregateSpeakingSummary(session,[items[0]!],[attempts[0]!],new Map([['attempt1',evaluation(1)]]));assert.equal(one.recurringWeaknesses.length,0,"two mentions in one answer are not recurrence");
});

test("missing, skipped and limited coverage cannot manufacture an overall; foreign or ungrounded evidence is excluded",()=>{
 for(const evaluations of [new Map([['attempt1',evaluation(1)]]),new Map()]){
  const summary=aggregateSpeakingSummary(session,items,attempts,evaluations);assert.equal(summary.textBasedEstimate,null);assert.equal(summary.unevaluated,2-evaluations.size);
 }
 assert.equal(aggregateSpeakingSummary({...session,limitations:['missing:part3']},items,attempts,map()).textBasedEstimate,null);
 assert.equal(aggregateSpeakingSummary(session,[items[0]!,{...items[1]!,status:'skipped'}],attempts,map()).textBasedEstimate,null);
 for(const changed of [ {...evaluation(2),userId:'foreign'}, {...evaluation(2),sourceId:'foreign'}, {...evaluation(2),criteria:[...evaluation(2).criteria,evaluation(2).criteria[0]!]},{...evaluation(2),issues:[{...evaluation(2).issues[0]!,excerpt:'invented quote'}]} ]){
  const evaluations=map();evaluations.set('attempt2',changed);const summary=aggregateSpeakingSummary(session,items,attempts,evaluations);assert.equal(summary.evaluated,1);assert.equal(summary.textBasedEstimate,null);
 }
 for(const changed of [{...attempts[1]!,userId:'foreign'},{...attempts[1]!,aiSessionItemId:'wrong'},{...attempts[1]!,promptId:'wrong'}])assert.equal(aggregateSpeakingSummary(session,items,[attempts[0]!,changed],map()).evaluated,1);
});
