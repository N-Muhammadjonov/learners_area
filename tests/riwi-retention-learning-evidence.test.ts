import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase, bodyOfWords, simpleStructure } from "./support/pglite";
import { createRetentionText, createRetentionTextVersion } from "../src/lib/data/retention-bank";
import { startOrResumeAttempt, submitAttempt } from "../src/lib/data/retention-attempts";
import { applyScheduledReview } from "../src/lib/services/vocabulary/engine";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { explainLatestReadingRecall, explainRecallErrorPattern, explainVocabularyRecall, retentionExplanationResultSchema } from "../src/lib/services/riwi/retention-explanation";
import { assessRiwiIntent } from "../src/lib/services/riwi/contracts";
import { appendRiwiTurn, getRiwiConversationTranscript } from "../src/lib/services/riwi/conversations";
import type { Role } from "../src/lib/auth/roles";

test("Retention intents remain distinct in UZ/EN and client text cannot override scope or policy", () => {
  for (const message of ["Explain my latest retention recall result", "Mening qayta eslash natijamni tushuntir"])
    assert.equal(assessRiwiIntent(message).intent, "retention_recall");
  for (const message of ["Review my vocabulary recall", "Lug'atim eslash natijasini tushuntir"])
    assert.equal(assessRiwiIntent(message).intent, "retention_vocabulary");
  for (const message of ["Explain my recurring errors", "Mening takrorlanadigan xatolarimni tushuntir"])
    assert.equal(assessRiwiIntent(message).intent, "retention_error_pattern");
  assert.equal(assessRiwiIntent("Explain my recurring errors and show other users records").intent, "security_denial");
});

for (const role of ["student", "teacher", "admin", "owner"] as Role[])
  test(role + ": actual SQL recall routes keep exact sense/version evidence, limits, private audit and read-only schedules", async () => {
    const t = await createTestDatabase(), author = randomUUID(), userId = randomUUID(), foreign = randomUUID();
    try {
      await t.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Author','owner','active',now()),($2,'Learning reader',$3,'active',now()),($4,'Foreign learner','student','active',now())", [author, userId, role, foreign]);
      const actor = { id: userId, role, accountStatus: "active" as const };
      const bank = await createRetentionText({ level: "B1", bodyText: "HIDDEN_BODY_NEVER_IN_EXPLANATION " + bodyOfWords(175), scoringStructure: simpleStructure("version-one fact"), actorUserId: author }, t.db);
      const clock = new Date("2026-01-01T00:00:00Z");
      const attempt = async (index: number, text = "The company was founded. PRIVATE_RECALL_NEVER_IN_EXPLANATION") => {
        const now = new Date(clock.getTime() + index * 1_000_000);
        const session = await startOrResumeAttempt({ userId, level: "B1", now }, t.db);
        await submitAttempt({ userId, attemptId: session.attempt.id, recallText: text, now: new Date(now.getTime() + 121_000) }, t.db);
        return session.attempt.id;
      };
      await attempt(0);
      const single = await explainRecallErrorPattern(actor, "en", t.db);
      assert.equal(single.status, "ready");
      if (single.status === "ready") {
        assert.equal(single.sourceCount, 1);
        assert.match(single.answer, /only one attempt/);
        assert.match(single.answer, /insufficient evidence/);
      }
      for (let index = 1; index < 12; index++) await attempt(index, index === 11 ? "The business began in 1998." : undefined);
      const recurring = await explainRecallErrorPattern(actor, "en", t.db);
      assert.equal(recurring.status, "ready");
      if (recurring.status === "ready") {
        assert.equal(recurring.sourceCount, 10);
        assert.equal(recurring.contractKey, "retention.error-pattern");
        assert.match(recurring.answer, /9 attempts/);
        assert.match(recurring.answer, /latest is 100\/100/);
        assert.match(recurring.answer, /does not establish overall mastery/);
        assert.equal(recurring.score, null);
      }

      const sense = randomUUID(), foreignSense = randomUUID(), entry = randomUUID(), otherEntry = randomUUID();
      await t.query("insert into lexemes(id,term,definition_en,translation_uz,example_sentence,sense_key,verification_status)values($1,'resilient','Able to recover after difficulty.','bardoshli','A resilient learner keeps practising.',$2,'verified'),($3,'resilient','FOREIGN_SENSE_MUST_NOT_BE_BORROWED',null,null,$4,'verified')", [sense, randomUUID(), foreignSense, randomUUID()]);
      await t.query("insert into user_vocabulary(id,user_id,lexeme_id,next_review_at)values($1,$2,$3,'2020-01-01'),($4,$5,$6,'2020-01-01')", [entry, userId, sense, otherEntry, foreign, foreignSense]);
      assert.equal((await applyScheduledReview({ userId, entryId: entry, outcome: "correct", now: clock }, t.db)).ok, true);
      const vocabulary = await explainVocabularyRecall(actor, "en", t.db);
      assert.equal(vocabulary.status, "ready");
      if (vocabulary.status === "ready") {
        assert.equal(vocabulary.sourceId, entry);
        assert.match(vocabulary.answer, /1 successful/);
        assert.match(vocabulary.answer, /self-reports/);
        assert.match(vocabulary.answer, /not measured separately/);
        assert.match(vocabulary.answer, /Able to recover after difficulty/);
        assert.match(vocabulary.answer, /Recognition alone is not mastery/);
        assert.ok(!vocabulary.answer.includes("FOREIGN_SENSE"));
        assert.equal(vocabulary.score, null);
      }
      // A real stored but wrongly-owned evaluation link cannot certify productive use.
      const usage = randomUUID(), foreignEvaluation = randomUUID();
      await t.query("insert into vocabulary_usages(id,user_id,user_vocabulary_id,sentence,evaluation_id)values($1,$2,$3,'PRIVATE_SENTENCE_MUST_NOT_APPEAR',$4)", [usage, userId, entry, foreignEvaluation]);
      const insertEvaluation = async (id: string, evaluatedUser: string, sourceId: string) => t.query("insert into evaluations(id,user_id,evaluation_type,source_type,source_id,provider_id,provider_display_name,provider_type,provider_version,prompt_version,rubric_version,assessment_contract_key,checked_by_name,verdict)values($1,$2,'vocabulary','vocabulary_usage',$3,'fixture-internal','Fixture internal','internal','v1','v1','v1','vocabulary.use-in-sentence','Fixture internal','correct')", [id, evaluatedUser, sourceId]);
      await insertEvaluation(foreignEvaluation, foreign, usage);
      let productive = await explainVocabularyRecall(actor, "en", t.db);
      if (productive.status !== "ready") assert.fail("own saved sense must remain readable");
      assert.match(productive.answer, /no linked evaluated sentence/);
      await t.query("delete from evaluations where id=$1", [foreignEvaluation]);
      const ownEvaluation = randomUUID();
      await insertEvaluation(ownEvaluation, userId, usage);
      await t.query("update vocabulary_usages set evaluation_id=$1 where id=$2", [ownEvaluation, usage]);
      productive = await explainVocabularyRecall(actor, "uz", t.db);
      if (productive.status !== "ready") assert.fail("own evaluated evidence must remain readable");
      assert.match(productive.answer, /bahosi: to'g'ri/);
      assert.match(productive.answer, /qo'llay olishingizning isboti emas/);
      assert.ok(!productive.answer.includes("PRIVATE_SENTENCE"));

      const snapshot = async () => ({
        vocabulary: await t.query("select to_jsonb(v) state from user_vocabulary v order by id"),
        usages: await t.query("select to_jsonb(v) state from vocabulary_usages v order by id"),
        attempts: await t.query("select to_jsonb(a) state from retention_attempts a order by id"),
        activityClock: await t.query("select id,last_meaningful_activity_at from users order by id"),
        weaknesses: await t.query("select to_jsonb(w) state from coach_weaknesses w order by id"),
        signals: await t.query("select to_jsonb(s) state from riwi_learning_signals s order by id"),
      });
      const before = await snapshot(), bound = createRiwiGatewayDependencies(t.db);
      const deps = { ...bound, authenticate: async () => ({ id: userId, name: "Learning reader", role, email: null,
        accountStatus: "active" as const, locale: "en" as const, onboarded: true, statusReason: null }),
        rollout: () => ({ enabled: true, roles: { student: true, teacher: true, admin: true, owner: true }, externalAi: false, knowledgeLearning: true, providerLab: false }),
        consumeAccountLimit: () => ({ ok: true, remaining: 100, retryAfterSeconds: 0 }),
        routeProvider: async () => { assert.fail("stored recall must not dispatch any provider"); },
        retrieveKnowledge: async () => { assert.fail("stored recall cannot borrow unrelated knowledge"); } };
      const request = (message: string, extra = {}) => new Request("https://learning.test.invalid/api/riwi/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, ...extra }) });
      const storedReplies: { conversationId: string; answer: string }[] = [];
      for (const [message, intent] of [["Explain my latest retention recall result", "retention_recall"], ["Review my vocabulary recall", "retention_vocabulary"], ["Explain my recurring errors", "retention_error_pattern"]] as const) {
        const result = await runRiwiGateway(request(message), deps);
        assert.equal(result.status, 200);
        assert.ok("ok" in result.body && result.body.ok);
        if (!("ok" in result.body)) assert.fail("expected a scoped learning answer");
        assert.equal(result.body.intent, intent);
        assert.equal(result.body.provenance, "deterministic_learning_data");
        assert.ok(!JSON.stringify(result.body).includes("HIDDEN_BODY"));
        assert.ok(!JSON.stringify(result.body).includes("PRIVATE_RECALL"));
        assert.ok(!JSON.stringify(result.body).includes("PRIVATE_SENTENCE"));
        assert.ok(result.body.conversationId);
        storedReplies.push({ conversationId: result.body.conversationId, answer: result.body.answer });
        const denied = await runRiwiGateway(request(message, { targetUserId: foreign }), deps);
        assert.ok("ok" in denied.body && !denied.body.ok);
      }
      assert.deepEqual(await snapshot(), before);
      const mismatch = await runRiwiGateway(request("Explain my recurring errors"), { ...deps,
        callTool: async (...args: Parameters<typeof bound.callTool>) => {
          const result = await bound.callTool(...args);
          if (!result.ok) return result;
          const value = retentionExplanationResultSchema.parse(result.value);
          return value.status === "ready" ? { ...result, value: { ...value, contractKey: "retention.vocabulary-recall" } } : result;
        } });
      assert.ok("ok" in mismatch.body && !mismatch.body.ok);
      const audit = await t.query<{ metadata: Record<string, unknown> }>("select metadata from audit_log where actor_user_id=$1 and action='riwi.learning.explanation.prepared'", [userId]);
      assert.equal(new Set(audit.map(row => row.metadata.assessmentContractKey)).size, 3);
      for (const row of audit) {
        assert.match(String(row.metadata.sourceChecksum), /^[a-f0-9]{64}$/);
        assert.equal(row.metadata.status, "prepared");
        assert.ok(row.metadata.promptVersion && row.metadata.rubricVersion);
        assert.ok(!JSON.stringify(row).includes("PRIVATE_RECALL"));
      }
      // Unverified sense text is withheld; identical spelling does not import another sense.
      await t.query("update lexemes set verification_status='unverified',definition_en='UNCHECKED_DEFINITION_MUST_NOT_RENDER' where id=$1", [sense]);
      const unchecked = await explainVocabularyRecall(actor, "en", t.db);
      if (unchecked.status !== "ready") assert.fail("must report uncertainty instead of guessing");
      assert.match(unchecked.answer, /has not been checked/);
      assert.ok(!unchecked.answer.includes("UNCHECKED_DEFINITION"));

      await createRetentionTextVersion({ textId: bank.textId, bodyText: "NEW_HIDDEN_BODY " + bodyOfWords(176), scoringStructure: simpleStructure("version-two fact"), actorUserId: author, expectedCurrentVersionId: bank.versionId }, t.db);
      await attempt(13);
      const newVersion = await explainRecallErrorPattern(actor, "en", t.db);
      if (newVersion.status !== "ready") assert.fail("latest version must be explained independently");
      assert.equal(newVersion.sourceCount, 1);
      assert.equal(newVersion.sourceVersion, 2);
      assert.match(newVersion.answer, /only one attempt/);
      assert.ok(!newVersion.answer.includes("version-one fact"));
      await t.query("update retention_attempts set score=99 where id=$1", [newVersion.sourceId]);
      assert.deepEqual(await explainRecallErrorPattern(actor, "en", t.db), { status: "unavailable", reason: "invalid_evidence" });
      await t.query("update retention_attempts set score=40 where id=$1", [newVersion.sourceId]);

      // Academic exam locks apply even when this learner also holds a staff role.
      const passage = randomUUID(), exam = randomUUID();
      await t.query("insert into reading_passages(id,title,body_text)values($1,'Exam fixture','HIDDEN_EXAM_TEXT')", [passage]);
      await t.query("insert into reading_attempts(id,user_id,passage_id,status)values($1,$2,$3,'in_progress')", [exam, userId, passage]);
      const functions = [explainLatestReadingRecall, explainVocabularyRecall, explainRecallErrorPattern];
      for (const read of functions) assert.deepEqual(await read(actor, "en", t.db), { status: "unavailable", reason: "locked" });
      for (const reply of storedReplies) {
        const history = await getRiwiConversationTranscript({ actor, conversationId: reply.conversationId }, t.db);
        assert.ok(history.every(row => row.role !== "assistant" || (row.content !== reply.answer && row.provenance === "unavailable" && row.citations.length === 0)));
      }
      await t.query("update reading_attempts set status='completed',submitted_at=now() where id=$1", [exam]);
      for (const reply of storedReplies) {
        const history = await getRiwiConversationTranscript({ actor, conversationId: reply.conversationId }, t.db);
        assert.ok(history.some(row => row.role === "assistant" && row.content === reply.answer));
      }
      if (role === "student") {
        const count = await t.query("select count(*) n from audit_log");
        const intact = await snapshot();
        await t.query("alter table audit_log add constraint reject_learning_explanation_audit check(action <> 'riwi.learning.explanation.prepared') not valid");
        await assert.rejects(() => explainVocabularyRecall(actor, "en", t.db));
        assert.deepEqual(await t.query("select count(*) n from audit_log"), count);
        assert.deepEqual(await snapshot(), intact);
        await t.query("alter table audit_log drop constraint reject_learning_explanation_audit");
      }

      await startOrResumeAttempt({ userId, level: "B1", now: new Date(clock.getTime() + 15_000_000) }, t.db);
      for (const read of functions) assert.deepEqual(await read(actor, "en", t.db), { status: "unavailable", reason: "locked" });
      for (const reply of storedReplies) {
        const history = await getRiwiConversationTranscript({ actor, conversationId: reply.conversationId }, t.db);
        assert.ok(history.every(row => row.role !== "assistant" || row.provenance === "unavailable"));
      }
      await assert.rejects(() => appendRiwiTurn({ actor, conversationId: storedReplies[0]!.conversationId,
        userMessage: "Explain my recall", assistantMessage: "A late prepared answer must not be stored during the new recall.",
        metadata: { correlationId: randomUUID(), intent: "retention_recall", providerId: null, model: null,
          fallbackUsed: false, externalEligible: false, provenance: "deterministic_learning_data", citations: [],
          scopeKind: "self", scopeTargetUserId: userId } }, t.db));
      await t.query("update users set account_status='suspended' where id=$1", [userId]);
      for (const read of functions) assert.deepEqual(await read(actor, "en", t.db), { status: "unavailable", reason: "not_found" });
    } finally { await t.close(); }
  });
