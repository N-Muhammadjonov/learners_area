import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { auditLog, evaluations, riwiKnowledgeConflicts, riwiKnowledgeSources, riwiKnowledgeUnits, riwiLearningReviews, riwiLearningSignals, teacherStudentLinks, users } from "../src/db/schema";
import { createTestDatabase, migrateTestDatabase } from "./support/pglite";
import { installOwnerHistoryCursorTestSecret } from "./support/riwi-history-cursor";

test.after(installOwnerHistoryCursorTestSecret());
import {
  LearningServiceError,
  createLearningSignal,
  createKnowledgeCandidateFromLearningSignal,
  recordEvaluationOutcomeSignal,
  submitRiwiStudentFeedback,
  listLearningCandidateForOwner,
  listLearningSignalPage,
  listLearningReviewPageForOwner,
  reviewLearningSignal,
} from "../src/lib/services/riwi/learning";
import {
  approveKnowledgeCandidate,
  createKnowledgeCandidate,
  listKnowledgeConflicts,
  promoteKnowledgeSource,
  resolveKnowledgeConflict,
  retrieveActiveKnowledge,
} from "../src/lib/services/riwi/knowledge";

const actor = (id: string, role: "student" | "teacher" | "owner") => ({ id, role, accountStatus: "active" as const });

test("0039-0041 backfill stable source ids, link knowledge candidates, and preserve anonymized evidence on deletion", async () => {
  const client = new PGlite();
  try {
    await migrateTestDatabase(client, { through: "0038_riwi_provider_experiment_idempotency.sql" });
    const studentId = randomUUID();
    const signalId = randomUUID();
    await client.query("INSERT INTO users (id, name, role, account_status) VALUES ($1, $2, 'student', 'active')", [studentId, "Backfill student"]);
    await client.query(`INSERT INTO riwi_learning_signals (
      id, signal_type, state, actor_user_id, actor_role, target_user_id,
      candidate_claim, evidence_summary, evidence_hash, scope
    ) VALUES ($1, 'user_feedback', 'candidate', $2, 'student', $2, $3, $4, $5, 'user')`, [
      signalId, studentId, "Bounded historic candidate claim.", "Sanitized metadata only.", "a".repeat(64),
    ]);

    await migrateTestDatabase(client, { after: "0038_riwi_provider_experiment_idempotency.sql" });
    const [backfilled] = (await client.query<{ source_id: string }>(
      "SELECT source_id::text AS source_id FROM riwi_learning_signals WHERE id = $1", [signalId],
    )).rows;
    assert.match(backfilled?.source_id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    await client.query("DELETE FROM users WHERE id = $1", [studentId]);
    const [retained] = (await client.query<{ actor_user_id: string | null; target_user_id: string | null; scope: string }>(
      "SELECT actor_user_id::text AS actor_user_id, target_user_id::text AS target_user_id, scope::text AS scope FROM riwi_learning_signals WHERE id = $1", [signalId],
    )).rows;
    assert.equal(retained?.actor_user_id, null);
    assert.equal(retained?.target_user_id, null);
    assert.equal(retained?.scope, "user", "deletion anonymizes row links while preserving the review/audit evidence state");
  } finally {
    await client.close();
  }
});

test("learning intake routes use server identity, strict DTOs, CSRF checks, and per-account limits", () => {
  const feedbackRoute = readFileSync("src/app/api/riwi/feedback/route.ts", "utf8");
  const feedbackSchema = feedbackRoute.match(/const feedbackSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\);/)?.[1] ?? "";
  assert.match(feedbackRoute, /requireActiveUser\(\)/);
  assert.match(feedbackRoute, /checkRequestOrigin\(request\)/);
  assert.match(feedbackRoute, /submitRiwiStudentFeedback\(\{ actor: user/);
  assert.match(feedbackRoute, /RULES\.riwiFeedbackByAccount/);
  assert.doesNotMatch(feedbackSchema, /\b(userId|role|targetUserId|providerId|model)\b/);

  const staffRoute = readFileSync("src/app/api/riwi/learning-signals/route.ts", "utf8");
  const staffSchema = staffRoute.match(/const submissionSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\);/)?.[1] ?? "";
  assert.match(staffRoute, /requireActiveUser\(\)/);
  assert.match(staffRoute, /checkRequestOrigin\(request\)/);
  assert.match(staffRoute, /user\.role === "teacher"/);
  assert.match(staffRoute, /user\.role === "owner"/);
  assert.match(staffRoute, /createLearningSignal\(\{/);
  assert.match(staffRoute, /RULES\.riwiLearningByAccount/);
  assert.match(staffSchema, /idempotencyKey/);
  assert.match(staffRoute, /const sourceId = parsed\.data\.idempotencyKey/);
  assert.doesNotMatch(staffSchema, /\b(role|userId|scope|sourceId|providerId|model)\b/);

  const materializeRoute = readFileSync("src/app/api/riwi/learning-signals/[id]/knowledge/route.ts", "utf8");
  assert.match(materializeRoute, /requireActiveUser\(\)/);
  assert.match(materializeRoute, /checkRequestOrigin\(request\)/);
  assert.match(materializeRoute, /user\.role !== "owner"/);
  assert.match(materializeRoute, /RULES\.riwiLearningByAccount/);
  assert.match(materializeRoute, /createKnowledgeCandidateFromLearningSignal\(/);
  assert.doesNotMatch(materializeRoute, /body\.value\.(role|userId|scope|sourceId|providerId|model)/);

  assert.match(staffRoute, /export async function GET\(/);
  assert.match(staffRoute, /user\.role !== "owner"/);
  assert.match(staffRoute, /listLearningSignalPage\(user/);
  assert.match(staffRoute, /getAll\("state"\)/);
  const reviewRoute = readFileSync("src/app/api/riwi/learning-signals/[id]/review/route.ts", "utf8");
  assert.match(reviewRoute, /requireActiveUser\(\)/);
  assert.match(reviewRoute, /checkRequestOrigin\(request\)/);
  assert.match(reviewRoute, /user\.role !== "owner"/);
  assert.match(reviewRoute, /reviewLearningSignal\(\{/);
  assert.match(reviewRoute, /\)\.strict\(\)/);
  assert.doesNotMatch(reviewRoute, /body\.value\.(role|userId|actorUserId|targetUserId|scope|sourceId)/);
  const detailRoute = readFileSync("src/app/api/riwi/learning-signals/[id]/route.ts", "utf8");
  assert.match(detailRoute, /requireActiveUser\(\)/);
  assert.match(detailRoute, /user\.role !== "owner"/);
  assert.match(detailRoute, /listLearningCandidateForOwner\(user, id\)/);
  assert.match(detailRoute, /listLearningReviewPageForOwner\(user, id/);
  assert.match(detailRoute, /getAll\("cursor"\)/);
  assert.match(detailRoute, /reviewsNextCursor/);
});

async function insertUser(database: Awaited<ReturnType<typeof createTestDatabase>>, role: "student" | "teacher" | "owner", name: string) {
  const id = randomUUID();
  await database.db.insert(users).values({ id, name, role, accountStatus: "active" });
  return id;
}

test("learning signals are redacted candidate-only records with server-derived student and teacher scopes", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Signal student");
    const otherStudentId = await insertUser(database, "student", "Other student");
    const teacherId = await insertUser(database, "teacher", "Assigned teacher");
    const ownerId = await insertUser(database, "owner", "Signal owner");
    await database.db.insert(teacherStudentLinks).values({ teacherUserId: teacherId, studentUserId: studentId });

    const studentSignal = await createLearningSignal({
      actor: actor(studentId, "student"), type: "user_feedback", sourceId: randomUUID(), candidateClaim: "The lesson says to use 'a' before one visible count noun.",
      evidenceSummary: "Contact student@example.test or call +1 415 555 0132 for the worksheet.",
    }, database.db);
    assert.equal(studentSignal.state, "candidate");
    const stored = await database.db.query.riwiLearningSignals.findFirst({ where: eq(riwiLearningSignals.id, studentSignal.id) });
    assert.equal(stored?.scope, "user");
    assert.equal(stored?.targetUserId, studentId);
    assert.ok(!stored?.evidenceSummary.includes("student@example.test"));
    assert.ok(!stored?.evidenceSummary.includes("415 555 0132"));
    assert.equal((await database.db.select().from(riwiLearningReviews)).length, 0);
    await assert.rejects(createLearningSignal({
      actor: actor(studentId, "owner"), type: "owner_correction", sourceId: randomUUID(), candidateClaim: "Forged owner role.", evidenceSummary: "Role is checked against the user row.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden",
    "a request cannot manufacture an owner actor by changing its role field");
    await assert.rejects(createLearningSignal({
      actor: actor(studentId, "student"), type: "user_feedback", targetUserId: otherStudentId, sourceId: randomUUID(),
      candidateClaim: "Try to attach this to someone else.", evidenceSummary: "Forged target.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");

    const teacherSignal = await createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "teacher_correction", targetUserId: studentId, sourceId: randomUUID(),
      candidateClaim: "Students should distinguish count and non-count nouns.", evidenceSummary: "Reviewed class work; preserve as untrusted review evidence.",
    }, database.db);
    assert.equal(teacherSignal.state, "candidate");
    await assert.rejects(createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "teacher_correction", targetUserId: otherStudentId, sourceId: randomUUID(),
      candidateClaim: "A forged roster correction.", evidenceSummary: "Not assigned.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");
    await assert.rejects(createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "user_feedback", sourceId: randomUUID(), candidateClaim: "A teacher must not submit a global claim.",
      evidenceSummary: "No roster-bound target was supplied.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");
    await assert.rejects(createLearningSignal({
      actor: actor(studentId, "student"), type: "provider_disagreement", sourceId: randomUUID(), candidateClaim: "A learner cannot claim provider consensus.",
      evidenceSummary: "Forged provider evidence.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");

    const ownerCorrectionKey = randomUUID();
    const ownerCorrectionInput = {
      actor: actor(ownerId, "owner"), type: "owner_correction" as const, targetUserId: studentId, scope: "user" as const,
      sourceId: ownerCorrectionKey,
      candidateClaim: "Reviewed correction: use an before a vowel sound.", evidenceSummary: "Owner-reviewed QA note; original learner response omitted.",
    };
    const ownerCorrection = await createLearningSignal(ownerCorrectionInput, database.db);
    const replayedOwnerCorrection = await createLearningSignal(ownerCorrectionInput, database.db);
    assert.equal(replayedOwnerCorrection.id, ownerCorrection.id, "stable source ids make staff submissions idempotent");
    await assert.rejects(createLearningSignal({ ...ownerCorrectionInput, candidateClaim: "A different claim with the same key." }, database.db),
      (error: unknown) => error instanceof LearningServiceError && error.code === "idempotency_conflict");
    assert.equal(ownerCorrection.state, "candidate", "owner corrections still begin as inert candidate evidence");
    const ownerStored = await database.db.query.riwiLearningSignals.findFirst({ where: eq(riwiLearningSignals.id, ownerCorrection.id) });
    assert.equal(ownerStored?.actorRole, "owner");
    assert.equal(ownerStored?.targetUserId, studentId);
    assert.equal(ownerStored?.sourceId, ownerCorrectionKey, "the same stable request key is retained as the source reference");
    const qaSignal = await createLearningSignal({
      actor: actor(ownerId, "owner"), type: "manual_qa_finding", sourceId: randomUUID(), candidateClaim: "The help response should acknowledge uncertainty.",
      evidenceSummary: "Fixed-fixture manual QA summary; provider text omitted.",
    }, database.db);
    assert.equal(qaSignal.state, "candidate");

    const ownerList = (await listLearningSignalPage(actor(ownerId, "owner"), { limit: 100 }, database.db)).signals;
    assert.equal(ownerList.length, 4);
    assert.equal("candidateClaim" in (ownerList[0] ?? {}), false);
    const detail = await listLearningCandidateForOwner(actor(ownerId, "owner"), studentSignal.id, database.db);
    assert.ok(detail?.candidateClaim);
    assert.ok(!detail?.candidateClaim.includes("student@example.test"));

    await database.db.delete(users).where(eq(users.id, studentId));
    const anonymized = await database.db.query.riwiLearningSignals.findFirst({ where: eq(riwiLearningSignals.id, studentSignal.id) });
    assert.equal(anonymized?.actorUserId, null);
    assert.equal(anonymized?.targetUserId, null);
    assert.equal(anonymized?.scope, "user", "account deletion anonymizes row references without destroying immutable candidate history");
    assert.ok(anonymized?.sourceId, "retained evidence keeps a stable correlation reference after account deletion");
  } finally {
    await database.close();
  }
});

test("learning acceptance requires an owner review and executable regression evidence, without auto-publishing", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Review student");
    const ownerId = await insertUser(database, "owner", "Review owner");
    const ownerActor = actor(ownerId, "owner");
    const signal = await createLearningSignal({
      actor: actor(studentId, "student"), type: "user_feedback", sourceId: randomUUID(), candidateClaim: "Keep the short definition before examples.",
      evidenceSummary: "QA note without learner answer text.",
    }, database.db);

    await assert.rejects(reviewLearningSignal({
      actor: ownerActor, signalId: signal.id, decision: "approve", reason: "Review passed.", regressionFixtureId: "owner-says-pass",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "regression_required");
    await assert.rejects(reviewLearningSignal({
      actor: actor(studentId, "student"), signalId: signal.id, decision: "approve", reason: "Self-approve.", regressionFixtureId: "provider-output-schema-v1",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");

    const result = await reviewLearningSignal({
      actor: ownerActor, signalId: signal.id, decision: "approve", reason: "Reviewed; retain as a candidate signal only.",
      regressionFixtureId: "provider-output-schema-v1",
    }, database.db);
    assert.equal(result.state, "accepted");
    const storedSignal = await database.db.query.riwiLearningSignals.findFirst({ where: eq(riwiLearningSignals.id, signal.id) });
    assert.equal(storedSignal?.state, "accepted");
    const review = await database.db.query.riwiLearningReviews.findFirst({ where: eq(riwiLearningReviews.id, result.reviewId) });
    assert.equal(review?.decision, "approve");
    assert.equal(review?.regressionFixtureId, "provider-output-schema-v1");
    assert.match(review?.regressionEvidenceHash ?? "", /^[a-f0-9]{64}$/);
    assert.ok(review?.regressionPassedAt);
    const acceptedDetail = await listLearningCandidateForOwner(ownerActor, signal.id, database.db);
    assert.equal(acceptedDetail?.state, "accepted");
    assert.equal(acceptedDetail?.candidateClaim, "Keep the short definition before examples.");
    assert.equal(acceptedDetail?.evidenceHash, storedSignal?.evidenceHash, "accepted evidence remains immutable and auditable");
    const reviewHistory = (await listLearningReviewPageForOwner(ownerActor, signal.id, { limit: 25 }, database.db)).reviews;
    assert.equal(reviewHistory.length, 1);
    assert.equal(reviewHistory[0]?.decision, "approve");
    assert.equal(reviewHistory[0]?.reviewerUserId, ownerId);
    assert.equal(reviewHistory[0]?.regressionFixtureId, "provider-output-schema-v1");
    assert.match(reviewHistory[0]?.regressionEvidenceHash ?? "", /^[a-f0-9]{64}$/);
    assert.ok(reviewHistory[0]?.regressionPassedAt);
    const regressionAudits = await database.db.select().from(auditLog).where(eq(auditLog.action, "riwi.learning.regression.passed"));
    assert.equal(regressionAudits.length, 1);
    assert.equal((regressionAudits[0]?.metadata as Record<string, unknown>).status, "passed");
    assert.equal((regressionAudits[0]?.metadata as Record<string, unknown>).inputHash, reviewHistory[0]?.regressionEvidenceHash);
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0);

    await assert.rejects(reviewLearningSignal({
      actor: ownerActor, signalId: signal.id, decision: "reject", reason: "Second decision is forbidden.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "invalid_state");
  } finally {
    await database.close();
  }
});

test("accepted owner correction flows through conflict review, regression gate, active version, and immutable supersession history", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Signal promotion student");
    const ownerId = await insertUser(database, "owner", "Signal promotion owner");
    const ownerActor = actor(ownerId, "owner");
    const first = await createLearningSignal({
      actor: ownerActor, type: "owner_correction", sourceId: randomUUID(), scope: "global",
      candidateClaim: "Use an article before a singular count noun.", evidenceSummary: "Owner authored correction; original learner work omitted.",
    }, database.db);
    await reviewLearningSignal({ actor: ownerActor, signalId: first.id, decision: "approve", reason: "Reviewed correction; retain as evidence.",
      regressionFixtureId: "provider-output-schema-v1" }, database.db);
    const materializations = await Promise.all([
      createKnowledgeCandidateFromLearningSignal({ actor: ownerActor, signalId: first.id }, database.db),
      createKnowledgeCandidateFromLearningSignal({ actor: ownerActor, signalId: first.id }, database.db),
    ]);
    assert.equal(new Set(materializations.map((item) => item.id)).size, 1, "concurrent requests retain one linked version");
    assert.equal(materializations.filter((item) => item.replayed).length, 1, "exactly one concurrent request creates the candidate");
    const firstCandidate = materializations.find((item) => !item.replayed)!;
    const firstReplay = materializations.find((item) => item.replayed)!;
    assert.equal(firstCandidate.state, "candidate", "materialization creates an inert source candidate, never an active fact");
    assert.equal(firstReplay.id, firstCandidate.id, "replay returns the original knowledge version");
    const [firstSource] = await database.db.select().from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, firstCandidate.id));
    assert.equal(firstSource?.sourceType, "owner_correction");
    assert.equal(firstSource?.authority, 85);
    assert.equal(firstSource?.rightsClass, "internal_permission");
    assert.equal(firstSource?.state, "candidate");
    assert.equal((await retrieveActiveKnowledge("singular count noun", { id: studentId, role: "student" }, database.db)).length, 0,
      "accepted signal evidence is not published by materialization");
    const firstReview = await database.db.query.riwiLearningReviews.findFirst({ where: eq(riwiLearningReviews.signalId, first.id) });
    assert.equal(firstReview?.resultingSourceId, firstCandidate.id, "the append-only review history links to the exact version created");

    const provider = await createKnowledgeCandidate({ actor: ownerActor, sourceType: "provider_evaluation", title: "Provider observation",
      provenance: "Fixed-fixture result only", rightsClass: "internal_permission", scope: { kind: "global" },
      content: "Two providers returned identical normalized answer text." }, database.db);
    const [providerSource] = await database.db.select().from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, provider.id));
    assert.equal(providerSource?.authority, 40, "unverified provider evidence ranks below a reviewed owner correction");

    await approveKnowledgeCandidate({ actor: ownerActor, sourceId: firstCandidate.id }, database.db);
    await promoteKnowledgeSource({ actor: ownerActor, sourceId: firstCandidate.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);
    const second = await createLearningSignal({
      actor: ownerActor, type: "owner_correction", sourceId: randomUUID(), scope: "global",
      candidateClaim: "A singular count noun takes an article; use an before a vowel sound.",
      evidenceSummary: "Second owner correction; prior version retained.",
    }, database.db);
    await reviewLearningSignal({ actor: ownerActor, signalId: second.id, decision: "approve", reason: "Reviewed as a replacement candidate.",
      regressionFixtureId: "provider-output-schema-v1" }, database.db);
    const secondCandidate = await createKnowledgeCandidateFromLearningSignal({ actor: ownerActor, signalId: second.id }, database.db);
    const conflicts = await listKnowledgeConflicts(ownerActor, secondCandidate.id, database.db);
    assert.ok(conflicts.length > 0, "active overlapping claims enter explicit owner conflict review");
    assert.ok(conflicts.every((conflict) => conflict.activeSourceId === firstCandidate.id));
    await resolveKnowledgeConflict({ actor: ownerActor, conflictId: conflicts[0]!.id, decision: "accept_candidate",
      reason: "The corrected owner wording replaces this version." }, database.db);
    await approveKnowledgeCandidate({ actor: ownerActor, sourceId: secondCandidate.id }, database.db);
    const promoted = await promoteKnowledgeSource({ actor: ownerActor, sourceId: secondCandidate.id,
      supersedesSourceId: firstCandidate.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);
    assert.equal(promoted.state, "active");
    assert.equal(promoted.version, 2);
    assert.equal((await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, firstCandidate.id) }))?.state, "superseded");
    assert.equal((await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, secondCandidate.id) }))?.supersedesSourceId, firstCandidate.id);
    assert.equal((await database.db.query.riwiLearningReviews.findFirst({ where: eq(riwiLearningReviews.signalId, first.id) }))?.resultingSourceId, firstCandidate.id,
      "supersession does not erase the prior signal-to-version provenance");
    const retrieval = await retrieveActiveKnowledge("singular count noun article", { id: studentId, role: "student" }, database.db);
    assert.equal(retrieval[0]?.sourceId, secondCandidate.id);

    const providerSignal = await createLearningSignal({
      actor: ownerActor, type: "provider_agreement", producer: "provider_lab", sourceId: randomUUID(),
      candidateClaim: "Two providers returned identical normalized answer text.",
      evidenceSummary: "exact_match=true; semantic_quality=not_assessed; answer_text=omitted",
    }, database.db);
    await reviewLearningSignal({ actor: ownerActor, signalId: providerSignal.id, decision: "approve", reason: "Agreement remains observational evidence.",
      regressionFixtureId: "provider-output-schema-v1" }, database.db);
    await assert.rejects(createKnowledgeCandidateFromLearningSignal({ actor: ownerActor, signalId: providerSignal.id }, database.db),
      (error: unknown) => error instanceof LearningServiceError && error.code === "promotion_blocked",
      "provider consensus alone cannot be converted into candidate knowledge");
    const providerReview = await database.db.query.riwiLearningReviews.findFirst({ where: eq(riwiLearningReviews.signalId, providerSignal.id) });
    assert.equal(providerReview?.resultingSourceId, null);
    assert.equal((await database.db.select().from(riwiKnowledgeConflicts)).length > 0, true);
    assert.equal((await database.db.select().from(riwiKnowledgeUnits).where(eq(riwiKnowledgeUnits.sourceId, provider.id))).length, 1,
      "the unverified provider comparison remains separate from active knowledge");
    assert.ok((await database.db.select().from(auditLog).where(eq(auditLog.action, "riwi.learning.promotion.rejected"))).length > 0,
      "blocked materialization is audited without rewriting the provider signal");
  } finally {
    await database.close();
  }
});

test("accepted teacher correction can publish only as a target-user-scoped knowledge version", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Scoped correction student");
    const otherStudentId = await insertUser(database, "student", "Unrelated student");
    const teacherId = await insertUser(database, "teacher", "Scoped correction teacher");
    const ownerId = await insertUser(database, "owner", "Scoped correction owner");
    const ownerActor = actor(ownerId, "owner");
    await database.db.insert(teacherStudentLinks).values({ teacherUserId: teacherId, studentUserId: studentId });
    const signal = await createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "teacher_correction", targetUserId: studentId, scope: "user", sourceId: randomUUID(),
      candidateClaim: "This learner benefits from a short retrieval cue before the next grammar exercise.",
      evidenceSummary: "Teacher correction for an assigned learner; learner work omitted.",
    }, database.db);
    await reviewLearningSignal({ actor: ownerActor, signalId: signal.id, decision: "approve", reason: "Keep this as scoped evidence.",
      regressionFixtureId: "provider-output-schema-v1" }, database.db);
    const candidate = await createKnowledgeCandidateFromLearningSignal({ actor: ownerActor, signalId: signal.id }, database.db);
    const [source] = await database.db.select().from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, candidate.id));
    assert.equal(source?.sourceType, "teacher_correction");
    assert.equal(source?.authority, 70);
    assert.equal(source?.scope, "user");
    assert.equal(source?.scopeUserId, studentId);
    await approveKnowledgeCandidate({ actor: ownerActor, sourceId: candidate.id }, database.db);
    await promoteKnowledgeSource({ actor: ownerActor, sourceId: candidate.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);
    assert.equal((await retrieveActiveKnowledge("retrieval cue grammar exercise", { id: studentId, role: "student" }, database.db))[0]?.sourceId, candidate.id);
    assert.equal((await retrieveActiveKnowledge("retrieval cue grammar exercise", { id: otherStudentId, role: "student" }, database.db)).length, 0,
      "a teacher correction never becomes a global or another learner's fact");

    await database.db.delete(users).where(eq(users.id, studentId));
    assert.equal(await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, candidate.id) }), undefined,
      "target deletion removes target-scoped active knowledge");
    const retainedSignal = await database.db.query.riwiLearningSignals.findFirst({ where: eq(riwiLearningSignals.id, signal.id) });
    assert.equal(retainedSignal?.targetUserId, null);
    assert.equal(retainedSignal?.scope, "user", "the candidate evidence remains anonymized and scoped after target deletion");
    const retainedReview = await database.db.query.riwiLearningReviews.findFirst({ where: eq(riwiLearningReviews.signalId, signal.id) });
    assert.equal(retainedReview?.resultingSourceId, null, "the FK unlinks deleted private content without erasing the review record");
    const materializedAudit = await database.db.select().from(auditLog).where(eq(auditLog.action, "riwi.learning.signal.materialized"));
    assert.ok(materializedAudit.length > 0 && JSON.stringify(materializedAudit).includes(candidate.id),
      "append-only audit retains the version reference after target-scoped knowledge is deleted");
  } finally {
    await database.close();
  }
});

test("student feedback is tied to the actor's successful request and is deduplicated without storing answer text", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Feedback student");
    const otherStudentId = await insertUser(database, "student", "Other feedback student");
    const correlationId = randomUUID();
    const refusedCorrelationId = randomUUID();
    const incompleteCorrelationId = randomUUID();
    await database.db.insert(auditLog).values([
      { actorUserId: studentId, action: "riwi.request.completed", targetType: "riwi_request", targetId: correlationId,
        metadata: { correlationId, role: "student", status: "succeeded", answerSource: "external_provider" } },
      { actorUserId: studentId, action: "riwi.request.completed", targetType: "riwi_request", targetId: refusedCorrelationId,
        metadata: { correlationId: refusedCorrelationId, role: "student", status: "refused", answerSource: "policy_refusal" } },
    ]);
    const input = { actor: actor(studentId, "student"), correlationId, rating: "not_helpful" as const };
    assert.deepEqual(await submitRiwiStudentFeedback(input, database.db), { recorded: true });
    await Promise.all([
      submitRiwiStudentFeedback(input, database.db),
      submitRiwiStudentFeedback(input, database.db),
    ]);
    await assert.rejects(submitRiwiStudentFeedback({ ...input, rating: "helpful" }, database.db),
      (error: unknown) => error instanceof LearningServiceError && error.code === "idempotency_conflict",
      "a conflicting rating cannot overwrite the first immutable outcome");
    const [stored] = await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, correlationId));
    assert.ok(stored);
    assert.equal(stored.signalType, "user_feedback");
    assert.equal(stored.state, "candidate");
    assert.equal(stored.actorUserId, studentId);
    assert.equal(stored.targetUserId, studentId);
    assert.equal(stored.scope, "user");
    assert.match(stored.evidenceSummary, /rating=not_helpful/);
    assert.match(stored.evidenceSummary, /answer_text=omitted/);
    assert.equal((await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, correlationId))).length, 1,
      "retries for one response keep one immutable first-write-wins signal");
    assert.ok(!JSON.stringify(stored).includes("private essay"));

    await assert.rejects(submitRiwiStudentFeedback({
      actor: actor(otherStudentId, "student"), correlationId, rating: "helpful",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "not_found");
    await assert.rejects(submitRiwiStudentFeedback({
      actor: input.actor, correlationId: refusedCorrelationId, rating: "helpful",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "not_found");
    await assert.rejects(submitRiwiStudentFeedback({
      actor: input.actor, correlationId: incompleteCorrelationId, rating: "helpful",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "not_found",
    "a correlation without a completed-success audit cannot be treated as learner outcome evidence");
    await assert.rejects(submitRiwiStudentFeedback({
      actor: actor(randomUUID(), "owner"), correlationId, rating: "helpful",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");
  } finally {
    await database.close();
  }
});

test("persisted Coach evaluations become scoped candidate outcome evidence with no learner prose; signal failure is best-effort", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Outcome student");
    const ownerId = await insertUser(database, "owner", "Outcome owner");
    const evaluationId = randomUUID();
    const learnerPrivateText = "PRIVATE_LEARNER_ESSAY_SENTENCE_DO_NOT_COPY";
    await database.db.insert(evaluations).values({
      id: evaluationId, userId: studentId, evaluationType: "writing", sourceType: "writing_submission", sourceId: randomUUID(),
      providerId: "openai", providerDisplayName: "OpenAI", providerType: "external", providerVersion: "v2",
      model: "gpt-4.1-mini", promptVersion: "writing-prompt-v2", rubricVersion: "ielts-rubric-v3", checkedByName: "RIWI",
      overallEstimate: 6.5, confidence: 0.88, verdict: "mostly_correct", fallbackUsed: false,
      issues: [{ category: "task_response", message: learnerPrivateText, excerpt: learnerPrivateText, severity: "medium" }],
    });
    assert.equal(await recordEvaluationOutcomeSignal(evaluationId, database.db), true);
    assert.equal(await recordEvaluationOutcomeSignal(evaluationId, database.db), true, "evaluation retries reuse the signal by source id");
    const [stored] = await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, evaluationId));
    assert.ok(stored);
    assert.equal(stored.signalType, "student_outcome");
    assert.equal(stored.state, "candidate");
    assert.equal(stored.actorRole, "student");
    assert.equal(stored.targetUserId, studentId);
    assert.equal(stored.scope, "user");
    assert.equal(stored.providerId, "openai");
    assert.equal(stored.model, "gpt-4.1-mini");
    assert.ok(!JSON.stringify(stored).includes(learnerPrivateText));
    assert.equal((await database.db.select().from(riwiLearningSignals).where(eq(riwiLearningSignals.sourceId, evaluationId))).length, 1);

    const ownerEvaluationId = randomUUID();
    await database.db.insert(evaluations).values({
      id: ownerEvaluationId, userId: ownerId, evaluationType: "writing", sourceType: "writing_submission", sourceId: randomUUID(),
      providerId: "riwi", providerDisplayName: "RIWI", providerType: "internal", providerVersion: "v1",
      promptVersion: "internal-v1", rubricVersion: "rubric-v1", checkedByName: "RIWI",
    });
    assert.equal(await recordEvaluationOutcomeSignal(ownerEvaluationId, database.db), false, "non-student evaluations are not mislabelled as learner outcomes");
    const failPersistence = (async () => { throw new Error("test audit/database failure"); }) as typeof createLearningSignal;
    assert.equal(await recordEvaluationOutcomeSignal(evaluationId, database.db, failPersistence), false,
      "candidate-signal persistence failure is absorbed and cannot replace the authoritative evaluation response");
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0, "outcome evidence never becomes active knowledge");
  } finally {
    await database.close();
  }
});

test("request-changes signals remain owner-reviewable, then rejection closes the candidate without publishing it", async () => {
  const database = await createTestDatabase();
  try {
    const studentId = await insertUser(database, "student", "Changes student");
    const ownerId = await insertUser(database, "owner", "Changes owner");
    const ownerActor = actor(ownerId, "owner");
    const signal = await createLearningSignal({
      actor: actor(studentId, "student"), type: "user_feedback", sourceId: randomUUID(), candidateClaim: "Keep the definition concise.",
      evidenceSummary: "Categorical student rating only.",
    }, database.db);
    const requested = await reviewLearningSignal({ actor: ownerActor, signalId: signal.id, decision: "request_changes", reason: "Need a scoped source note." }, database.db);
    assert.equal(requested.state, "in_review");
    assert.equal((await listLearningCandidateForOwner(ownerActor, signal.id, database.db))?.candidateClaim, "Keep the definition concise.");
    const rejected = await reviewLearningSignal({ actor: ownerActor, signalId: signal.id, decision: "reject", reason: "Insufficient support." }, database.db);
    assert.equal(rejected.state, "rejected");
    const closedDetail = await listLearningCandidateForOwner(ownerActor, signal.id, database.db);
    assert.equal(closedDetail?.state, "rejected");
    assert.equal(closedDetail?.candidateClaim, "Keep the definition concise.", "rejected evidence is not discarded from the audit trail");
    assert.equal((await database.db.select().from(riwiLearningReviews).where(eq(riwiLearningReviews.signalId, signal.id))).length, 2);
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0);
  } finally {
    await database.close();
  }
});
