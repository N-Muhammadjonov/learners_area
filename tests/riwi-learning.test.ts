import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { riwiKnowledgeSources, riwiLearningReviews, riwiLearningSignals, teacherStudentLinks, users } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import {
  LearningServiceError,
  createLearningSignal,
  listLearningCandidateForOwner,
  listLearningSignals,
  reviewLearningSignal,
} from "../src/lib/services/riwi/learning";

const actor = (id: string, role: "student" | "teacher" | "owner") => ({ id, role, accountStatus: "active" as const });

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
      actor: actor(studentId, "student"), type: "user_feedback", candidateClaim: "The lesson says to use 'a' before one visible count noun.",
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
      actor: actor(studentId, "student"), type: "user_feedback", targetUserId: otherStudentId,
      candidateClaim: "Try to attach this to someone else.", evidenceSummary: "Forged target.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");

    const teacherSignal = await createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "teacher_correction", targetUserId: studentId,
      candidateClaim: "Students should distinguish count and non-count nouns.", evidenceSummary: "Reviewed class work; preserve as untrusted review evidence.",
    }, database.db);
    assert.equal(teacherSignal.state, "candidate");
    await assert.rejects(createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "teacher_correction", targetUserId: otherStudentId,
      candidateClaim: "A forged roster correction.", evidenceSummary: "Not assigned.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "forbidden");
    await assert.rejects(createLearningSignal({
      actor: actor(teacherId, "teacher"), type: "user_feedback", candidateClaim: "A teacher must not submit a global claim.",
      evidenceSummary: "No roster-bound target was supplied.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "invalid_input");

    const ownerList = await listLearningSignals(actor(ownerId, "owner"), 100, database.db);
    assert.equal(ownerList.length, 2);
    assert.equal("candidateClaim" in (ownerList[0] ?? {}), false);
    const detail = await listLearningCandidateForOwner(actor(ownerId, "owner"), studentSignal.id, database.db);
    assert.ok(detail?.candidateClaim);
    assert.ok(!detail?.candidateClaim.includes("student@example.test"));
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
      actor: actor(studentId, "student"), type: "user_feedback", candidateClaim: "Keep the short definition before examples.",
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
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0);

    await assert.rejects(reviewLearningSignal({
      actor: ownerActor, signalId: signal.id, decision: "reject", reason: "Second decision is forbidden.",
    }, database.db), (error: unknown) => error instanceof LearningServiceError && error.code === "invalid_state");
  } finally {
    await database.close();
  }
});
