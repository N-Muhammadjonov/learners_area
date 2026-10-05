import assert from "node:assert/strict";
import test from "node:test";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { providerRegistry, registerProvider } from "../src/lib/services/coach/registry";
import { resolveEvaluation, type EvaluationRequest } from "../src/lib/services/coach/resolver";
import { RiwiProvider } from "../src/lib/services/coach/providers/riwi";
import { providerOk, type EvaluationContext } from "../src/lib/services/coach/types";
import { GOOD_OUTPUT, TestEvaluationProvider } from "./support/test-provider";
import { criteriaFor, deriveOverall, normalizeWritingCriteria, toHalfBand } from "../src/lib/writing/grade-criteria";
import { createGradeRequest, normalizeAnalysis, normalizeGradeResult, runGrade, CLAIM_STALE_MS } from "../src/lib/services/writing/grade";
import { createTestDatabase } from "./support/pglite";
import { users, writingGradeRequests } from "../src/db/schema";
import { eq } from "drizzle-orm";
import type { EvaluationResult } from "../src/lib/services/coach/schema";
import type { ServiceOutcome } from "../src/lib/services/coach/service";

const REQ: EvaluationRequest = { evaluationType: "writing", input: { taskType: "task1", prompt: "The chart shows…", content: "word ".repeat(160), targetWordCount: 150, detailedAnalysis: true } };
const CTX = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await run(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const reset = () => { providerRegistry.clear(); providerRegistry.register(new RiwiProvider()); };

test("W1 Task 1 uses Task Achievement, Task 2 Task Response; exactly four criteria", () => {
  assert.deepEqual(criteriaFor("task1"), ["task_achievement", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"]);
  assert.deepEqual(criteriaFor("task2")[0], "task_response");
  const n = normalizeWritingCriteria("task1", [
    { key: "task_response", label: "Task Response", band: 6 }, { key: "cc", label: "Coherence", band: 6.5 },
    { key: "lexical_resource", label: "LR", band: 7 }, { key: "grammar", label: "GRA", band: 6 },
  ])!;
  assert.equal(n.criteria[0]!.key, "task_achievement");
  assert.equal(n.criteria[0]!.label, "Task Achievement", "a provider's Task Response label is relabelled for Task 1");
  assert.equal(n.criteria.length, 4);
});

test("W2 half bands: 6.37 → 6.5, out-of-range/non-numeric rejected; missing/duplicate criterion rejects the grade", () => {
  assert.equal(toHalfBand(6.37), 6.5);
  assert.equal(toHalfBand(6.2), 6);
  assert.equal(toHalfBand(9.5), null);
  assert.equal(toHalfBand(Number.NaN), null);
  const three = [{ key: "task_response", label: "", band: 6 }, { key: "coherence_cohesion", label: "", band: 6 }, { key: "lexical_resource", label: "", band: 6 }];
  assert.equal(normalizeWritingCriteria("task2", three), null);
  assert.equal(normalizeWritingCriteria("task2", [...three, { key: "grammar", label: "", band: 6 }, { key: "lexical", label: "", band: 7 }]), null);
  assert.equal(normalizeWritingCriteria("task2", [...three, { key: "grammar", label: "", band: null }]), null);
});

test("W3 the server derives the overall (mean → nearest half) and ignores the provider overall", () => {
  assert.equal(deriveOverall([6, 6, 6, 7]), 6.5); // 6.25 → 6.5
  assert.equal(deriveOverall([6, 7, 7, 7]), 7); // 6.75 → 7
  assert.equal(deriveOverall([6, 6, 6.5, 6]), 6); // 6.125 → 6
  const result = { providerType: "external", fallbackUsed: false, overallEstimate: 8.5, criteria: [
    { key: "task_response", label: "x", band: 6 }, { key: "coherence_cohesion", label: "x", band: 6 },
    { key: "lexical_resource", label: "x", band: 6 }, { key: "grammatical_range_accuracy", label: "x", band: 7 }] } as unknown as EvaluationResult;
  assert.equal(normalizeGradeResult("task2", result)!.overallEstimate, 6.5);
});

test("W4 RIWI is never accepted as an AI grade", () => {
  const base = { overallEstimate: 6, criteria: GOOD_OUTPUT.criteria } as unknown as EvaluationResult;
  assert.equal(normalizeGradeResult("task2", { ...base, providerType: "internal", fallbackUsed: false } as EvaluationResult), null);
  assert.equal(normalizeGradeResult("task2", { ...base, providerType: "external", fallbackUsed: true } as EvaluationResult), null);
});

test("W5 fallback policy 'none': RIWI configured → external_required; external failure → no RIWI result", async () => {
  try {
    const riwiOnly = await withEnv({ AI_PRIMARY_PROVIDER: undefined }, () => resolveEvaluation(REQ, CTX, undefined, { fallback: "none" }));
    assert.equal(riwiOnly.ok, false);
    if (!riwiOnly.ok) assert.equal(riwiOnly.error, "external_required");
    registerProvider(new TestEvaluationProvider({ behaviour: "fail" }));
    const failed = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () => resolveEvaluation(REQ, CTX, { maxAttempts: 1 }, { fallback: "none" }));
    assert.equal(failed.ok, false);
    if (!failed.ok) { assert.equal(failed.error, "evaluation_unavailable"); assert.ok(failed.attempts.every((a) => a.providerId !== "riwi")); }
    // Ordinary Coach writing still follows the default fallback policy; Grade My Work does not.
    const ordinaryWriting: EvaluationRequest = { ...REQ, input: { ...REQ.input, detailedAnalysis: false } };
    const legacy = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () => resolveEvaluation(ordinaryWriting, CTX, { maxAttempts: 1 }));
    assert.equal(legacy.ok && legacy.result.providerId, "riwi");
  } finally { reset(); }
});

test("W6 the W7 analysis travels beside the strict result and task-contract versions are recorded", async () => {
  class Analyst extends TestEvaluationProvider {
    versionsFor = () => ({ promptVersion: "provider-prompt-v0", rubricVersion: "provider-rubric-v0" });
    async evaluateWriting(_ctx: EvaluationContext) {
      const L = (t: string) => ({ en: t, uz: t });
      const criterionNarratives = [
        { key: "task_achievement", narrative: L("A clear overview is present."), evidence: ["word word"] },
        { key: "coherence_cohesion", narrative: L("The sequence is easy to follow."), evidence: ["word word"] },
        { key: "lexical_resource", narrative: L("Vocabulary is consistent."), evidence: ["word word"] },
        { key: "grammatical_range_accuracy", narrative: L("Sentence forms are controlled."), evidence: ["word word"] },
      ];
      const analysis = { examinerComment: L("Clear overview."), criterionNarratives, sentenceFeedback: [], topFixes: [{ title: L("Overview"), explanation: L("Add one."), examples: [] }] };
      assert.ok(normalizeAnalysis("task1", analysis));
      assert.equal(normalizeAnalysis("task1", { ...analysis, criterionNarratives: [{ ...criterionNarratives[0]!, key: "task_response" }, ...criterionNarratives.slice(1)] }), null,
        "Task 1 narratives must use the exact Task Achievement criterion key");
      assert.equal(normalizeAnalysis("task1", { ...analysis, criterionNarratives: [{ ...criterionNarratives[0]!, evidence: [] }, ...criterionNarratives.slice(1)] }), null,
        "each Grade My Work criterion narrative needs a grounded evidence quote");
      return providerOk({ ...GOOD_OUTPUT, writingAnalysis: analysis });
    }
  }
  registerProvider(new Analyst());
  try {
    const out = await withEnv({ AI_PRIMARY_PROVIDER: "test-external" }, () => resolveEvaluation(REQ, CTX, undefined, { fallback: "none" }));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const contract = getAssessmentContract("writing.grade.task1");
    assert.ok(contract);
    assert.equal(out.result.promptVersion, contract.version);
    assert.equal(out.result.rubricVersion, contract.rubricVersion);
    assert.notEqual(out.result.promptVersion, "provider-prompt-v0");
    assert.notEqual(out.result.rubricVersion, "provider-rubric-v0");
    assert.equal("writingAnalysis" in out.result, false);
    assert.equal(out.extras.writingAnalysis?.examinerComment.en, "Clear overview.");
  } finally { reset(); }
});

test("W7 snapshot is idempotent; one claim means one provider call; failure keeps the essay and allows retry", async () => {
  const t = await createTestDatabase();
  try {
    const [u] = await t.db.insert(users).values({ email: "g@example.test", name: "G", passwordHash: "x" } as typeof users.$inferInsert).returning();
    const input = { taskType: "task2" as const, question: "Some people think that… Discuss both views.", essay: "word ".repeat(260), idempotencyKey: "key-12345678" };
    const a = await createGradeRequest(u!.id, input, t.db);
    const b = await createGradeRequest(u!.id, input, t.db);
    assert.equal(a.row.id, b.row.id);
    assert.equal(b.created, false);
    assert.equal(a.row.wordCount, 260);

    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowFail = async (): Promise<ServiceOutcome> => { calls += 1; await gate; return { ok: false, error: "evaluation_unavailable" }; };
    const first = runGrade(a.row.id, u!.id, "en", { database: t.db, evaluate: slowFail });
    await new Promise((r) => setTimeout(r, 20));
    const second = await runGrade(a.row.id, u!.id, "en", { database: t.db, evaluate: slowFail });
    assert.deepEqual(second, { ok: false, requestId: a.row.id, error: "in_progress" });
    release();
    const firstOut = await first;
    assert.equal(firstOut.ok, false);
    assert.equal(calls, 1, "a concurrent second request never calls the provider");
    const saved = await t.db.query.writingGradeRequests.findFirst({ where: eq(writingGradeRequests.id, a.row.id) });
    assert.equal(saved!.status, "failed");
    assert.equal(saved!.essayText, input.essay, "the essay is never erased");
    assert.equal(saved!.claimedAt, null);

    const ok = await runGrade(a.row.id, u!.id, "en", { database: t.db, evaluate: async () => ({ ok: true, evaluation: {} as never, reused: false, extras: {} }) });
    assert.equal(ok.ok, true);
    const done = await t.db.query.writingGradeRequests.findFirst({ where: eq(writingGradeRequests.id, a.row.id) });
    assert.equal(done!.status, "evaluated");
    const again = await runGrade(a.row.id, u!.id, "en", { database: t.db, evaluate: async () => { throw new Error("must not be called"); } });
    assert.equal(again.ok, true, "an evaluated essay is read back, not re-graded");
    assert.ok(CLAIM_STALE_MS >= 60_000);
  } finally { await t.close(); }
});

test("W8 0031 constraints: exam timer truth and grade snapshot bounds are enforced by Postgres", async () => {
  const t = await createTestDatabase();
  try {
    await assert.rejects(t.query(`INSERT INTO writing_grade_requests (user_id, task_type, question_text, essay_text, word_count, idempotency_key) VALUES (gen_random_uuid(), 'task2', 'short', 'x', 1, 'k')`));
    const cols = await t.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'writing_exam_sessions'`);
    assert.ok(cols.some((c) => c.column_name === "expires_at"));
    const checks = await t.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'writing_exam_sessions'::regclass AND contype = 'c'`);
    assert.ok(checks.some((c) => /1200.*2400/.test(c.def)));
  } finally { await t.close(); }
});

test("G1–G5 Grade My Work additions: writing readiness, Task 1 visual link, annotated essay, no regrade on view", async () => {
  const { readFileSync } = await import("node:fs");
  const { annotateEssay } = await import("../src/lib/writing/annotate");
  // G1 readiness is the Writing capability, not Speaking.
  assert.match(readFileSync("src/components/writing/workspace/WritingGradeTab.tsx", "utf8"), /writingAiReady\(\)/);
  // G2 a chosen published prompt is authoritative and stored with the request.
  const route = readFileSync("src/app/api/writing/grade/route.ts", "utf8");
  assert.match(route, /livePromptForGrade\(parsed\.data\.promptId, parsed\.data\.taskType\)/);
  assert.match(route, /question: prompt\.prompt, promptId: prompt\.id/);
  const t = await createTestDatabase();
  try {
    const cols = await t.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'writing_grade_requests'`);
    assert.ok(cols.some((c) => c.column_name === "prompt_id"));
  } finally { await t.close(); }
  // Annotated essay marks only verbatim quotes, never invented text.
  const essay = "First sentence is fine. Second sentense has error. Third.";
  const segs = annotateEssay(essay, [{ index: 2, original: "Second sentense has error." }, { index: 5, original: "Not in the essay." }]);
  assert.equal(segs.map((s) => s.text).join(""), essay);
  assert.deepEqual(segs.filter((s) => s.mark != null).map((s) => s.mark), [2]);
  // G4/G5 the result page never calls a provider.
  const page = readFileSync("src/app/(app)/writing/grade/[id]/page.tsx", "utf8");
  assert.doesNotMatch(page, /runGrade|evaluateAndPersist|resolveEvaluation/);
  assert.match(page, /data-grade-annotated/);
});
