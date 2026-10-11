import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { explainGrammarRetention } from "../src/lib/services/riwi/grammar-retention";
import { assessRiwiIntent } from "../src/lib/services/riwi/contracts";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { getRiwiConversationHistory, getRiwiConversationTranscript } from "../src/lib/services/riwi/conversations";
import type { Role } from "../src/lib/auth/roles";

test("Grammar review intent chooses its canonical retention route instead of generic Reading recall or production grading", () => {
  for (const message of ["Review my grammar retention", "Explain my grammar recall", "Grammatika takrorlash natijamni tushuntir"])
    assert.equal(assessRiwiIntent(message).intent, "grammar_retention");
  assert.equal(assessRiwiIntent("Evaluate my grammar").intent, "evaluate_grammar");
});

for (const role of ["student", "teacher", "admin", "owner"] as Role[])
  test(role + ": canonical Grammar review distinguishes unassessed writing, deduplicates error evidence and rechecks private history", async () => {
    const t = await createTestDatabase(), userId = randomUUID(), foreign = randomUUID();
    try {
      await t.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Grammar reader',$2,'active',now()),($3,'Foreign learner','student','active',now())", [userId, role, foreign]);
      const actor = { id: userId, role, accountStatus: "active" as const };
      assert.deepEqual(await explainGrammarRetention(actor, "en", t.db), { status: "unavailable", reason: "not_found" });
      const topic = randomUUID(), privateTopic = randomUUID(), exercise = randomUUID(), privateExercise = randomUUID();
      await t.query("insert into grammar_topics(id,title,explanation,\"order\")values($1,'Articles','HIDDEN_RULE_CONTENT',1),($2,'FOREIGN_TOPIC_MUST_NOT_RENDER','FOREIGN_RULE',2)", [topic, privateTopic]);
      await t.query("insert into grammar_exercises(id,topic_id,\"order\",prompt_text,options,correct_option,explanation)values($1,$2,1,'HIDDEN_EXERCISE_PROMPT','[\"a\",\"an\"]','HIDDEN_ANSWER_KEY','PRIVATE_EXERCISE_EXPLANATION')", [exercise, topic]);
      await t.query("insert into grammar_exercises(id,topic_id,\"order\",prompt_text,options,correct_option,explanation,source_owner_user_id)values($1,$2,1,'FOREIGN_EXERCISE','[]','FOREIGN_KEY','FOREIGN_NOTE',$3)", [privateExercise, privateTopic, foreign]);
      const objective = randomUUID(), first = randomUUID(), second = randomUUID(), pending = randomUUID();
      await t.query("insert into grammar_attempts(id,user_id,exercise_id,activity,is_correct,attempted_at)values($1,$5,$6,'correct_it',true,'2026-01-01'),($2,$5,$6,'activate_it',false,'2026-01-02'),($3,$5,$6,'activate_it',false,'2026-01-03'),($4,$5,$6,'activate_it',false,'2026-01-04')", [objective, first, second, pending, userId, exercise]);
      await t.query("update grammar_attempts set selected_option='a' where id=$1", [objective]);
      await t.query("insert into grammar_attempts(user_id,exercise_id,activity,is_correct,attempted_at)values($1,$2,'activate_it',false,'2026-01-05')", [userId, privateExercise]);
      const issue = { category: "GRAMMAR_ARTICLE", message: "A saved article issue.", excerpt: "PRIVATE_STUDENT_QUOTE", severity: "medium" };
      const evaluation = async (attemptId: string, owner: string, issues: unknown[]) => t.query("insert into evaluations(user_id,evaluation_type,source_type,source_id,provider_id,provider_display_name,provider_type,provider_version,prompt_version,rubric_version,assessment_contract_key,checked_by_name,verdict,issues)values($1,'grammar','grammar_attempt',$2,'internal-fixture','Internal fixture','internal','v1','v1','v1','grammar.activate-it','Internal fixture','needs_correction',$3::jsonb)", [owner, attemptId, JSON.stringify(issues)]);
      await evaluation(first, userId, [issue, issue]);
      await evaluation(second, userId, [issue]);
      await evaluation(pending, foreign, [issue]);
      const snapshot = async () => ({ attempts: await t.query("select to_jsonb(a) state from grammar_attempts a order by id"),
        evaluations: await t.query("select to_jsonb(e) state from evaluations e order by id"),
        weaknesses: await t.query("select to_jsonb(w) state from coach_weaknesses w order by id"),
        signals: await t.query("select to_jsonb(s) state from riwi_learning_signals s order by id"),
        activity: await t.query("select id,last_meaningful_activity_at from users order by id") });
      const before = await snapshot();
      for (const language of ["en", "uz"] as const) {
        const answer = await explainGrammarRetention(actor, language, t.db);
        if (answer.status !== "ready") assert.fail("saved, owned Grammar evidence must be available");
        assert.equal(answer.contractKey, "grammar.retention");
        assert.equal(answer.sourceCount, 4);
        assert.equal(answer.score, null);
        assert.equal(answer.sourceId, pending);
        assert.ok(!answer.answer.includes("FOREIGN_"));
        assert.ok(!answer.answer.includes("HIDDEN_"));
        assert.ok(!answer.answer.includes("PRIVATE_"));
        assert.match(answer.answer, language === "en" ? /1 unassessed/ : /1 hali baholanmagan/);
        assert.match(answer.answer, language === "en" ? /2 needing correction/ : /2 tuzatish kerak/);
        assert.match(answer.answer, language === "en" ? /2 distinct attempts/ : /2 alohida urinish/);
        assert.match(answer.answer, language === "en" ? /One error is not a stable weakness/ : /Bitta xato barqaror zaiflik emas/);
        assert.match(answer.answer, language === "en" ? /decay or stable improvement is not established/ : /unutish yoki barqaror o'sish xulosasi chiqarilmaydi/);
      }
      const bound = createRiwiGatewayDependencies(t.db);
      const request = (extra = {}) => new Request("https://grammar-retention.test.invalid/api/riwi/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Review my grammar retention", ...extra }) });
      const deps = { ...bound, authenticate: async () => ({ id: userId, role, name: "Grammar reader", email: null, accountStatus: "active" as const, locale: "en" as const, onboarded: true, statusReason: null }),
        rollout: () => ({ enabled: true, roles: { student: true, teacher: true, admin: true, owner: true }, externalAi: false, knowledgeLearning: true, providerLab: false }),
        consumeAccountLimit: () => ({ ok: true, remaining: 20, retryAfterSeconds: 0 }),
        routeProvider: async () => { assert.fail("Grammar recall summary must not dispatch a provider"); },
        retrieveKnowledge: async () => { assert.fail("saved Grammar evidence must not be replaced by generic knowledge"); } };
      const response = await runRiwiGateway(request(), deps);
      assert.ok("ok" in response.body && response.body.ok);
      if (!("ok" in response.body)) assert.fail("expected canonical Grammar reply");
      assert.equal(response.body.intent, "grammar_retention");
      assert.ok(response.body.conversationId);
      const conversationId = response.body.conversationId, storedAnswer = response.body.answer;
      assert.deepEqual(await getRiwiConversationHistory({ actor, conversationId }, t.db), []);
      const denied = await runRiwiGateway(request({ targetUserId: foreign }), deps);
      assert.ok("ok" in denied.body && !denied.body.ok);
      assert.deepEqual(await snapshot(), before);
      const passage = randomUUID(), exam = randomUUID();
      await t.query("insert into reading_passages(id,title,body_text)values($1,'Active exam','HIDDEN_EXAM')", [passage]);
      await t.query("insert into reading_attempts(id,user_id,passage_id,status)values($1,$2,$3,'in_progress')", [exam, userId, passage]);
      assert.deepEqual(await explainGrammarRetention(actor, "en", t.db), { status: "unavailable", reason: "locked" });
      const hidden = await getRiwiConversationTranscript({ actor, conversationId }, t.db);
      assert.ok(hidden.every(row => row.role !== "assistant" || row.provenance === "unavailable"));
      await t.query("update reading_attempts set status='completed' where id=$1", [exam]);
      const visible = await getRiwiConversationTranscript({ actor, conversationId }, t.db);
      assert.ok(visible.some(row => row.role === "assistant" && row.content === storedAnswer));
      await t.query("update users set role=$1 where id=$2", [role === "owner" ? "student" : "owner", userId]);
      assert.deepEqual(await explainGrammarRetention(actor, "en", t.db), { status: "unavailable", reason: "not_found" });
      const revoked = await getRiwiConversationTranscript({ actor, conversationId }, t.db);
      assert.ok(revoked.every(row => row.role !== "assistant" || row.provenance === "unavailable"));
    } finally { await t.close(); }
  });
