import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  coachWeaknesses,
  courseModules,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  units,
  lexicalUnitPronunciations,
  lexicalUnits,
  lexemes,
  readingAttempts,
  readingPassages,
  riwiConversationMessages,
  speakingAttempts,
  speakingPrompts,
  grammarAttempts,
  grammarExercises,
  grammarTopics,
  teacherStudentLinks,
  userVocabulary,
  users,
  vocabularyUsages,
  writingPrompts,
  writingSubmissions,
} from "../src/db/schema";
import type { CurrentUser } from "../src/lib/auth/current-user";
import type { EvaluationRecord } from "../src/lib/data/evaluations";
import { createRiwiCoreTools } from "../src/lib/services/riwi/core-tools";
import { canonicalRiwiEvaluationServices, type RiwiEvaluationServices } from "../src/lib/services/riwi/evaluation-tools";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { buildRiwiReport } from "../src/lib/services/riwi/reports";
import type { RiwiRollout } from "../src/lib/services/riwi/rollout";
import { handleRiwiChatPost } from "../src/lib/services/riwi/chat-http";
import { createTestDatabase } from "./support/pglite";

const rollout: RiwiRollout = {
  enabled: true,
  roles: { student: true, teacher: true, admin: true, owner: true },
  externalAi: false,
  knowledgeLearning: true,
  providerLab: false,
};

const successLimit = { ok: true, remaining: 100, retryAfterSeconds: 0 } as const;

function request(message: string, extra: Record<string, unknown> = {}) {
  const origin = "https://riwi-feature.test.invalid";
  return new NextRequest(`${origin}/api/riwi/chat`, {
    method: "POST",
    headers: { host: "riwi-feature.test.invalid", origin, "content-type": "application/json" },
    body: JSON.stringify({ message, ...extra }),
  });
}

function evaluationRecord(userId: string, evaluationType: EvaluationRecord["evaluationType"], createdAt: Date): EvaluationRecord {
  return {
    id: randomUUID(), userId, evaluationType, sourceType: `${evaluationType}_integration_fixture`, sourceId: randomUUID(),
    providerId: "riwi-core", providerDisplayName: "RIWI", providerType: "internal", providerVersion: "integration-fixture-v1",
    model: null, promptVersion: `riwi-${evaluationType}-integration-v1`, rubricVersion: `riwi-${evaluationType}-rubric-v1`,
    fallbackUsed: false, fallbackFrom: null, checkedByName: "RIWI", checkedBy: { id: "riwi-core", displayName: "RIWI", type: "internal" },
    overallEstimate: evaluationType === "writing" || evaluationType === "speaking" ? 7.5 : null,
    confidence: 0.9, verdict: evaluationType === "grammar" || evaluationType === "vocabulary" ? "correct" : null,
    criteria: [], strengths: ["The saved response addresses the canonical exercise."],
    weaknesses: [], issues: [], nextActions: ["Keep supporting each point with evidence."], recommendedExercises: [],
    processedInMs: 4, createdAt,
  };
}

test("Phase 12 feature integration uses the authenticated route, real broker, shared product rows, and canonical Reporter snapshot", async () => {
  const testDb = await createTestDatabase();
  const database = testDb.db;
  const studentId = randomUUID();
  const assignedStudentId = randomUUID();
  const unassignedStudentId = randomUUID();
  const teacherId = randomUUID();
  const adminId = randomUUID();
  const ownerId = randomUUID();
  const now = new Date();
  const ids = { studentId, assignedStudentId, unassignedStudentId, teacherId, adminId, ownerId };

  try {
    await database.insert(users).values([
      { id: studentId, name: "RIWI integration student", role: "student", accountStatus: "active", locale: "en" },
      { id: assignedStudentId, name: "Assigned RIWI learner", role: "student", accountStatus: "active", locale: "en" },
      { id: unassignedStudentId, name: "Unassigned RIWI learner", role: "student", accountStatus: "active", locale: "en" },
      { id: teacherId, name: "RIWI integration teacher", role: "teacher", accountStatus: "active", locale: "en" },
      { id: adminId, name: "RIWI integration admin", role: "admin", accountStatus: "active", locale: "en" },
      { id: ownerId, name: "RIWI integration owner", role: "owner", accountStatus: "active", locale: "en" },
    ]);
    await database.insert(teacherStudentLinks).values({
      teacherUserId: teacherId, studentUserId: assignedStudentId, assignedByUserId: ownerId,
    });

    // Shared canonical lexical data and the student's real SRS/Coach rows.
    const [unit] = await database.insert(lexicalUnits).values({
      language: "en", lemma: "resilient", lemmaNorm: "resilient", partOfSpeech: "adjective", lexicalType: "word", provenance: "authored",
    }).returning();
    const [lexeme] = await database.insert(lexemes).values({
      term: "Resilient", partOfSpeech: "adjective", definitionEn: "able to recover quickly after difficulty",
      translationUz: "bardoshli", exampleSentence: "The team remained resilient.", collocations: "resilient community",
      senseKey: `riwi-integration-${randomUUID()}`, acceptedTranslations: ["bardoshli"], provenance: "authored",
      verificationStatus: "verified", lexicalUnitId: unit!.id,
    }).returning();
    await database.insert(lexicalUnitPronunciations).values({
      lexicalUnitId: unit!.id, ipa: "/rɪˈzɪliənt/", provenance: "integration_fixture",
    });
    await database.insert(coachWeaknesses).values({
      userId: studentId, category: "GRAMMAR_ARTICLE", occurrenceCount: 4,
      recentSeverity: "high", status: "open", firstSeenAt: now, lastSeenAt: now,
    });
    const [vocabularyEntry] = await database.insert(userVocabulary).values({
      userId: studentId, lexemeId: lexeme!.id, state: "review", nextReviewAt: new Date(now.getTime() - 60_000),
    }).returning({ id: userVocabulary.id });
    const [vocabularyUsage] = await database.insert(vocabularyUsages).values({
      userId: studentId, userVocabularyId: vocabularyEntry!.id,
      sentence: "Resilient students can recover after a difficult assignment.", origin: "manual",
    }).returning({ id: vocabularyUsages.id });

    // Shared SQL-backed Reporter fixture: a student's two rows and other learners' rows.
    const [passage] = await database.insert(readingPassages).values({
      title: "RIWI integration report fixture", bodyText: "A short published passage for an isolated report test.",
    }).returning();
    const activityAt = new Date(now.getTime() - 1_000);
    const attempts = [
      ...Array.from({ length: 2 }, () => ({ userId: studentId, passageId: passage!.id })),
      ...Array.from({ length: 3 }, () => ({ userId: assignedStudentId, passageId: passage!.id })),
      ...Array.from({ length: 7 }, () => ({ userId: unassignedStudentId, passageId: passage!.id })),
    ];
    await database.insert(readingAttempts).values(attempts.map((row) => ({
      ...row, status: "completed" as const, score: 1, totalQuestions: 2, startedAt: activityAt, submittedAt: activityAt,
    })));

    const observedEvaluations = {
      writing: [] as Array<Parameters<RiwiEvaluationServices["evaluateWritingSubmission"]>[0]>,
      speaking: [] as Array<Parameters<RiwiEvaluationServices["evaluateSpeakingAttempt"]>[0]>,
      grammar: [] as Array<Parameters<RiwiEvaluationServices["evaluateGrammarProduction"]>[0]>,
      vocabulary: [] as Array<Parameters<RiwiEvaluationServices["evaluateVocabularyUsage"]>[0]>,
    };
    const evaluationRecords = {
      writing: evaluationRecord(studentId, "writing", now),
      speaking: evaluationRecord(studentId, "speaking", now),
      grammar: evaluationRecord(studentId, "grammar", now),
      vocabulary: evaluationRecord(studentId, "vocabulary", now),
    };
    const evaluationServices: RiwiEvaluationServices = {
      ...canonicalRiwiEvaluationServices,
      evaluateWritingSubmission: async (input) => {
        observedEvaluations.writing.push(input);
        return { ok: true, evaluation: evaluationRecords.writing, reused: false };
      },
      evaluateSpeakingAttempt: async (input) => {
        observedEvaluations.speaking.push(input);
        return { ok: true, evaluation: evaluationRecords.speaking, reused: false };
      },
      evaluateGrammarProduction: async (input) => {
        observedEvaluations.grammar.push(input);
        return { ok: true, evaluation: evaluationRecords.grammar, reused: false };
      },
      evaluateVocabularyUsage: async (input) => {
        observedEvaluations.vocabulary.push(input);
        return { ok: true, evaluation: evaluationRecords.vocabulary, reused: false };
      },
    };
    const toolBroker = createRiwiCoreTools(database, evaluationServices);
    const gatewayBase = createRiwiGatewayDependencies(database, toolBroker);
    const authenticate = async (): Promise<CurrentUser | null> => {
      const row = await database.query.users.findFirst({
        where: eq(users.id, studentId),
        columns: { id: true, name: true, email: true, role: true, accountStatus: true, locale: true, onboardingCompletedAt: true, statusReason: true },
      });
      if (!row) return null;
      return {
        id: row.id, name: row.name, email: row.email, role: row.role, accountStatus: row.accountStatus,
        locale: row.locale, onboarded: Boolean(row.onboardingCompletedAt), statusReason: row.statusReason,
      };
    };
    const routeDependencies = {
      consumeIpLimit: () => successLimit,
      runGateway: (incoming: Request) => runRiwiGateway(incoming, {
        ...gatewayBase,
        authenticate,
        rollout: () => rollout,
        consumeAccountLimit: () => successLimit,
        externalEnabled: async () => false,
      }),
    };

    const dictionaryResponse = await handleRiwiChatPost(request("What does resilient mean?"), routeDependencies);
    assert.equal(dictionaryResponse.status, 200);
    assert.equal(dictionaryResponse.headers.get("cache-control"), "private, no-store");
    const dictionary = await dictionaryResponse.json() as {
      ok: boolean; answer: string; provenance: string; conversationId: string; citations: Array<{ source: string }>;
    };
    assert.equal(dictionary.ok, true);
    assert.equal(dictionary.provenance, "canonical_dictionary");
    assert.match(dictionary.answer, /able to recover quickly after difficulty/);
    assert.match(dictionary.answer, /bardoshli/);
    assert.match(dictionary.answer, /resilient community/);
    assert.ok(dictionary.citations.some((citation) => citation.source === "Learners Area catalogue"));

    // The saved conversation is written to the isolated test database, not the app singleton.
    const transcript = await database.select().from(riwiConversationMessages)
      .where(eq(riwiConversationMessages.conversationId, dictionary.conversationId))
      .orderBy(riwiConversationMessages.createdAt);
    assert.equal(transcript.length, 2);
    assert.equal(transcript[0]?.content, "What does resilient mean?");
    assert.equal(transcript[1]?.content, dictionary.answer);

    const progressResponse = await handleRiwiChatPost(request("How am I doing?"), routeDependencies);
    const progress = await progressResponse.json() as { ok: boolean; answer: string; provenance: string };
    assert.equal(progress.ok, true);
    assert.equal(progress.provenance, "deterministic_learning_data");
    assert.match(progress.answer, /Articles \(a \/ an \/ the\).*4 recorded item/);
    assert.match(progress.answer, /Resilient: able to recover quickly after difficulty/);

    const reportResponse = await handleRiwiChatPost(request("Show my personal report"), routeDependencies);
    const personalReport = await reportResponse.json() as { ok: boolean; answer: string; provenance: string };
    assert.equal(personalReport.ok, true);
    assert.equal(personalReport.provenance, "deterministic_report");
    assert.match(personalReport.answer, /Reading attempts completed: 2/);
    assert.match(personalReport.answer, /Scope: personal student scope/);
    assert.match(personalReport.answer, /Period: .*Asia\/Tashkent/);
    assert.match(personalReport.answer, /Exact window: \[[^\]]+Z, [^\]]+Z\)/);
    assert.match(personalReport.answer, /Reporter snapshot: riwi-report\/1, [0-9a-f-]{36}/);
    assert.match(personalReport.answer, /Source query IDs: .*riwi\.reading\.completed/);
    assert.doesNotMatch(personalReport.answer, /Approved student accounts|Approved staff accounts|external AI provider/i,
      "student text contains no cohort, operational, or owner-only number");
    const canonical = await buildRiwiReport({
      actor: { id: studentId, role: "student" }, request: { scope: "student", period: "on_demand" }, now, database,
    });
    assert.equal(canonical.ok, true);
    if (canonical.ok) {
      const metric = canonical.snapshot.metrics.find((item) => item.key === "reading.completed");
      assert.equal(metric?.value, 2);
      assert.ok(personalReport.answer.includes(`Reading attempts completed: ${metric?.value}`),
        "chat rendering is a presentation of the canonical snapshot value");
      assert.equal(canonical.snapshot.schemaVersion, "riwi-report/1");
      assert.equal(canonical.snapshot.timezone, "Asia/Tashkent");
    }

    // Only the live teacher roster enables individual Reporter scope.
    const teacherDependencies = {
      ...routeDependencies,
      runGateway: (incoming: Request) => runRiwiGateway(incoming, {
        ...gatewayBase,
        authenticate: async () => {
          const row = await database.query.users.findFirst({
            where: eq(users.id, teacherId),
            columns: { id: true, name: true, email: true, role: true, accountStatus: true, locale: true, onboardingCompletedAt: true, statusReason: true },
          });
          return row ? { id: row.id, name: row.name, email: row.email, role: row.role, accountStatus: row.accountStatus,
            locale: row.locale, onboarded: Boolean(row.onboardingCompletedAt), statusReason: row.statusReason } : null;
        },
        rollout: () => rollout, consumeAccountLimit: () => successLimit, externalEnabled: async () => false,
      }),
    };
    const assignedReportResponse = await handleRiwiChatPost(request("Show the selected learner's report", { targetUserId: assignedStudentId }), teacherDependencies);
    const assignedReport = await assignedReportResponse.json() as { ok: boolean; answer: string; provenance: string };
    assert.equal(assignedReport.ok, true);
    assert.equal(assignedReport.provenance, "deterministic_report");
    assert.match(assignedReport.answer, /Reading attempts completed: 3/);
    const unassignedResponse = await handleRiwiChatPost(request("Show the selected learner's report", { targetUserId: unassignedStudentId }), teacherDependencies);
    const unassigned = await unassignedResponse.json() as { ok: boolean; errorCode: string | null };
    assert.equal(unassigned.ok, false);
    assert.equal(unassigned.errorCode, "riwi_scope_denied");

    // Request authority remains server-derived; strict DTO rejects a forged role/user identity.
    const spoofedResponse = await handleRiwiChatPost(request("Show my report", { userId: ownerId, role: "owner" }), routeDependencies);
    const spoofed = await spoofedResponse.json() as { error?: { code: string } };
    assert.equal(spoofed.error?.code, "riwi_request_invalid");

    // Even an explicit target id cannot widen the student's self-only report scope.
    const idorResponse = await handleRiwiChatPost(request("Show my report", { targetUserId: assignedStudentId }), routeDependencies);
    const idor = await idorResponse.json() as { ok: boolean; errorCode: string | null };
    assert.equal(idor.ok, false);
    assert.equal(idor.errorCode, "riwi_scope_denied");

    // The gateway never grades free chat text; it links learners to the real Writing/Speaking/Grammar/Vocabulary systems.
    const evaluation = await handleRiwiChatPost(request("Grade my writing: this is a sample essay with a claimed band 9."), routeDependencies);
    const evaluationResult = await evaluation.json() as { ok: boolean; intent: string; errorCode: string | null; answer: string };
    assert.equal(evaluationResult.ok, false);
    assert.equal(evaluationResult.intent, "evaluate_writing");
    assert.equal(evaluationResult.errorCode, "riwi_evaluation_source_missing",
      "registered evaluation tools refuse pasted prose when no canonical saved work exists");
    assert.doesNotMatch(evaluationResult.answer, /band\s*9|score\s*9/i, "chat prose is not misrepresented as a graded Writing submission");

    const [writingPrompt] = await database.insert(writingPrompts).values({
      taskType: "task2", category: "integration", prompt: "Discuss how communities can support lifelong learning.",
      targetWordCount: 80, publicationState: "published",
    }).returning({ id: writingPrompts.id });
    const savedWriting = "Many local communities benefit when students can exchange practical ideas, learn from careful feedback, and make thoughtful decisions about their goals and future plans.";
    const [writingSubmission] = await database.insert(writingSubmissions).values({
      userId: studentId, promptId: writingPrompt!.id, content: savedWriting, wordCount: 24, status: "draft",
    }).returning({ id: writingSubmissions.id });

    const [speakingPrompt] = await database.insert(speakingPrompts).values({
      part: "part2", category: "part2", promptText: "Describe a useful skill.",
    }).returning({ id: speakingPrompts.id });
    const [speakingAttempt] = await database.insert(speakingAttempts).values({
      userId: studentId, promptId: speakingPrompt!.id, part: "part2", status: "submitted",
      transcript: "My privately saved, manually typed Speaking answer.", transcriptOrigin: "manual", submittedAt: now,
    }).returning({ id: speakingAttempts.id });

    const [grammarTopic] = await database.insert(grammarTopics).values({
      title: "Present Perfect", explanation: "Use have or has with a past participle.", order: 1,
    }).returning({ id: grammarTopics.id });
    const [grammarExercise] = await database.insert(grammarExercises).values({
      topicId: grammarTopic!.id, order: 1, promptText: "Write a present-perfect sentence.",
      options: ["has finished", "finish"], correctOption: "has finished", explanation: "Use has with a singular subject.",
      sourceSubmissionId: null, sourceOwnerUserId: null, activationPrompt: "Describe something you have learned.",
    }).returning({ id: grammarExercises.id });
    const [grammarAttempt] = await database.insert(grammarAttempts).values({
      userId: studentId, exerciseId: grammarExercise!.id, activity: "activate_it",
      responseText: "I have learned to plan carefully.", isCorrect: false, attemptedAt: now,
    }).returning({ id: grammarAttempts.id });

    const savedEvaluationResponse = await handleRiwiChatPost(request("Evaluate my latest Writing draft."), routeDependencies);
    const savedEvaluation = await savedEvaluationResponse.json() as {
      ok: boolean; provenance: string; evaluation?: { evaluationId: string; evaluationType: string; checkedBy: string }; answer: string;
    };
    assert.equal(savedEvaluationResponse.status, 200);
    assert.equal(savedEvaluation.ok, true);
    assert.equal(savedEvaluation.provenance, "canonical_evaluation");
    assert.equal(savedEvaluation.evaluation?.evaluationId, evaluationRecords.writing.id);
    assert.equal(savedEvaluation.evaluation?.evaluationType, "writing");
    assert.equal(savedEvaluation.evaluation?.checkedBy, "RIWI");
    assert.match(savedEvaluation.answer, /Writing TASK2 saved draft/);
    assert.equal(observedEvaluations.writing.length, 1);
    assert.equal(observedEvaluations.writing[0]?.submissionId, writingSubmission!.id);
    assert.equal(observedEvaluations.writing[0]?.content, savedWriting, "the canonical saved draft, not chat prose, reaches the Coach evaluator");
    assert.equal(observedEvaluations.writing[0]?.userId, studentId);

    const speakingResponse = await handleRiwiChatPost(request("Evaluate my latest Speaking answer."), routeDependencies);
    const speakingEvaluation = await speakingResponse.json() as {
      ok: boolean; intent: string; provenance: string; evaluation?: { evaluationId: string; evaluationType: string }; answer: string;
    };
    assert.equal(speakingEvaluation.ok, true);
    assert.equal(speakingEvaluation.intent, "evaluate_speaking");
    assert.equal(speakingEvaluation.provenance, "canonical_evaluation");
    assert.equal(speakingEvaluation.evaluation?.evaluationId, evaluationRecords.speaking.id);
    assert.equal(speakingEvaluation.evaluation?.evaluationType, "speaking");
    assert.equal(observedEvaluations.speaking[0]?.attemptId, speakingAttempt!.id);
    assert.equal(observedEvaluations.speaking[0]?.transcriptOrigin, "manual", "a typed transcript is not upgraded to STT evidence");
    assert.doesNotMatch(JSON.stringify(speakingEvaluation), /privately saved/);

    const grammarResponse = await handleRiwiChatPost(request("Check my latest Grammar attempt."), routeDependencies);
    const grammarEvaluation = await grammarResponse.json() as {
      ok: boolean; intent: string; provenance: string; evaluation?: { evaluationId: string; evaluationType: string }; answer: string;
    };
    assert.equal(grammarEvaluation.ok, true);
    assert.equal(grammarEvaluation.intent, "evaluate_grammar");
    assert.equal(grammarEvaluation.provenance, "canonical_evaluation");
    assert.equal(grammarEvaluation.evaluation?.evaluationId, evaluationRecords.grammar.id);
    assert.equal(grammarEvaluation.evaluation?.evaluationType, "grammar");
    assert.equal(observedEvaluations.grammar[0]?.attemptId, grammarAttempt!.id);
    assert.equal(observedEvaluations.grammar[0]?.sampleAnswer, "has finished", "the canonical key is passed only to the Coach evaluator");
    assert.doesNotMatch(JSON.stringify(grammarEvaluation), /has finished|I have learned/);

    const vocabularyResponse = await handleRiwiChatPost(request("Evaluate my saved Vocabulary sentence."), routeDependencies);
    const vocabularyEvaluation = await vocabularyResponse.json() as {
      ok: boolean; intent: string; provenance: string; evaluation?: { evaluationId: string; evaluationType: string }; answer: string;
    };
    assert.equal(vocabularyEvaluation.ok, true);
    assert.equal(vocabularyEvaluation.intent, "evaluate_vocabulary");
    assert.equal(vocabularyEvaluation.provenance, "canonical_evaluation");
    assert.equal(vocabularyEvaluation.evaluation?.evaluationId, evaluationRecords.vocabulary.id);
    assert.equal(vocabularyEvaluation.evaluation?.evaluationType, "vocabulary");
    assert.equal(observedEvaluations.vocabulary[0]?.usageId, vocabularyUsage!.id);
    assert.equal(observedEvaluations.vocabulary[0]?.studentSentence, "Resilient students can recover after a difficult assignment.");
    assert.doesNotMatch(JSON.stringify(vocabularyEvaluation), /Resilient students can recover/);
    const confirmedVocabulary = await database.query.vocabularyUsages.findFirst({ where: eq(vocabularyUsages.id, vocabularyUsage!.id) });
    assert.equal(confirmedVocabulary?.origin, "riwi", "the route delegates confirmation to the canonical Vocabulary engine");
    assert.equal(confirmedVocabulary?.evaluationId, evaluationRecords.vocabulary.id);

    const courseId = randomUUID();
    const moduleId = randomUUID();
    const unitId = randomUUID();
    const lessonId = randomUUID();
    await database.insert(courses).values({ id: courseId, slug: `riwi-integration-${randomUUID()}`, title: "RIWI Grammar Course", publicationState: "published" });
    await database.insert(courseModules).values({ id: moduleId, courseId, slug: "grammar", title: "Grammar", order: 1 });
    await database.insert(units).values({ id: unitId, moduleId, slug: "conditionals", title: "Conditionals", order: 1 });
    await database.insert(lessons).values({
      id: lessonId, unitId, slug: "real-conditionals", title: "Real conditionals",
      summary: "The first conditional describes a likely future result; the if-clause uses the present simple.",
      defaultState: "available", order: 1,
    });
    await database.insert(enrollments).values({ userId: studentId, courseId });
    await database.insert(lessonProgress).values({
      userId: studentId, lessonId, state: "available", notes: "PRIVATE_LESSON_NOTES_MUST_NOT_ENTER_RIWI_CONTEXT",
    });
    const courseResponse = await handleRiwiChatPost(request("Explain real conditionals in my course lesson."), routeDependencies);
    const courseAnswer = await courseResponse.json() as { ok: boolean; provenance: string; conversationId: string | null; answer: string };
    assert.equal(courseResponse.status, 200);
    assert.equal(courseAnswer.ok, true);
    assert.equal(courseAnswer.provenance, "course_lesson");
    assert.ok(courseAnswer.answer.includes("first conditional"));
    assert.doesNotMatch(courseAnswer.answer, /PRIVATE_LESSON_NOTES_MUST_NOT_ENTER_RIWI_CONTEXT/);
    const courseConversation = await database.select({ role: riwiConversationMessages.role, metadata: riwiConversationMessages.metadata })
      .from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, courseAnswer.conversationId!));
    const courseAssistant = courseConversation.find((message) => message.role === "assistant");
    assert.equal(courseAssistant?.metadata?.scopeKind, "course_lesson");
    assert.equal(courseAssistant?.metadata?.scopeCourseId, courseId);
    assert.equal(courseAssistant?.metadata?.scopeLessonId, lessonId);

    // A live timed attempt pauses RIWI before any dictionary/provider/tool execution.
    await database.insert(readingAttempts).values({
      userId: studentId, passageId: passage!.id, status: "in_progress", startedAt: now,
    });
    const lockedResponse = await handleRiwiChatPost(request("What does resilient mean?"), routeDependencies);
    const locked = await lockedResponse.json() as { ok: boolean; errorCode: string | null; provenance: string };
    assert.equal(locked.ok, false);
    assert.equal(locked.errorCode, "riwi_exam_help_locked");
    assert.equal(locked.provenance, "policy_refusal");

    const auditRows = await testDb.query<{ action: string; metadata: Record<string, unknown> }>(
      "select action, metadata from audit_log where actor_user_id = $1 order by created_at, id", [studentId],
    );
    const auditActions = new Set(auditRows.map((row) => row.action));
    for (const action of ["riwi.request.started", "riwi.tool.invoked", "riwi.tool.succeeded", "riwi.request.completed"]) {
      assert.ok(auditActions.has(action), `persisted test-database audit is missing ${action}`);
    }
    const reportAudit = auditRows.find((row) => row.action === "riwi.tool.succeeded" && row.metadata.toolName === "riwi.report.readSelf");
    assert.ok(reportAudit, "the broker's report execution has a persisted, correlated audit event");
    assert.ok(!JSON.stringify(auditRows).includes("able to recover quickly"), "audit metadata does not copy private answer text");
  } finally {
    await testDb.close();
  }
});
