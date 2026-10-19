import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { readRetentionV4Source } from "../scripts/retention-v4-source";
import { importRetentionV4 } from "../scripts/retention-v4-import";
import { installRetentionVocabulary } from "../scripts/install-retention-vocabulary";
import { readRetentionVocabulary } from "../scripts/retention-vocabulary-source";
import { ingestRetentionOccurrences } from "../src/lib/services/lexical/reading-occurrences";
import { resolveRetentionOccurrence, retentionOccurrenceSpans } from "../src/lib/services/lexical/retention-occurrences";
import { addVocabularyBatch } from "../src/lib/services/vocabulary/engine";
import { startOrResumeAttempt, finishReadingEarly } from "../src/lib/data/retention-attempts";
import { buildAttemptPayload, assertLearnerSafe } from "../src/lib/retention/payload";

test('all 75 immutable sources have exact sense IDs; Retention lookup/save are owner- and phase-bound',async()=>{
  const d=await createTestDatabase();
  try{
    const users=await d.query<{id:string}>("insert into users(name,role,account_status,email) values ('Owner','owner','active','vocab.owner@example.test'),('Student','student','active','vocab.student@example.test'),('Other','student','active','vocab.other@example.test') returning id");
    const owner=users[0]!.id,student=users[1]!.id,other=users[2]!.id;
    const imported=await importRetentionV4(readRetentionV4Source(),owner,d.db);
    const installed=await installRetentionVocabulary(d.db);
    assert.equal(installed.texts,75);assert.equal(installed.curatedUnits,375);
    const counts=await d.query<{n:number}>("select count(distinct retention_text_version_id)::int n from lexical_occurrences where source_type='retention' and resolution_status='resolved'");assert.equal(counts[0]!.n,75);
    const rows=await d.query<{version:string;surface:string;start:number;end:number;body:string;status:string;definition:string}>("select o.retention_text_version_id version,o.surface_form surface,o.start_char start,o.end_char \"end\",v.body_text body,l.verification_status status,l.definition_en definition from lexical_occurrences o join retention_text_versions v on v.id=o.retention_text_version_id join lexemes l on l.id=o.lexeme_id where o.source_type='retention'");
    assert.ok(rows.length>=375);
    for(const row of rows){assert.equal(row.body.slice(row.start,row.end),row.surface);assert.ok(row.definition.trim());assert.equal(row.status,'unverified','AI-authored meanings must not be labelled human-verified');}
    const source=readRetentionVocabulary()[0]!,versionId=imported.find(row=>row.sourceId===source.sourceId)!.versionId;
    const before=await retentionOccurrenceSpans(d.db,versionId);
    await ingestRetentionOccurrences(d.db,versionId,source.bodyText,source.vocabulary);
    assert.deepEqual(await retentionOccurrenceSpans(d.db,versionId),before,'reinstall preserves exact occurrence identities');
    const now=new Date('2026-10-19T08:00:00Z');
    const started=await startOrResumeAttempt({userId:student,level:'A2',now,random:()=>0},d.db);
    const payload=await buildAttemptPayload(started.attempt,now,d.db);assertLearnerSafe(payload);
    assert.equal(payload.phase,'reading');if(payload.phase!=='reading')throw Error('phase');assert.ok(payload.occurrences?.length);
    const occurrence=payload.occurrences![0]!;
    const resolved=await resolveRetentionOccurrence({id:student},started.attempt.id,occurrence.id,d.db,now);
    assert.equal(resolved?.status,'resolved');if(resolved?.status!=='resolved')throw Error('sense');
    assert.equal(await resolveRetentionOccurrence({id:other},started.attempt.id,occurrence.id,d.db,now),null);
    const foreign=await retentionOccurrenceSpans(d.db,imported.find(row=>row.versionId!==started.attempt.retentionTextVersionId)!.versionId);
    assert.equal(await resolveRetentionOccurrence({id:student},started.attempt.id,foreign[0]!.id,d.db,now),null);
    const item={...resolved.lexeme,canonicalLexemeId:resolved.lexeme.id,sourceSnapshot:resolved.snapshot};
    const saved=await addVocabularyBatch({userId:student,sourceType:'retention',sourceId:started.attempt.id,items:[item]},d.db as never);
    assert.equal(saved.ok,true);
    const again=await addVocabularyBatch({userId:student,sourceType:'retention',sourceId:started.attempt.id,items:[item]},d.db as never);
    assert.equal(again.ok,true);if(again.ok)assert.equal(again.added,0);
    const contexts=await d.query<{n:number}>("select count(*)::int n from user_vocabulary_contexts where user_id=$1 and source_type='retention'",[student]);assert.equal(contexts[0]!.n,1);
    assert.equal((await d.query<{name:string}>("select name from vocab_folders where user_id=$1",[student]))[0]?.name,'Retention');
    const end=new Date(now.getTime()+1000);
    const recall=await finishReadingEarly({userId:student,attemptId:started.attempt.id,now:end},d.db);
    const recallPayload=await buildAttemptPayload(recall.attempt,end,d.db);assertLearnerSafe(recallPayload);
    assert.ok(!('occurrences' in recallPayload)&&!('bodyText' in recallPayload));
    const locked=await resolveRetentionOccurrence({id:student},started.attempt.id,occurrence.id,d.db,end);
    assert.equal(locked?.status,'locked');
    assert.equal((await resolveRetentionOccurrence({id:student},started.attempt.id,occurrence.id,d.db,new Date(now.getTime()+121000)))?.status,'locked');
    await assert.rejects(()=>d.query("insert into lexical_occurrences(source_type,retention_text_version_id,surface_form,start_char,end_char,resolution_status) values('reading',$1,'wrong',0,5,'unresolved')",[versionId]),/source_check/);
  }finally{await d.close();}
});
