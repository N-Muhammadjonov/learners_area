import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  activityEvents,
  auditLog,
  grammarAttempts,
  grammarExercises,
  grammarTopics,
  lexemes,
  riwiConversationMessages,
  riwiConversations,
  speakingAttempts,
  speakingPrompts,
  userVocabulary,
  users,
  vocabularyUsages,
  writingPrompts,
  writingSubmissions,
} from "../src/db/schema";
import type { EvaluationRecord } from "../src/lib/data/evaluations";
import { canonicalRiwiEvaluationServices, type RiwiEvaluationServices } from "../src/lib/services/riwi/evaluation-tools";
import { createRiwiCoreTools } from "../src/lib/services/riwi/core-tools";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { getRiwiConversationTranscript } from "../src/lib/services/riwi/conversations";
import type { CurrentUser } from "../src/lib/auth/current-user";
import type { RiwiRollout } from "../src/lib/services/riwi/rollout";
import type { ServiceOutcome } from "../src/lib/services/coach/service";
import { createTestDatabase } from "./support/pglite";

function evaluationRecord(type: EvaluationRecord["evaluationType"], userId: string): EvaluationRecord {
  return {
    id: randomUUID(), userId, evaluationType: type, sourceType: `${type}_fixture`, sourceId: randomUUID(),
    providerId: "riwi-core", providerDisplayName: "RIWI", providerType: "internal", providerVersion: "fixture-v1",
    model: null, promptVersion: "riwi-evaluation-test-v1", rubricVersion: "riwi-rubric-test-v1",
    assessmentContractKey: null, ownerPolicyScope: null, ownerPolicyVersion: null,
    fallbackUsed: false, fallbackFrom: null, checkedByName: "RIWI",
    checkedBy: { id: "riwi-core", displayName: "RIWI", type: "internal" },
    overallEstimate: type === "writing" || type === "speaking" ? 7.5 : null,
    confidence: 0.9, verdict: type === "grammar" || type === "vocabulary" ? "correct" : null,
    criteria: [], strengths: ["A clear response."], weaknesses: [], issues: [],
    nextActions: ["Keep practising."], recommendedExercises: [], processedInMs: 4,
    createdAt: new Date("2026-10-04T08:00:00.000Z"),
  };
}

function success(record: EvaluationRecord, reused = false): ServiceOutcome {
  return { ok: true, evaluation: record, reused };
}

async function callTool(broker: ReturnType<typeof createRiwiCoreTools>, name: string, userId: string) {
  const result = await broker.call(name, { language: "en" }, {
    actor: { id: userId, role: "student", accountStatus: "active" },
    correlationId: randomUUID(),
  });
  if (!result.ok) throw new Error(`${name}: ${result.code}`);
  return result.value as {
    status: "resolved" | "unavailable";
    sourceLabel?: string;
    reason?: string;
    evaluation?: { evaluationId: string; evaluationType: string; checkedBy: string };
  };
}

test("evaluation tools select only the caller's latest canonical work and delegate to Coach/Vocabulary services", async () => {
  const database = await createTestDatabase();
  const learnerId = randomUUID();
  const otherLearnerId = randomUUID();
  const promptId = randomUUID();
  const olderWritingId = randomUUID();
  const latestWritingId = randomUUID();
  const otherWritingId = randomUUID();
  const speakingPromptId = randomUUID();
  const olderSpeakingId = randomUUID();
  const latestSpeakingId = randomUUID();
  const otherSpeakingId = randomUUID();
  const grammarTopicId = randomUUID();
  const grammarExerciseId = randomUUID();
  const olderGrammarId = randomUUID();
  const latestGrammarId = randomUUID();
  const otherGrammarId = randomUUID();
  const lexemeId = randomUUID();
  const learnerVocabularyId = randomUUID();
  const otherVocabularyId = randomUUID();
  const olderUsageId = randomUUID();
  const latestUsageId = randomUUID();
  const otherUsageId = randomUUID();
  const records = {
    writing: evaluationRecord("writing", learnerId),
    speaking: evaluationRecord("speaking", learnerId),
    grammar: evaluationRecord("grammar", learnerId),
    vocabulary: evaluationRecord("vocabulary", learnerId),
  };
  const observed: {
    writing: Array<Parameters<RiwiEvaluationServices["evaluateWritingSubmission"]>[0]>;
    speaking: Array<Parameters<RiwiEvaluationServices["evaluateSpeakingAttempt"]>[0]>;
    grammar: Array<Parameters<RiwiEvaluationServices["evaluateGrammarProduction"]>[0]>;
    vocabulary: Array<Parameters<RiwiEvaluationServices["evaluateVocabularyUsage"]>[0]>;
  } = { writing: [], speaking: [], grammar: [], vocabulary: [] };

  try {
    await database.db.insert(users).values([
      { id: learnerId, name: "Evaluation learner", role: "student", accountStatus: "active" },
      { id: otherLearnerId, name: "Unrelated learner", role: "student", accountStatus: "active" },
    ]);
    await database.db.insert(writingPrompts).values({
      id: promptId, taskType: "task2", category: "education", prompt: "Discuss a change in education.", targetWordCount: 250,
      publicationState: "published",
    });
    const writingText = "Many communities benefit when people can share ideas, learn from experience, and make thoughtful choices about their future.";
    await database.db.insert(writingSubmissions).values([
      { id: olderWritingId, userId: learnerId, promptId, content: `${writingText} Older draft.`, wordCount: 20, status: "draft", updatedAt: new Date("2026-10-02T08:00:00.000Z") },
      { id: latestWritingId, userId: learnerId, promptId, content: `${writingText} Latest personal draft.`, wordCount: 20, status: "draft", updatedAt: new Date("2026-10-03T08:00:00.000Z") },
      { id: otherWritingId, userId: otherLearnerId, promptId, content: "UNRELATED PRIVATE WRITING CANARY. ".repeat(8), wordCount: 32, status: "draft", updatedAt: new Date("2026-10-04T08:00:00.000Z") },
    ]);

    await database.db.insert(speakingPrompts).values({
      id: speakingPromptId, part: "part2", category: "part2", promptText: "Describe a useful skill.",
    });
    await database.db.insert(speakingAttempts).values([
      { id: olderSpeakingId, userId: learnerId, promptId: speakingPromptId, part: "part2", status: "submitted", transcript: "My older manually typed answer.", transcriptOrigin: "manual", submittedAt: new Date("2026-10-02T08:00:00.000Z") },
      { id: latestSpeakingId, userId: learnerId, promptId: speakingPromptId, part: "part2", status: "submitted", transcript: "My latest manually typed answer.", transcriptOrigin: "manual", submittedAt: new Date("2026-10-03T08:00:00.000Z") },
      { id: otherSpeakingId, userId: otherLearnerId, promptId: speakingPromptId, part: "part2", status: "submitted", transcript: "UNRELATED PRIVATE SPEAKING CANARY.", transcriptOrigin: "manual", submittedAt: new Date("2026-10-04T08:00:00.000Z") },
    ]);

    await database.db.insert(grammarTopics).values({ id: grammarTopicId, title: "Present Perfect", explanation: "Use have or has with a past participle.", order: 1 });
    await database.db.insert(grammarExercises).values({
      id: grammarExerciseId, topicId: grammarTopicId, order: 1, promptText: "Write one present-perfect sentence.",
      options: ["has finished", "finish"], correctOption: "has finished", explanation: "Use has with a singular subject.",
      sourceSubmissionId: null, sourceOwnerUserId: null, activationPrompt: "Describe something you have learned.",
    });
    await database.db.insert(grammarAttempts).values([
      { id: olderGrammarId, userId: learnerId, exerciseId: grammarExerciseId, activity: "activate_it", responseText: "I have learned to plan.", isCorrect: false, attemptedAt: new Date("2026-10-02T08:00:00.000Z") },
      { id: latestGrammarId, userId: learnerId, exerciseId: grammarExerciseId, activity: "activate_it", responseText: "I have learned to plan carefully.", isCorrect: false, attemptedAt: new Date("2026-10-03T08:00:00.000Z") },
      { id: otherGrammarId, userId: otherLearnerId, exerciseId: grammarExerciseId, activity: "activate_it", responseText: "UNRELATED PRIVATE GRAMMAR CANARY.", isCorrect: false, attemptedAt: new Date("2026-10-04T08:00:00.000Z") },
    ]);

    await database.db.insert(lexemes).values({
      id: lexemeId, term: "resilient", partOfSpeech: "adjective", definitionEn: "Able to recover after difficulty.",
      senseKey: `resilient-evaluation-${randomUUID()}`, provenance: "authored", verificationStatus: "verified",
    });
    await database.db.insert(userVocabulary).values([
      { id: learnerVocabularyId, userId: learnerId, lexemeId, state: "learning" },
      { id: otherVocabularyId, userId: otherLearnerId, lexemeId, state: "learning" },
    ]);
    await database.db.insert(vocabularyUsages).values([
      { id: olderUsageId, userId: learnerId, userVocabularyId: learnerVocabularyId, sentence: "I can recover after a difficult day.", origin: "manual", createdAt: new Date("2026-10-02T08:00:00.000Z") },
      { id: latestUsageId, userId: learnerId, userVocabularyId: learnerVocabularyId, sentence: "Resilient people recover after difficult times.", origin: "manual", createdAt: new Date("2026-10-03T08:00:00.000Z") },
      { id: otherUsageId, userId: otherLearnerId, userVocabularyId: otherVocabularyId, sentence: "UNRELATED PRIVATE VOCABULARY CANARY.", origin: "manual", createdAt: new Date("2026-10-04T08:00:00.000Z") },
    ]);

    const services: RiwiEvaluationServices = {
      ...canonicalRiwiEvaluationServices,
      evaluateWritingSubmission: async (input) => {
        observed.writing.push(input);
        return success(records.writing, true);
      },
      evaluateSpeakingAttempt: async (input) => {
        observed.speaking.push(input);
        return success(records.speaking);
      },
      evaluateGrammarProduction: async (input) => {
        observed.grammar.push(input);
        return success(records.grammar);
      },
      evaluateVocabularyUsage: async (input) => {
        observed.vocabulary.push(input);
        const evaluation = observed.vocabulary.length === 1 ? records.vocabulary : evaluationRecord("vocabulary", learnerId);
        return success(evaluation);
      },
      // Keep the canonical Vocabulary engine's idempotent confirmation path;
      // the evaluation tool must not invent a second entry or point ledger.
    };
    const broker = createRiwiCoreTools(database.db, services);

    const writing = await callTool(broker, "riwi.coach.writing.evaluateLatestSelf", learnerId);
    assert.equal(writing.status, "resolved");
    assert.equal(writing.evaluation?.evaluationId, records.writing.id);
    assert.equal(writing.evaluation?.evaluationType, "writing");
    assert.equal(writing.evaluation?.checkedBy, "RIWI");
    assert.equal(observed.writing.length, 1);
    assert.equal(observed.writing[0]?.submissionId, latestWritingId, "only the learner's most recently updated saved draft is evaluated");
    assert.equal(observed.writing[0]?.content, `${writingText} Latest personal draft.`);
    assert.equal(observed.writing[0]?.taskType, "task2");
    assert.doesNotMatch(JSON.stringify(writing), /UNRELATED PRIVATE/);

    const speaking = await callTool(broker, "riwi.coach.speaking.evaluateLatestSelf", learnerId);
    assert.equal(speaking.status, "resolved");
    assert.equal(speaking.evaluation?.evaluationId, records.speaking.id);
    assert.equal(observed.speaking[0]?.attemptId, latestSpeakingId);
    assert.equal(observed.speaking[0]?.transcript, "My latest manually typed answer.");
    assert.equal(observed.speaking[0]?.transcriptOrigin, "manual", "the tool never relabels a typed transcript as STT evidence");
    assert.equal(observed.speaking[0]?.durationMs, null);
    assert.doesNotMatch(JSON.stringify(speaking), /UNRELATED PRIVATE/);

    const grammar = await callTool(broker, "riwi.coach.grammar.evaluateLatestSelf", learnerId);
    assert.equal(grammar.status, "resolved");
    assert.equal(grammar.evaluation?.evaluationId, records.grammar.id);
    assert.equal(observed.grammar[0]?.attemptId, latestGrammarId);
    assert.equal(observed.grammar[0]?.studentAnswer, "I have learned to plan carefully.");
    assert.equal(observed.grammar[0]?.targetStructure, "Present Perfect");
    assert.equal(observed.grammar[0]?.sampleAnswer, null, "the correction option is not an Activate It reference");
    assert.equal(observed.grammar[0]?.promptText, "Describe something you have learned.");
    assert.doesNotMatch(JSON.stringify(grammar), /UNRELATED PRIVATE|has finished/,
      "an unrelated correction key is absent from the Activate It request and public result");
    await database.db.update(grammarExercises).set({ activationPrompt: null }).where(eq(grammarExercises.id, grammarExerciseId));
    assert.deepEqual(await callTool(broker, "riwi.coach.grammar.evaluateLatestSelf", learnerId), { status: "unavailable", reason: "source_unavailable" });
    assert.equal(observed.grammar.length, 1, "missing activation metadata must not be replaced with the correction prompt");

    const vocabulary = await callTool(broker, "riwi.coach.vocabulary.evaluateLatestSelf", learnerId);
    assert.equal(vocabulary.status, "resolved");
    assert.equal(vocabulary.evaluation?.evaluationId, records.vocabulary.id);
    assert.equal(observed.vocabulary[0]?.usageId, latestUsageId);
    assert.equal(observed.vocabulary[0]?.targetWord, "resilient");
    assert.equal(observed.vocabulary[0]?.studentSentence, "Resilient people recover after difficult times.");
    assert.doesNotMatch(JSON.stringify(vocabulary), /UNRELATED PRIVATE|Resilient people recover/,
      "the private sentence is not copied into the public evaluation response");
    const confirmedUsage = await database.db.query.vocabularyUsages.findFirst({ where: eq(vocabularyUsages.id, latestUsageId) });
    assert.equal(confirmedUsage?.origin, "riwi", "successful evaluation is confirmed through the shared Vocabulary engine");
    assert.equal(confirmedUsage?.evaluationId, records.vocabulary.id);
    const useEvents = await database.db.select().from(activityEvents).where(eq(activityEvents.type, "VOCABULARY_USED"));
    assert.equal(useEvents.length, 1);

    const nextVocabulary = await callTool(broker, "riwi.coach.vocabulary.evaluateLatestSelf", learnerId);
    assert.equal(nextVocabulary.status, "resolved");
    assert.equal(observed.vocabulary[1]?.usageId, olderUsageId,
      "after confirming the newest sentence, the next call advances to the learner's older eligible sentence instead of duplicating the first");
    const olderConfirmed = await database.db.query.vocabularyUsages.findFirst({ where: eq(vocabularyUsages.id, olderUsageId) });
    assert.equal(olderConfirmed?.origin, "riwi");
    const noMoreVocabulary = await callTool(broker, "riwi.coach.vocabulary.evaluateLatestSelf", learnerId);
    assert.deepEqual(noMoreVocabulary, { status: "unavailable", reason: "no_saved_work" });
    assert.equal(observed.vocabulary.length, 2, "confirmed usages are never selected again");
    const otherUsage = await database.db.query.vocabularyUsages.findFirst({ where: eq(vocabularyUsages.id, otherUsageId) });
    assert.equal(otherUsage?.origin, "manual", "another learner's sentence is neither read nor mutated");

    const auditEvents = await database.db.select().from(auditLog).where(eq(auditLog.actorUserId, learnerId));
    assert.ok(auditEvents.some((event) => event.action === "riwi.tool.succeeded"));
    assert.ok(auditEvents.every((event) => !JSON.stringify(event.metadata).includes("Resilient people recover")),
      "tool audit records metadata, not private evaluation input");
  } finally {
    await database.close();
  }
});

test("chat request resolves to the real authorized Grammar tool, validates the Coach result, and persists only safe correlated trace metadata", async () => {
  const database = await createTestDatabase();
  const learnerId = randomUUID();
  const otherLearnerId = randomUUID();
  const topicId = randomUUID();
  const exerciseId = randomUUID();
  const attemptId = randomUUID();
  const evaluation = {
    ...evaluationRecord("grammar", learnerId),
    providerId: "openai", providerDisplayName: "OpenAI", providerType: "external" as const,
    providerVersion: "1", model: "gpt-test-model", fallbackUsed: true, fallbackFrom: "openai",
    checkedByName: "OpenAI",
  };
  const captured: Array<Parameters<RiwiEvaluationServices["evaluateGrammarProduction"]>[0]> = [];
  const services: RiwiEvaluationServices = {
    ...canonicalRiwiEvaluationServices,
    evaluateGrammarProduction: async (input) => {
      captured.push(input);
      return success(evaluation);
    },
  };
  const correlationId = randomUUID();

  try {
    await database.db.insert(users).values([
      { id: learnerId, name: "Integrated learner", role: "student", accountStatus: "active" },
      { id: otherLearnerId, name: "Unrelated learner", role: "student", accountStatus: "active" },
    ]);
    await database.db.insert(grammarTopics).values({
      id: topicId, title: "Present Perfect", explanation: "Use have or has with a past participle.", order: 1,
    });
    await database.db.insert(grammarExercises).values({
      id: exerciseId, topicId, order: 1, promptText: "Write one present-perfect sentence.",
      options: ["has finished", "finish"], correctOption: "has finished", explanation: "Use has with a singular subject.",
      sourceSubmissionId: null, sourceOwnerUserId: null, activationPrompt: "Describe something you have learned.",
    });
    await database.db.insert(grammarAttempts).values([
      { id: attemptId, userId: learnerId, exerciseId, activity: "activate_it", responseText: "I have learned to plan carefully.", isCorrect: false },
      { userId: otherLearnerId, exerciseId, activity: "activate_it", responseText: "UNRELATED PRIVATE GRAMMAR CANARY.", isCorrect: false },
    ]);

    const broker = createRiwiCoreTools(database.db, services);
    const base = createRiwiGatewayDependencies(database.db, broker);
    const actor: CurrentUser = {
      id: learnerId, name: "Integrated learner", email: null, role: "student", accountStatus: "active",
      locale: "en", onboarded: true, statusReason: null,
    };
    const rollout: RiwiRollout = {
      enabled: true, roles: { student: true, teacher: true, admin: true, owner: true },
      externalAi: false, knowledgeLearning: false, providerLab: false,
    };
    const response = await runRiwiGateway(new Request("https://riwi-integration.test.invalid/api/riwi/chat", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Check my grammar" }),
    }), {
      ...base,
      authenticate: async () => actor,
      newCorrelationId: () => correlationId,
      rollout: () => rollout,
      consumeAccountLimit: () => ({ ok: true, remaining: 10, retryAfterSeconds: 0 }),
      externalEnabled: async () => false,
    });

    assert.equal(response.status, 200);
    assert.ok("ok" in response.body && response.body.ok, "the actual gateway and registered core tool should complete the request");
    if (!("ok" in response.body) || !response.body.ok) throw new Error("expected a validated grammar evaluation");
    assert.equal(response.body.correlationId, correlationId);
    assert.equal(response.body.provenance, "canonical_evaluation");
    assert.equal(response.body.attribution, "RIWI");
    assert.equal(response.body.provider, null);
    assert.equal(response.body.evaluation?.evaluationId, evaluation.id);
    assert.equal(response.body.evaluation?.evaluationType, "grammar");
    assert.equal(response.body.evaluation?.checkedBy, "RIWI");
    assert.equal(response.body.evaluation?.fallbackUsed, true);
    assert.doesNotMatch(JSON.stringify(response.body), /openai|OpenAI|gpt-test-model|UNRELATED PRIVATE/,
      "provider provenance and unrelated learner content are not returned to the student");
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.userId, learnerId);
    assert.equal(captured[0]?.attemptId, attemptId);
    assert.equal(captured[0]?.studentAnswer, "I have learned to plan carefully.");
    assert.equal(captured[0]?.sampleAnswer, null);
    assert.equal(captured[0]?.promptText, "Describe something you have learned.");

    const conversationId = response.body.conversationId;
    assert.ok(conversationId);
    const storedMessages = await database.db.select().from(riwiConversationMessages)
      .where(eq(riwiConversationMessages.conversationId, conversationId));
    const savedAssistant = storedMessages.find((message) => message.role === "assistant");
    assert.ok(savedAssistant);
    const conversationMetadata = savedAssistant.metadata as Record<string, unknown>;
    assert.equal(conversationMetadata.correlationId, correlationId);
    assert.equal(conversationMetadata.evaluationId, evaluation.id);
    assert.equal(conversationMetadata.evaluationType, "grammar");
    assert.equal(conversationMetadata.evaluationValidationStatus, "validated");
    assert.equal(conversationMetadata.fallbackUsed, true);
    assert.equal(conversationMetadata.providerId, null);
    assert.equal(conversationMetadata.model, null);
    const publicTranscript = await getRiwiConversationTranscript({
      actor: { id: learnerId, role: "student" }, conversationId,
    }, database.db);
    const transcriptAnswer = publicTranscript.find((message) => message.role === "assistant");
    assert.ok(transcriptAnswer);
    assert.equal(transcriptAnswer.provenance, "canonical_evaluation");
    assert.equal(transcriptAnswer.provider, null);
    assert.equal("evaluationId" in transcriptAnswer, false);

    const completedAudit = await database.db.query.auditLog.findFirst({
      where: and(eq(auditLog.targetId, correlationId), eq(auditLog.action, "riwi.request.completed")),
    });
    assert.ok(completedAudit);
    assert.equal(completedAudit.action, "riwi.request.completed");
    const auditMetadata = completedAudit.metadata as Record<string, unknown>;
    assert.equal(auditMetadata.correlationId, correlationId);
    assert.equal(auditMetadata.evaluationId, evaluation.id);
    assert.equal(auditMetadata.evaluationType, "grammar");
    assert.equal(auditMetadata.validationStatus, "validated");
    assert.equal(auditMetadata.fallbackUsed, true);
    assert.doesNotMatch(JSON.stringify(auditMetadata), /openai|gpt-test-model|UNRELATED PRIVATE/);
    assert.equal((await database.db.select().from(riwiConversations).where(eq(riwiConversations.id, conversationId))).length, 1);
  } finally {
    await database.close();
  }
});
