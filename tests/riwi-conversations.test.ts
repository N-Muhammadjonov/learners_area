import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, riwiConversationMessages, riwiConversations, teacherStudentLinks } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import {
  RIWI_CONVERSATION_STORAGE_MAX_MESSAGES,
  appendRiwiTurn,
  deleteRiwiConversation,
  getRiwiConversationHistory,
  getRiwiConversationTranscript,
  openRiwiConversation,
  RiwiConversationError,
} from "../src/lib/services/riwi/conversations";

const MESSAGE_META = {
  correlationId: randomUUID(),
  intent: "educational_explanation",
  fallbackUsed: false,
  externalEligible: true,
  provenance: "external_provider" as const,
  citations: [{ source: "Approved grammar notes", version: 1 }],
};

async function seedUsers(database: Awaited<ReturnType<typeof createTestDatabase>>, ids: string[]) {
  await database.db.insert(users).values(ids.map((id, index) => ({
    id, name: `RIWI conversation test ${index}`, role: index === 1 ? "owner" as const : "student" as const,
    accountStatus: "active" as const,
  })));
}

test("conversation ownership, creation-role binding, metadata projection, and deletion are enforced in PostgreSQL", async () => {
  const database = await createTestDatabase();
  const studentId = randomUUID();
  const ownerId = randomUUID();
  const correlationId = randomUUID();
  await seedUsers(database, [studentId, ownerId]);
  try {
    const actor = { id: studentId, role: "student" as const };
    const conversation = await openRiwiConversation({ actor, locale: "en" }, database.db);
    assert.equal(conversation.created, true);
    await appendRiwiTurn({
      actor, conversationId: conversation.id, userMessage: "Explain present perfect.", assistantMessage: "Use have or has plus a past participle.",
      metadata: MESSAGE_META,
    }, database.db);
    await appendRiwiTurn({
      actor, conversationId: conversation.id, userMessage: "Show my score.", assistantMessage: "Your deterministic report is ready.",
      metadata: { ...MESSAGE_META, intent: "report_self", externalEligible: false, provenance: "deterministic_report" },
    }, database.db);

    const transcript = await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, database.db);
    assert.equal(transcript.length, 4);
    assert.deepEqual(transcript.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
    assert.equal(transcript[1]?.provenance, "external_provider");
    assert.equal(transcript[1]?.correlationId, MESSAGE_META.correlationId, "the response correlation id survives a conversation restore without retaining extra content");
    assert.equal(transcript[0]?.correlationId, null, "user message rows do not receive response correlation ids");
    assert.deepEqual(transcript[1]?.citations, [{ source: "Approved grammar notes", version: 1 }]);
    const history = await getRiwiConversationHistory({ actor, conversationId: conversation.id }, database.db);
    assert.deepEqual(history.map((message) => message.content), ["Explain present perfect.", "Use have or has plus a past participle."]);

    await assert.rejects(
      openRiwiConversation({ actor: { id: ownerId, role: "owner" }, locale: "en", conversationId: conversation.id }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "not_found",
    );
    await assert.rejects(
      getRiwiConversationTranscript({ actor: { id: ownerId, role: "owner" }, conversationId: conversation.id }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "not_found",
    );
    await assert.rejects(
      getRiwiConversationHistory({ actor: { id: studentId, role: "owner" }, conversationId: conversation.id }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "not_found",
      "a changed role cannot inherit a higher-role transcript",
    );
    await assert.rejects(
      deleteRiwiConversation({ actor: { id: ownerId, role: "owner" }, conversationId: conversation.id, correlationId }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "not_found",
    );

    assert.deepEqual(await deleteRiwiConversation({ actor, conversationId: conversation.id, correlationId }, database.db), { deleted: true });
    assert.equal((await database.db.select().from(riwiConversations).where(eq(riwiConversations.id, conversation.id))).length, 0);
    assert.equal((await database.db.select().from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversation.id))).length, 0);
  } finally {
    await database.close();
  }
});

test("assigned learner answers are re-authorized on transcript read and storage; role changes fail closed", async () => {
  const database = await createTestDatabase();
  const teacherId = randomUUID();
  const learnerId = randomUUID();
  await database.db.insert(users).values([
    { id: teacherId, name: "Assigned teacher", role: "teacher", accountStatus: "active" },
    { id: learnerId, name: "Assigned learner", role: "student", accountStatus: "active" },
  ]);
  await database.db.insert(teacherStudentLinks).values({ teacherUserId: teacherId, studentUserId: learnerId });
  try {
    const actor = { id: teacherId, role: "teacher" as const };
    const conversation = await openRiwiConversation({ actor, locale: "en" }, database.db);
    const metadata = {
      ...MESSAGE_META,
      intent: "progress_self",
      externalEligible: false,
      provenance: "deterministic_learning_data" as const,
      scopeKind: "assigned" as const,
      scopeTargetUserId: learnerId,
    };
    await appendRiwiTurn({
      actor, conversationId: conversation.id,
      userMessage: "Show assigned learner progress.",
      assistantMessage: "PRIVATE LEARNER PROGRESS: writing needs work.",
      metadata,
    }, database.db);

    const stored = await database.db.select().from(riwiConversationMessages)
      .where(eq(riwiConversationMessages.conversationId, conversation.id));
    const assistant = stored.find((row) => row.role === "assistant");
    assert.equal((assistant?.metadata as Record<string, unknown>).scopeTargetUserId, learnerId,
      "the authorized target is recorded as server-owned metadata for future rechecks");
    const permitted = await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, database.db);
    assert.ok(permitted.some((message) => message.content.includes("PRIVATE LEARNER PROGRESS")));

    await assert.rejects(
      getRiwiConversationTranscript({ actor: { id: teacherId, role: "student" }, conversationId: conversation.id }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "not_found",
      "a role change cannot inherit the teacher transcript",
    );

    await database.db.delete(teacherStudentLinks).where(eq(teacherStudentLinks.teacherUserId, teacherId));
    const revoked = await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, database.db);
    const revokedAnswer = revoked.find((message) => message.role === "assistant");
    assert.ok(revokedAnswer);
    assert.equal(revokedAnswer.provenance, "unavailable");
    assert.equal(revokedAnswer.correlationId, null);
    assert.doesNotMatch(revokedAnswer.content, /PRIVATE LEARNER PROGRESS|writing needs work/i,
      "a revoked teacher must not receive the previously stored learner answer");

    await assert.rejects(
      appendRiwiTurn({
        actor, conversationId: conversation.id,
        userMessage: "Show assigned learner progress again.",
        assistantMessage: "PRIVATE LEARNER PROGRESS: writing needs work.",
        metadata: { ...metadata, correlationId: randomUUID() },
      }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "not_found",
      "storage rechecks the assignment and refuses a stale scoped result",
    );
  } finally {
    await database.close();
  }
});

test("teacher roster reports retain only a safe placeholder, never the old aggregate", async () => {
  const database = await createTestDatabase();
  const teacherId = randomUUID();
  await database.db.insert(users).values({ id: teacherId, name: "Roster teacher", role: "teacher", accountStatus: "active" });
  try {
    const actor = { id: teacherId, role: "teacher" as const };
    const conversation = await openRiwiConversation({ actor, locale: "en" }, database.db);
    await appendRiwiTurn({
      actor, conversationId: conversation.id,
      userMessage: "Show my roster report.",
      assistantMessage: "PRIVATE ROSTER AGGREGATE: seven learners.",
      metadata: {
        ...MESSAGE_META, intent: "report_self", externalEligible: false,
        provenance: "deterministic_report", scopeKind: "roster", scopeTargetUserId: null,
      },
    }, database.db);
    const stored = await database.db.select().from(riwiConversationMessages)
      .where(eq(riwiConversationMessages.conversationId, conversation.id));
    const savedAnswer = stored.find((row) => row.role === "assistant");
    assert.ok(savedAnswer);
    assert.doesNotMatch(savedAnswer.content, /PRIVATE ROSTER AGGREGATE|seven learners/);
    const transcript = await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, database.db);
    assert.ok(transcript.some((message) => message.content.includes("not saved in conversation history")));
    assert.ok(transcript.every((message) => !/PRIVATE ROSTER AGGREGATE|seven learners/.test(message.content)));

    await database.db.insert(riwiConversationMessages).values({
      conversationId: conversation.id, role: "assistant", content: "LEGACY PRIVATE REPORT WITH UNKNOWN SCOPE.",
      createdAt: new Date(Date.now() + 10),
      metadata: { correlationId: randomUUID(), intent: "report_self", provenance: "deterministic_report", citations: [] },
    });
    const afterLegacyRow = await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, database.db);
    assert.ok(afterLegacyRow.every((message) => !message.content.includes("LEGACY PRIVATE REPORT")),
      "pre-metadata staff reports are redacted rather than guessed to be still authorized");
  } finally {
    await database.close();
  }
});

test("conversation idle expiry and transactional storage cap preserve only the latest bounded transcript", async () => {
  const database = await createTestDatabase();
  const studentId = randomUUID();
  await seedUsers(database, [studentId]);
  const start = new Date("2026-01-01T00:00:00.000Z");
  try {
    const actor = { id: studentId, role: "student" as const };
    const conversation = await openRiwiConversation({ actor, locale: "uz", now: start }, database.db);
    for (let turn = 0; turn < 35; turn++) {
      const now = new Date(start.getTime() + turn * 1000);
      await appendRiwiTurn({
        actor, conversationId: conversation.id, userMessage: `question-${turn}`, assistantMessage: `answer-${turn}`,
        metadata: { ...MESSAGE_META, intent: `turn-${turn}`, externalEligible: true }, now,
      }, database.db);
    }

    const stored = await database.db.select().from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversation.id));
    assert.equal(RIWI_CONVERSATION_STORAGE_MAX_MESSAGES, 60);
    assert.equal(stored.length, RIWI_CONVERSATION_STORAGE_MAX_MESSAGES);
    const transcript = await getRiwiConversationTranscript({ actor, conversationId: conversation.id, now: new Date(start.getTime() + 40_000) }, database.db);
    assert.equal(transcript.length, 60);
    assert.equal(transcript[0]?.content, "question-5");
    assert.equal(transcript[1]?.content, "answer-5");
    assert.equal(transcript.at(-2)?.content, "question-34");
    assert.equal(transcript.at(-1)?.content, "answer-34");
    const history = await getRiwiConversationHistory({ actor, conversationId: conversation.id, now: new Date(start.getTime() + 40_000) }, database.db);
    assert.deepEqual(history.map((turn) => turn.content), [
      "question-32", "answer-32", "question-33", "answer-33", "question-34", "answer-34",
    ]);

    const expiredAt = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000);
    await assert.rejects(
      openRiwiConversation({ actor, locale: "uz", conversationId: conversation.id, now: expiredAt }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "expired",
    );
    await assert.rejects(
      getRiwiConversationTranscript({ actor, conversationId: conversation.id, now: expiredAt }, database.db),
      (error: unknown) => error instanceof RiwiConversationError && error.code === "expired",
    );
  } finally {
    await database.close();
  }
});
