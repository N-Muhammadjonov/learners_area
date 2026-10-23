import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { reviseRetentionWording, type RetentionWordingRevision } from "../src/lib/retention/source-revision";
import { sha, stableJson, projectId } from "../src/lib/dictionary/model";

const draft = JSON.parse(readFileSync(new URL("../content/dictionary/retention-wording-revisions-draft.json", import.meta.url), "utf8"));
const plan = draft.revisions[0] as RetentionWordingRevision;
const owner = readFileSync(new URL("../content/retention-v4/C1.jsonl", import.meta.url), "utf8").trim().split("\n")
  .map(line => JSON.parse(line)).find(row => row.sourceId === "C1-005");

test("Retention wording creates a guarded immutable version and preserves old results, occurrences and saved words", async t => {
  const env = await createTestDatabase();
  try {
    assert.equal(sha(owner.bodyText), plan.bodySha);
    assert.equal(sha(stableJson(owner.scoringStructure)), plan.structureSha);
    const [actor] = await env.query<{ id: string }>("insert into users(name,role,account_status) values('Revision QA owner','owner','active') returning id");
    const [learner] = await env.query<{ id: string }>("insert into users(name,role,account_status) values('Revision QA learner','student','active') returning id");
    const [parent] = await env.query<{ id: string }>("insert into retention_texts(level,internal_label,sequence) values('C1','C1 revision QA',1) returning id");
    await env.query("insert into retention_text_versions(id,retention_text_id,version_number,body_text,word_count,scoring_structure) values($1,$2,1,$3,$4,$5::jsonb)",
      [plan.sourceVersionId, parent!.id, owner.bodyText, owner.declaredWordCount, JSON.stringify(owner.scoringStructure)]);
    await env.query("update retention_texts set current_version_id=$1 where id=$2", [plan.sourceVersionId, parent!.id]);
    const [lexeme] = await env.query<{ id: string }>("insert into lexemes(term,part_of_speech,definition_en,translation_uz) values('hospital','n','A healthcare institution','shifoxona') returning id");
    for (const surface of ["hospital", "discretion"]) {
      const start = owner.bodyText.indexOf(surface);
      await env.query("insert into lexical_occurrences(source_type,retention_text_version_id,start_char,end_char,surface_form,lexeme_id,resolution_status) values('retention',$1,$2,$3,$4,$5,'resolved')",
        [plan.sourceVersionId, start, start + surface.length, surface, lexeme!.id]);
    }
    await env.query("insert into user_vocabulary(user_id,lexeme_id,srs_stage) values($1,$2,4)", [learner!.id, lexeme!.id]);
    await env.query("insert into retention_attempts(user_id,retention_text_id,retention_text_version_id,level,status,read_started_at,read_ends_at,write_started_at,write_ends_at,score,recall_text) values($1,$2,$3,'C1','completed',now()-interval '10 minutes',now()-interval '8 minutes',now()-interval '8 minutes',now()-interval '5 minutes',60,'Saved historical recall')",
      [learner!.id, parent!.id, plan.sourceVersionId]);
    const before = { version: await env.query("select * from retention_text_versions"), occurrences: await env.query("select * from lexical_occurrences order by start_char"),
      attempts: await env.query("select * from retention_attempts"), words: await env.query("select * from user_vocabulary") };
    await t.test("invalid actor, stale identities and changed source are refused without writes", async () => {
      await assert.rejects(() => reviseRetentionWording(plan, learner!.id, env.db), /retention_revision_forbidden/);
      for (const field of ["bodySha", "structureSha", "nextBodySha"] as const) {
        await assert.rejects(() => reviseRetentionWording({ ...plan, [field]: sha("stale") }, actor!.id, env.db), /retention_revision_(source|body)_changed/);
      }
      await assert.rejects(() => reviseRetentionWording({ ...plan, before: "bear THEM" }, actor!.id, env.db), /retention_revision_source_changed/);
      await assert.rejects(() => reviseRetentionWording({ ...plan, nextVersionId: projectId("qa", "wrong") }, actor!.id, env.db), /retention_revision_identity_changed/);
      assert.deepEqual(await env.query("select * from retention_text_versions"), before.version);
    });
    await t.test("overlap is refused instead of silently losing a source occurrence", async () => {
      const [overlap] = await env.query<{ id: string }>("insert into lexical_occurrences(source_type,retention_text_version_id,start_char,end_char,surface_form,resolution_status) values('retention',$1,$2,$3,'bear','unresolved') returning id", [plan.sourceVersionId, plan.start, plan.start + 4]);
      await assert.rejects(() => reviseRetentionWording(plan, actor!.id, env.db), /retention_revision_occurrence_overlap/);
      await env.query("delete from lexical_occurrences where id=$1", [overlap!.id]);
      assert.equal((await env.query("select * from retention_text_versions")).length, 1);
    });
    const result = await reviseRetentionWording(plan, actor!.id, env.db);
    assert.equal(result.created, true); assert.equal(result.versionNumber, 2); assert.equal(result.versionId, plan.nextVersionId);
    assert.deepEqual(await env.query("select * from retention_text_versions where id=$1", [plan.sourceVersionId]), before.version);
    assert.deepEqual(await env.query("select * from lexical_occurrences where retention_text_version_id=$1 order by start_char", [plan.sourceVersionId]), before.occurrences);
    assert.deepEqual(await env.query("select * from retention_attempts"), before.attempts);
    assert.deepEqual(await env.query("select * from user_vocabulary"), before.words);
    const [next] = await env.query<{ body_text: string; scoring_structure: unknown }>("select body_text,scoring_structure from retention_text_versions where id=$1", [plan.nextVersionId]);
    assert.equal(sha(next!.body_text), plan.nextBodySha); assert.deepEqual(next!.scoring_structure, owner.scoringStructure);
    const copied = await env.query<{ start_char: number; end_char: number; surface_form: string }>("select start_char,end_char,surface_form from lexical_occurrences where retention_text_version_id=$1 order by start_char", [plan.nextVersionId]);
    assert.equal(copied.length, 2); for (const row of copied) assert.equal(next!.body_text.slice(row.start_char, row.end_char), row.surface_form);
    assert.equal((await reviseRetentionWording(plan, actor!.id, env.db)).created, false);
    assert.equal((await env.query("select * from retention_text_versions")).length, 2);
    assert.equal((await env.query("select * from lexical_occurrences")).length, 4);
    // A later edit must never be replaced with this older prepared revision.
    await env.query("update retention_texts set current_version_id=$1 where id=$2", [plan.sourceVersionId, parent!.id]);
    await assert.rejects(() => reviseRetentionWording(plan, actor!.id, env.db), /retention_revision_source_not_current/);
  } finally { await env.close(); }
});
