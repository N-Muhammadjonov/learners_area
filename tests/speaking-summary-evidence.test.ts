import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSpeakingSummary } from "../src/lib/data/speaking-session-summary";
import type { EvaluationRecord } from "../src/lib/data/evaluations";

type Inputs = Parameters<typeof aggregateSpeakingSummary>;
const session = { id:"session",userId:"owner",mode:"part1",status:"completed",limitations:[] } as unknown as Inputs[0];
const items = [1,2].map(n=>({id:`item${n}`,sessionId:"session",promptId:`prompt${n}`,attemptId:`attempt${n}`,status:"answered",part:"part1"})) as Inputs[1];
const attempts = [1,2].map(n=>({id:`attempt${n}`,userId:"owner",aiSessionId:"session",aiSessionItemId:`item${n}`,promptId:`prompt${n}`,status:"submitted",part:"part1",recordingDurationMs:1000,transcript:"I enjoy reading books."})) as Inputs[2];
const evaluation = (n:number):EvaluationRecord=>({id:`eval${n}`,userId:"owner",sourceType:"speaking_attempt",sourceId:`attempt${n}`,evaluationType:"speaking",assessmentContractKey:"speaking.part1",overallEstimate:6,confidence:0.8,verdict:null,nextActions:[],recommendedExercises:[],criteria:[...['fluency','lexical','grammar'].map(key=>({key,label:key,band:6,limited:false,note:null})),{key:"pronunciation",label:"Pronunciation",band:null,limited:true,note:null}],strengths:["Clear idea","Clear idea"],weaknesses:[],issues:[{category:"SPEAKING_FILLERS",severity:"low",message:"Fixture",excerpt:"I enjoy reading",suggestion:null},{category:"SPEAKING_FILLERS",severity:"low",message:"Fixture",excerpt:"books",suggestion:null}]}) as unknown as EvaluationRecord;
const map = ()=>new Map([['attempt1',evaluation(1)],['attempt2',evaluation(2)]]);

test("summary counts recurrence across distinct answers and derives only the three supported textual criteria",()=>{
 const summary=aggregateSpeakingSummary(session,items,attempts,map());assert.equal(summary.textBasedEstimate,6);assert.equal(summary.evaluated,2);assert.equal(summary.completeEvidence,true);assert.equal(summary.totalDurationMs,2000);
 assert.deepEqual(summary.recurringWeaknesses,[{category:"SPEAKING_FILLERS",count:2}]);assert.deepEqual(summary.pronunciation,{assessed:false,band:null});assert.equal(summary.criteria.length,3);
 const one=aggregateSpeakingSummary(session,[items[0]!],[attempts[0]!],new Map([['attempt1',evaluation(1)]]));assert.equal(one.recurringWeaknesses.length,0,"two mentions in one answer are not recurrence");
});

test("summary refuses unsupported pronunciation, empty quotes, ungrounded teaching examples and mismatched part contracts",()=>{
 const teaching = {simpleExplanation:null,evidence:[],steps:[],examples:[],illustration:null};
 const original = evaluation(2);
 const invalid = [
  {...original,criteria:original.criteria.map(c=>c.key==='pronunciation'?{...c,band:9,limited:false}:c)},
  {...original,criteria:[...original.criteria,original.criteria[3]!]},
  {...original,issues:[{...original.issues[0]!,excerpt:''}]},
  {...original,issues:[{...original.issues[0]!,excerpt:' \n\t '}]},
  {...original,teachingFeedback:{...teaching,evidence:[{excerpt:'invented quotation',point:'Invented',correction:null}]}},
  {...original,teachingFeedback:{...teaching,examples:[{before:'invented quotation',after:'Revised.',explanation:null}]}},
  {...original,teachingFeedback:{...teaching,examples:[{before:'',after:'Revised.',explanation:null}]}},
  {...original,assessmentContractKey:'speaking.part3'},
 ];
 for(const changed of invalid){
  const evaluations=map();evaluations.set('attempt2',changed);
  const summary=aggregateSpeakingSummary(session,items,attempts,evaluations);
  assert.equal(summary.evaluated,1);assert.equal(summary.textBasedEstimate,null);
  assert.deepEqual(summary.pronunciation,{assessed:false,band:null});
 }
 for(const changed of [{...attempts[1]!,part:'part3' as const},{...attempts[1]!,transcript:' \n\t '}]){
  assert.equal(aggregateSpeakingSummary(session,items,[attempts[0]!,changed],map()).evaluated,1);
 }
 assert.equal(aggregateSpeakingSummary({...session,status:'active'},items,attempts,map()).textBasedEstimate,null);
});

test("grounded teaching evidence and legitimate legacy rows remain eligible without using stored overall as authority",()=>{
 const evaluations=map();evaluations.set('attempt2',{
  ...evaluation(2),assessmentContractKey:null,overallEstimate:9,
  teachingFeedback:{simpleExplanation:null,evidence:[{excerpt:'I enjoy reading',point:'Supported',correction:null}],steps:[],
   examples:[{before:'books',after:'novels',explanation:null},{before:null,after:'I read every day.',explanation:null}],illustration:null},
 });
 const summary=aggregateSpeakingSummary(session,items,attempts,evaluations);
 assert.equal(summary.evaluated,2);assert.equal(summary.textBasedEstimate,6);
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
