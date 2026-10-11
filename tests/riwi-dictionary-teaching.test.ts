import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { selectDictionaryTask, teachDictionaryEntry, dictionaryTeachingSchema, dictionaryResolvedAnswerSchema } from "../src/lib/services/riwi/dictionary-teaching";
import { extractDictionaryTerm, lookupDictionaryOccurrence, type DictionaryLookup } from "../src/lib/services/riwi/dictionary";
import { createTestDatabase } from "./support/pglite";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { createRiwiCoreTools } from "../src/lib/services/riwi/core-tools";
import { createRetentionText } from "../src/lib/data/retention-bank";
import { startOrResumeAttempt } from "../src/lib/data/retention-attempts";
import { bodyOfWords, simpleStructure } from "./support/pglite";

type Entry = Extract<DictionaryLookup, { status: "resolved" }>;
function entry(): Entry {
  const id = randomUUID();
  return { status: "resolved", canonicalLexemeId: id, senseId: id, term: "bank", definitionEn: "land beside a river",
    translationUz: "qirg'oq", partOfSpeech: "noun", lexicalType: "word", example: "They sat on the river bank.",
    collocations: "river bank", source: "Canonical catalogue", verified: true, pronunciation: null, occurrence: null };
}

test("meaning/translation use ordered canonical stages, exact facts and stable task/source versions", () => {
  const source = entry(), original = JSON.stringify(source);
  for (const language of ["en", "uz"] as const) {
    const meaning = teachDictionaryEntry(source, "vocabulary.meaning", language);
    const translation = teachDictionaryEntry(source, "vocabulary.translation", language);
    assert.deepEqual(meaning.teaching.stages.map(s => s.kind), ["canonical_sense", "simple_meaning", "example"]);
    assert.deepEqual(translation.teaching.stages.map(s => s.kind), ["canonical_sense", "contextual_translation", "example"]);
    assert.equal(meaning.teaching.stages[1]?.text, source.definitionEn);
    assert.equal(translation.teaching.stages[1]?.text, "bank: qirg'oq");
    assert.equal(meaning.teaching.stages[2]?.text, source.example);
    assert.equal(meaning.teaching.evidenceComplete, true);
    assert.equal(translation.teaching.evidenceComplete, true);
    assert.equal(meaning.uncertainty, null);
    assert.equal(meaning.teaching.sourceHash, teachDictionaryEntry({ ...source }, "vocabulary.meaning", language).teaching.sourceHash);
    assert.notEqual(meaning.teaching.sourceHash, translation.teaching.sourceHash);
    assert.notEqual(meaning.teaching.sourceHash, teachDictionaryEntry({ ...source, definitionEn: "changed" }, "vocabulary.meaning", language).teaching.sourceHash);
    assert.ok(dictionaryResolvedAnswerSchema.safeParse({ ...source, ...meaning }).success);
    assert.ok(!dictionaryTeachingSchema.safeParse({ ...meaning.teaching, evidenceComplete: false }).success);
    assert.ok(!meaning.answer.includes("financial institution"));
  }
  assert.equal(JSON.stringify(source), original);
});

test("missing/unverified evidence never receives complete credit or fabricated examples/translations", () => {
  for (const language of ["en", "uz"] as const) {
    const source = { ...entry(), example: null, translationUz: null };
    const meaning = teachDictionaryEntry(source, "vocabulary.meaning", language);
    const translation = teachDictionaryEntry(source, "vocabulary.translation", language);
    assert.equal(meaning.teaching.evidenceComplete, false);
    assert.equal(meaning.teaching.stages[2]?.status, "missing");
    assert.equal(translation.teaching.stages[1]?.status, "missing");
    assert.ok(translation.uncertainty);
    assert.ok(!translation.answer.includes("They sat"));
    assert.ok(!translation.answer.includes("qirg'oq"));
    const candidate = teachDictionaryEntry({ ...entry(), verified: false }, "vocabulary.meaning", language);
    assert.equal(candidate.teaching.evidenceComplete, false);
    assert.ok(candidate.uncertainty);
  }
  assert.throws(() => teachDictionaryEntry({ ...entry(), senseId: randomUUID() }, "vocabulary.meaning", "en"), /evidence_invalid/);
  assert.throws(() => teachDictionaryEntry({ ...entry(), definitionEn: " " }, "vocabulary.meaning", "en"));
});

test("full evidence is preserved while long visible excerpts stay within the existing chat contract", () => {
  const source = { ...entry(), definitionEn: "d".repeat(4000), translationUz: "t".repeat(2000), example: "e".repeat(2000), collocations: "c".repeat(2000) };
  for (const task of ["vocabulary.meaning", "vocabulary.translation"] as const) {
    const answer = teachDictionaryEntry(source, task, "en");
    assert.ok(answer.answer.length <= 6000);
    assert.match(answer.answer, /source excerpt shortened/);
    assert.equal(answer.teaching.stages[2]?.text.length, 2000);
  }
});

test("finite language selectors extract translation terms without changing dictionary authority", () => {
  for (const message of ["translate bank", "translation of 'bank'", "bank tarjimasi?", "переведи bank", "перевод слова bank"]) {
    assert.equal(selectDictionaryTask(message), "vocabulary.translation");
    assert.equal(extractDictionaryTerm(message), "bank");
  }
  assert.equal(selectDictionaryTask("meaning of bank"), "vocabulary.meaning");
});

test("real broker/gateway teaches the exact authorized river sense, projects occurrence DTO safely and rejects tampered teaching", async () => {
  const t = await createTestDatabase(), userId = randomUUID(), other = randomUUID(), passage = randomUUID(), attempt = randomUUID();
  const sense = randomUUID(), sibling = randomUUID(), occurrence = randomUUID();
  try {
    await t.query("insert into users(id,name,role,account_status)values($1,'Reader','student','active'),($2,'Other','student','active')", [userId, other]);
    await t.query("insert into lexemes(id,term,definition_en,translation_uz,example_sentence,sense_key,provenance,verification_status)values($1::uuid,'bank','land beside a river','qirg''oq','They sat on the river bank.',$1::text,'authored','verified'),($2::uuid,'bank','a financial institution','moliyaviy bank','The bank lends money.',$2::text,'authored','verified')", [sense, sibling]);
    await t.query("insert into reading_passages(id,title,body_text)values($1,'River story','They sat on the river bank.')", [passage]);
    await t.query("insert into reading_attempts(id,user_id,passage_id,status)values($1,$2,$3,'completed')", [attempt, userId, passage]);
    await t.query("insert into lexical_occurrences(id,passage_id,lexeme_id,surface_form,start_char,end_char,sentence_text)values($1,$2,$3,'bank',22,26,'They sat on the river bank.')", [occurrence, passage, sense]);
    const bound = createRiwiGatewayDependencies(t.db);
    const deps = { ...bound, authenticate: async () => ({ id: userId, role: "student" as const, name: "Reader", email: null, accountStatus: "active" as const, locale: "en" as const, onboarded: true, statusReason: null }),
      rollout: () => ({ enabled: true, roles: { student: true, teacher: true, admin: true, owner: true }, externalAi: false, knowledgeLearning: true, providerLab: false }),
      consumeAccountLimit: () => ({ ok: true, remaining: 20, retryAfterSeconds: 0 }),
      routeProvider: async () => { assert.fail("dictionary facts must not dispatch any provider"); },
      retrieveKnowledge: async () => { assert.fail("generic knowledge must not replace exact dictionary authority"); } };
    const request = (extra: object = {}) => new Request("https://dictionary.test.invalid/api/riwi/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "translate bank", dictionaryOccurrence: { sourceType: "reading", sourceId: attempt, occurrenceId: occurrence }, ...extra }) });
    const result = await runRiwiGateway(request(), deps);
    if (!("ok" in result.body) || !result.body.ok) assert.fail(JSON.stringify(result.body));
    assert.equal(result.body.dictionaryEntry?.senseId, sense);
    assert.match(result.body.answer, /bank: qirg'oq/);
    assert.match(result.body.answer, /not a translation of the whole sentence/);
    assert.ok(!result.body.answer.includes("financial institution"));
    assert.ok(!JSON.stringify(result.body.dictionaryEntry).includes(attempt));
    assert.ok(!JSON.stringify(result.body.dictionaryEntry).includes(passage));
    assert.deepEqual(await lookupDictionaryOccurrence({ actor: { id: other, role: "student" }, sourceType: "reading", sourceId: attempt, occurrenceId: occurrence }, t.db), { status: "unresolved" });
    for (const mutate of [
      (value: Record<string, unknown>) => ({ ...value, answer: "Invented synonym and translation." }),
      (value: Record<string, unknown>) => ({ ...value, teaching: { ...(value.teaching as object), sourceHash: "0".repeat(64) } }),
      (value: Record<string, unknown>) => ({ ...value, teaching: { ...(value.teaching as object), task: "vocabulary.meaning" } }),
    ]) {
      const tampered = await runRiwiGateway(request(), { ...deps, callTool: async (...args) => {
        const result = await bound.callTool(...args);
        return result.ok ? { ok: true as const, value: mutate(result.value as Record<string, unknown>) } : result;
      } });
      assert.ok("ok" in tampered.body && !tampered.body.ok);
    }
    const saved = await t.query<{ content: string }>("select content from riwi_conversation_messages");
    assert.ok(saved.every(row => !row.content.includes("Invented synonym")));
    await t.query("update lexical_occurrences set start_char=23 where id=$1", [occurrence]);
    const stale = await runRiwiGateway(request(), deps);
    assert.ok("ok" in stale.body && !stale.body.ok);
    await t.query("update lexical_occurrences set start_char=22 where id=$1", [occurrence]);
    await t.query("update users set role='owner' where id=$1", [other]);
    await createRetentionText({ level: "B1", bodyText: bodyOfWords(175), scoringStructure: simpleStructure("late dictionary fence"), actorUserId: other }, t.db);
    const late = await runRiwiGateway(request(), { ...deps, callTool: async (...args) => {
      const result = await bound.callTool(...args);
      assert.ok(result.ok);
      await startOrResumeAttempt({ userId, level: "B1" }, t.db);
      return result;
    } });
    assert.ok("ok" in late.body && !late.body.ok, "a recall allocated after lookup prevents feedback delivery and persistence");
  } finally { await t.close(); }
});

test("dictionary tool rejects forged task fields and mandatory source audit failure; explanation never awards learning credit", async () => {
  const t = await createTestDatabase(), userId = randomUUID(), sense = randomUUID();
  try {
    await t.query("insert into users(id,name,role,account_status)values($1,'Dictionary learner','student','active')", [userId]);
    await t.query("insert into lexemes(id,term,definition_en,sense_key,provenance,verification_status)values($1::uuid,'resilient','able to recover',$1::text,'authored','verified')", [sense]);
    const broker = createRiwiCoreTools(t.db), actor = { id: userId, role: "student" as const, accountStatus: "active" as const };
    assert.equal(broker.contract("riwi.dictionary.lookup")?.version, "1.1.0");
    const call = (input: unknown) => broker.call("riwi.dictionary.lookup", input, { actor, correlationId: randomUUID() });
    assert.deepEqual(await call({ term: "resilient", task: "vocabulary.contextual-meaning" }), { ok: false, code: "riwi_tool_invalid_input" });
    assert.deepEqual(await call({ term: "resilient", senseId: sense }), { ok: false, code: "riwi_tool_invalid_input" });
    const result = await call({ term: "resilient", task: "vocabulary.translation", language: "uz" });
    assert.ok(result.ok);
    if (!result.ok) assert.fail("the canonical incomplete explanation should be honest, not generated");
    const parsed = dictionaryResolvedAnswerSchema.parse(result.value);
    assert.equal(parsed.teaching.evidenceComplete, false);
    assert.ok(parsed.uncertainty);
    const receipts = await t.query<{ metadata: Record<string, unknown> }>("select metadata from audit_log where target_type='riwi_dictionary_sense'");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.metadata.assessmentContractKey, "vocabulary.translation");
    assert.equal(receipts[0]?.metadata.sourceChecksum, parsed.teaching.sourceHash);
    assert.equal(receipts[0]?.metadata.status, "incomplete");
    assert.ok(!JSON.stringify(receipts).includes("able to recover"), "prepared audit carries fingerprints, not lexical/source text");
    await t.query("create function dictionary_audit_failure() returns trigger language plpgsql as $$ begin if NEW.target_type='riwi_dictionary_sense' then raise exception 'dictionary_audit_rejected'; end if; return NEW; end $$");
    await t.query("create trigger dictionary_audit_failure before insert on audit_log for each row execute function dictionary_audit_failure()");
    assert.deepEqual(await call({ term: "resilient" }), { ok: false, code: "riwi_tool_failed" });
    assert.equal((await t.query("select id from audit_log where target_type='riwi_dictionary_sense'")).length, 1, "failed preparation leaves no fabricated audit receipt");
    for (const table of ["evaluations", "vocab_point_events", "vocabulary_usages", "riwi_learning_signals", "coach_weaknesses"])
      assert.equal((await t.query<{ n: number }>(`select count(*)::int n from ${table}`))[0]?.n, 0, "explanation cannot create assessment or points");
  } finally { await t.close(); }
});
