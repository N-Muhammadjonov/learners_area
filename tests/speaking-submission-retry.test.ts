import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, speakingAttempts } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { claimSpeakingSubmission, submitSpeakingAttempt, persistSpeakingEvaluation, releaseSpeakingClaim, recordingFingerprint, discardSpeakingAttempt, SpeakingClaimLost } from "../src/lib/data/speaking-submission";
import { type SpeakingEvaluationRequest } from "../src/lib/services/coach/speaking";
import { evaluationResultSchema } from "../src/lib/services/coach/schema";

const result = evaluationResultSchema.parse({ evaluationId:"fixture-result",evaluationType:"speaking",createdAt:new Date().toISOString(),providerId:"fixture",providerDisplayName:"Fixture",providerType:"external",providerVersion:"v1",model:"fixture",promptVersion:"speaking-part1-v1",rubricVersion:"speaking-part1-v1",fallbackUsed:false,fallbackFrom:null,checkedBy:{id:"fixture",displayName:"Fixture",type:"external"}, overallEstimate:6,confidence:0.8,verdict:null,criteria:[{key:"fluency",label:"Fluency",band:6,note:null},{key:"lexical",label:"Lexical",band:6,note:null},{key:"grammar",label:"Grammar",band:6,note:null},{key:"pronunciation",label:"Pronunciation",band:null,limited:true,note:"Not assessed"}],strengths:[],weaknesses:[],issues:[],nextActions:[],recommendedExercises:[],processedInMs:1,assessmentContractKey:"speaking.part1" });
const transcript = "I enjoy reading and learning languages.";

test("failed evaluation retries the immutable reviewed transcript, fences concurrent Send, and reuses one saved result",async()=>{
 const database=await createTestDatabase();try{
  const userId=randomUUID();const other=randomUUID();await database.db.insert(users).values([{id:userId,name:"Owner",accountStatus:"active"},{id:other,name:"Foreign"}]);
  const [attempt]=await database.db.insert(speakingAttempts).values({userId,part:"part1",recordingObjectKey:"speaking/owned.webm",recordingSize:4,recordingMimeType:"audio/webm",recordingDurationMs:1000}).returning();const id=attempt!.id;
  const body={browserTranscript:transcript,browserTranscriptRaw:"I enjoy reading.",browserTranscriptEdited:false,durationMs:1000};
  let calls=0;
  const deps={fingerprint:async()=>"a".repeat(64),transcribe:async()=>{throw new Error("must not retranscribe browser text");},evaluate:async(input:SpeakingEvaluationRequest)=>{calls++;if(calls===1)return {ok:false as const,error:"evaluation_unavailable" as const};const saved=await input.persist!(result);return {ok:true as const,evaluation:saved.record,reused:!saved.created};}};
  const failed=await submitSpeakingAttempt(database.db,userId,id,body,"en",deps);assert.equal(failed.ok,false);assert.equal(calls,1);
  let stored=await database.db.query.speakingAttempts.findFirst({where:eq(speakingAttempts.id,id)});assert.equal(stored!.status,"submitted");assert.equal(stored!.transcriptRaw,"I enjoy reading.");assert.equal(stored!.transcriptEdited,true,"server compares original and reviewed text");assert.equal(stored!.evaluationClaimToken,null);
  assert.equal((await claimSpeakingSubmission(database.db,other,id,body)).ok,false);
  const conflicting=await claimSpeakingSubmission(database.db,userId,id,{...body,browserTranscript:"Changed reviewed answer"});assert.equal(conflicting.ok,false);
  const winner=await claimSpeakingSubmission(database.db,userId,id,body);assert.ok(winner.ok&&winner.token);
  const duplicate=await claimSpeakingSubmission(database.db,userId,id,body);assert.ok(!duplicate.ok);assert.equal(duplicate.error,"evaluation_in_progress");
  await releaseSpeakingClaim(database.db,id,winner.token!);
  const retried=await submitSpeakingAttempt(database.db,userId,id,body,"en",deps);assert.ok(retried.ok);assert.equal(calls,2);assert.ok(retried.evaluation);assert.equal(retried.evaluation.model,"fixture");
  const replay=await submitSpeakingAttempt(database.db,userId,id,body,"en",deps);assert.ok(replay.ok);assert.equal(replay.reused,true);assert.equal(calls,2);
  stored=await database.db.query.speakingAttempts.findFirst({where:eq(speakingAttempts.id,id)});assert.equal(stored!.recordingSha256,"a".repeat(64));assert.equal(stored!.transcriptRaw,"I enjoy reading.");assert.equal(stored!.evaluationClaimToken,null);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM evaluations'))[0]!.n,1);
 }finally{await database.close();}
});

test("expired worker cannot save or clear a newer claim; discard and provider failure are race-safe",async()=>{
 const database=await createTestDatabase();try{
  const userId=randomUUID();await database.db.insert(users).values({id:userId,name:"Owner",accountStatus:"active"});
  const [attempt]=await database.db.insert(speakingAttempts).values({userId,part:"part1",recordingObjectKey:"speaking/owned.webm",recordingSize:4,recordingMimeType:"audio/webm"}).returning();const id=attempt!.id;
  const first=await claimSpeakingSubmission(database.db,userId,id,{manualTranscript:transcript});assert.ok(first.ok&&first.token);
  assert.equal((await discardSpeakingAttempt(database.db,userId,id)).ok,false);
  await database.db.update(speakingAttempts).set({evaluationClaimExpiresAt:new Date(0)}).where(eq(speakingAttempts.id,id));
  await assert.rejects(persistSpeakingEvaluation(database.db,userId,id,first.token!,result),SpeakingClaimLost,"even an unreclaimed expired lease is fenced");
  const second=await claimSpeakingSubmission(database.db,userId,id,{manualTranscript:transcript});assert.ok(second.ok&&second.token);assert.notEqual(first.token,second.token);
  await assert.rejects(persistSpeakingEvaluation(database.db,userId,id,first.token!,result),SpeakingClaimLost);
  await releaseSpeakingClaim(database.db,id,first.token!);
  assert.equal((await database.db.query.speakingAttempts.findFirst({where:eq(speakingAttempts.id,id)}))!.evaluationClaimToken,second.token);
  await releaseSpeakingClaim(database.db,id,second.token!);
  const failed=await submitSpeakingAttempt(database.db,userId,id,{manualTranscript:transcript},"en",{fingerprint:async()=>"a".repeat(64),transcribe:async()=>{throw new Error("not called");},evaluate:async()=>{throw new Error("provider crash");}});
  assert.equal(failed.ok,false);assert.equal((await database.db.query.speakingAttempts.findFirst({where:eq(speakingAttempts.id,id)}))!.evaluationClaimToken,null);
  assert.equal((await discardSpeakingAttempt(database.db,userId,id)).ok,false,"submitted history remains");
  const revoked=await claimSpeakingSubmission(database.db,userId,id,{manualTranscript:transcript});assert.ok(revoked.ok&&revoked.token);
  await database.db.update(users).set({accountStatus:"suspended"}).where(eq(users.id,userId));
  await assert.rejects(persistSpeakingEvaluation(database.db,userId,id,revoked.token!,result),SpeakingClaimLost);
  await releaseSpeakingClaim(database.db,id,revoked.token!);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM evaluations'))[0]!.n,0);
 }finally{await database.close();}
});

test("recording SHA comes from bounded stored bytes and rejects truncation, corruption and oversize",async()=>{
 const bytes=Buffer.from("voice");const attempt={recordingObjectKey:"owned",recordingSize:bytes.length,recordingSha256:null} as Parameters<typeof recordingFingerprint>[1];
 assert.equal(await recordingFingerprint({readBounded:async()=>({body:bytes,contentType:"audio/webm"})},attempt),createHash("sha256").update(bytes).digest("hex"));
 for(const body of [Buffer.from("voic"),Buffer.from("voice!")]) await assert.rejects(recordingFingerprint({readBounded:async()=>({body,contentType:"audio/webm"})},attempt));
 await assert.rejects(recordingFingerprint({readBounded:async()=>({body:bytes,contentType:"audio/webm"})},{...attempt,recordingSha256:"b".repeat(64)}));
 await assert.rejects(recordingFingerprint({readBounded:async()=>{assert.fail("do not allocate oversized recordings");}},{...attempt,recordingSize:51*1024*1024}));
});


test("Practice on Your Own saves audio with honest missing transcription and can assess it on a later explicit retry",async()=>{
 const database=await createTestDatabase();try{
  const userId=randomUUID();await database.db.insert(users).values({id:userId,name:"Owner",accountStatus:"active"});
  const [attempt]=await database.db.insert(speakingAttempts).values({userId,part:"part1",recordingObjectKey:"speaking/owned.webm",recordingSize:4}).returning();
  const saved=await submitSpeakingAttempt(database.db,userId,attempt!.id,{},"en",{fingerprint:async()=>"a".repeat(64),transcribe:async()=>({ok:false as const,failure:{reason:"not_configured" as const,detail:"Fixture",retryable:false}}),evaluate:async()=>{assert.fail("audio alone must never invent an evaluation");}});
  assert.ok(saved.ok);assert.equal(saved.attempt.status,"submitted");assert.equal(saved.attempt.transcript,null);assert.equal(saved.evaluation,null);
  const retried=await submitSpeakingAttempt(database.db,userId,attempt!.id,{manualTranscript:transcript},"en",{fingerprint:async()=>"a".repeat(64),transcribe:async()=>{assert.fail("explicit manual transcript wins");},evaluate:async(input)=>{const persisted=await input.persist!(result);return {ok:true as const,evaluation:persisted.record,reused:!persisted.created};}});
  assert.ok(retried.ok);assert.equal(retried.attempt.transcriptOrigin,"manual");assert.equal(retried.attempt.transcriptRaw,transcript);assert.ok(retried.evaluation);
 }finally{await database.close();}
});
