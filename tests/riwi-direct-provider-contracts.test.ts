import assert from "node:assert/strict";
import test from "node:test";
import { createLlmEvaluationProvider } from "../src/lib/services/coach/providers/shared/llm-provider";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { criteriaFor } from "../src/lib/writing/grade-criteria";
import type { EvaluationProvider, EvaluationContext } from "../src/lib/services/coach/types";
import type { ProviderEvaluationOutput } from "../src/lib/services/coach/schema";

const ctx = {userId:"11111111-2222-3333-4444-555555555555",language:"en" as const};
const text = "I enjoy reading books.";
const base:ProviderEvaluationOutput = {overallEstimate:null,confidence:0.8,verdict:"correct",criteria:[],strengths:[],weaknesses:[],issues:[],nextActions:[],recommendedExercises:[]};
const bands = (keys:readonly string[]) => keys.map(key=>({key,label:key,band:6,limited:false,note:null}));
const writing = {taskType:"task2" as const,prompt:"Explain a hobby.",content:text,targetWordCount:250};
const speaking = {part:"part1" as const,promptText:null,transcript:text,transcriptOrigin:"manual" as const,durationMs:1000,pronunciationAvailable:false};
const grammar = {promptText:"Describe a hobby.",studentAnswer:text,targetStructure:null,sampleAnswer:null};
const vocabulary = {targetWord:"reading",definition:"looking at and understanding written words",studentSentence:text};
const assignment = {title:"A hobby",description:null,studentResponse:text};
const invoke = (provider:EvaluationProvider,domain:string,source=text,context:EvaluationContext=ctx) => {
 switch(domain){
  case "writing":return provider.evaluateWriting!(context,{...writing,content:source});
  case "speaking":return provider.evaluateSpeaking!(context,{...speaking,transcript:source});
  case "grammar":return provider.evaluateGrammar!(context,{...grammar,studentAnswer:source});
  case "vocabulary":return provider.evaluateVocabulary!(context,{...vocabulary,studentSentence:source});
  default:return provider.evaluateAssignment!(context,{...assignment,studentResponse:source});
 }
};

test("direct calls across all five domains validate work before transport and refuse cross-domain context",async()=>{
 let calls=0;
 const provider=createLlmEvaluationProvider({id:"direct-boundary",displayName:"Direct boundary",version:"test",model:()=>"fixed",requiredSecrets:()=>[],transport:async()=>{calls++;return {ok:true,text:JSON.stringify(base)};}});
 for(const domain of ['writing','speaking','grammar','vocabulary','assignment']){
  for(const source of ['', ' \n\t ', 'x'.repeat(20_001)]) assert.equal((await invoke(provider,domain,source)).ok,false,domain);
 }
 const contract=getAssessmentContract('writing.task2.generic')!;
 const context={...ctx,assessmentContract:{key:contract.key,version:contract.version,rubricVersion:contract.rubricVersion,policyScope:null,policyVersion:null,overlay:null}};
 assert.equal((await invoke(provider,'grammar',text,context)).ok,false);
 const check={kind:'translation' as const,uzbekSource:'Men kitob o\'qishni yoqtiraman.',referenceEnglish:text,acceptedAlternatives:[],targetBand:6,answer:text};
 assert.equal((await provider.evaluateWriting!(ctx,{...writing,content:'different work',targetWordCount:0,check})).ok,false);
 assert.equal(calls,0);
});

test("direct providers derive canonical scores and reject task drift or invented source evidence",async()=>{
 let output=base;
 const provider=createLlmEvaluationProvider({id:"direct-output",displayName:"Direct output",version:"test",model:()=>"fixed",requiredSecrets:()=>[],transport:async()=>({ok:true,text:JSON.stringify(output)})});
 for(const domain of ['writing','speaking','grammar','vocabulary','assignment']){
  output=domain==='writing'?{...base,verdict:null,overallEstimate:9,criteria:bands(criteriaFor('task2'))}
   :domain==='speaking'?{...base,verdict:null,overallEstimate:9,criteria:bands(['fluency','lexical','grammar'])}:base;
  const result=await invoke(provider,domain);assert.equal(result.ok,true,domain);
  if(result.ok&&['writing','speaking'].includes(domain))assert.equal(result.output.overallEstimate,6);
  output={...output,issues:[{category:'GRAMMAR_TENSE',message:'Fixture',excerpt:'invented quotation',suggestion:null,severity:'low'}]};
  assert.equal((await invoke(provider,domain)).ok,false,`${domain}: invented evidence`);
  output={...base,overallEstimate:7,criteria:bands(['grammar'])};
  assert.equal((await invoke(provider,domain)).ok,false,`${domain}: task drift`);
 }
 const spoken={...base,verdict:null,criteria:bands(['fluency','lexical','grammar'])};
 const pronunciation={key:'pronunciation',label:'Pronunciation',band:null,limited:true,note:null};
 for(const criteria of [[...spoken.criteria,{...pronunciation,band:9,limited:false}],[...spoken.criteria,pronunciation,pronunciation],[...spoken.criteria,spoken.criteria[0]!]]){
  output={...spoken,criteria};assert.equal((await invoke(provider,'speaking')).ok,false);
 }
 for(const excerpt of ['', ' \n\t ']){
  output={...base,issues:[{category:'GRAMMAR_TENSE',message:'Fixture',excerpt,suggestion:null,severity:'low'}]};
  assert.equal((await invoke(provider,'grammar')).ok,false);
 }
});
