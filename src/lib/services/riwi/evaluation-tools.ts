import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z, type ZodTypeAny } from "zod";
import { db } from "@/db/client";
import {
  grammarAttempts,
  grammarExercises,
  grammarTopics,
  lexemes,
  speakingAttempts,
  speakingPrompts,
  userVocabulary,
  users,
  vocabularyUsages,
  writingPrompts,
  writingSubmissions,
} from "@/db/schema";
import { grammarVisibleTo } from "@/lib/data/grammar";
import { grammarPracticeEvidence } from "@/lib/services/grammar/production";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import type { ServiceOutcome } from "@/lib/services/coach/service";
import type { EvaluationRecord } from "@/lib/data/evaluations";
import {
  evaluateGrammarProduction,
  evaluateSpeakingAttempt,
  evaluateVocabularyUsage,
  evaluateWritingSubmission,
} from "@/lib/services/coach";
import { countWords } from "@/lib/services/writing-evaluation/heuristics";
import { confirmSentenceUse } from "@/lib/services/vocabulary/engine";
import { vocabularyEvaluationMatchesUsage } from "@/lib/services/vocabulary/evaluation-binding";
import { liveWhere } from "@/lib/services/cms/publication";
import { lexicalDetailFor } from "@/lib/services/lexical/context";
import { riwiEvaluationSchema, type RiwiEvaluation } from "./contracts";
import { resolveUserScope, type RiwiActor, type RiwiCapability, type ScopeDecision } from "./capabilities";
import type { RiwiToolHandler } from "./tool-broker";

const evaluationErrorReasons = [
  "no_saved_work", "input_too_short", "source_unavailable", "transcript_unavailable",
  "evaluation_unavailable", "persistence_unavailable",
] as const;

export const riwiEvaluationToolResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), reason: z.enum(evaluationErrorReasons) }).strict(),
  z.object({ status: z.literal("resolved"), sourceLabel: z.string().min(1).max(120), evaluation: riwiEvaluationSchema }).strict(),
]);
export type RiwiEvaluationToolResult = z.infer<typeof riwiEvaluationToolResultSchema>;

export type RiwiEvaluationServices = {
  evaluateWritingSubmission: typeof evaluateWritingSubmission;
  evaluateSpeakingAttempt: typeof evaluateSpeakingAttempt;
  evaluateGrammarProduction: typeof evaluateGrammarProduction;
  evaluateVocabularyUsage: typeof evaluateVocabularyUsage;
  confirmSentenceUse: typeof confirmSentenceUse;
};

export const canonicalRiwiEvaluationServices: RiwiEvaluationServices = {
  evaluateWritingSubmission,
  evaluateSpeakingAttempt,
  evaluateGrammarProduction,
  evaluateVocabularyUsage,
  confirmSentenceUse,
};

type RegisterRiwiTool = <I extends ZodTypeAny, O extends ZodTypeAny>(
  contract: {
    name: string;
    description: string;
    capability: RiwiCapability;
    inputSchema: I;
    outputSchema: O;
    timeoutMs: number;
    riskClass: "outbound";
    externalDataClass: "sanitized";
    idempotencyMode: "business-key";
    scope: (actor: RiwiActor, value: z.infer<I>) => Promise<ScopeDecision>;
  },
  handler: RiwiToolHandler<I, O>,
) => void;

const evaluationInput = z.object({ language: z.enum(["en", "uz"]) }).strict();
const notEvaluated = (reason: typeof evaluationErrorReasons[number]): RiwiEvaluationToolResult => ({ status: "unavailable", reason });

function publicEvaluation(record: EvaluationRecord): RiwiEvaluation {
  return riwiEvaluationSchema.parse({
    evaluationId: record.id,
    evaluationType: record.evaluationType,
    overallEstimate: record.overallEstimate,
    confidence: record.confidence,
    verdict: record.verdict,
    criteria: record.criteria,
    strengths: record.strengths,
    weaknesses: record.weaknesses,
    issues: record.issues,
    nextActions: record.nextActions,
    recommendedExercises: record.recommendedExercises,
    // Public attribution is fixed brand policy, never provider- or row-controlled.
    checkedBy: PUBLIC_CHECKED_BY,
    promptVersion: record.promptVersion,
    rubricVersion: record.rubricVersion,
    fallbackUsed: record.fallbackUsed,
    createdAt: record.createdAt.toISOString(),
  });
}

function resolved(sourceLabel: string, outcome: ServiceOutcome): RiwiEvaluationToolResult {
  if (!outcome.ok) return notEvaluated(outcome.error === "transcript_unavailable" ? "transcript_unavailable" : "evaluation_unavailable");
  return { status: "resolved", sourceLabel, evaluation: publicEvaluation(outcome.evaluation) };
}

function selfScope(actor: RiwiActor, capability: RiwiCapability, deps: Parameters<typeof resolveUserScope>[3]) {
  return resolveUserScope(actor, capability, actor.id, deps);
}

/** Register direct evaluation handoffs over the canonical domain data and Coach services. */
export function registerRiwiEvaluationTools(
  register: RegisterRiwiTool,
  database: typeof db,
  services: RiwiEvaluationServices = canonicalRiwiEvaluationServices,
) {
  const scopeDeps = {
    subjectRole: async (userId: string) => {
      const subject = await database.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true, accountStatus: true } });
      return subject?.accountStatus === "active" ? subject.role : null;
    },
    isAssigned: async () => false,
  };

  const registerEvaluation = (contract: {
    name: string; description: string; handler: (actor: RiwiActor, language: "en" | "uz") => Promise<RiwiEvaluationToolResult>;
  }) => register({
    name: contract.name,
    description: contract.description,
    capability: "riwi.chat.self",
    inputSchema: evaluationInput,
    outputSchema: riwiEvaluationToolResultSchema,
    timeoutMs: 30_000,
    riskClass: "outbound",
    externalDataClass: "sanitized",
    idempotencyMode: "business-key",
    scope: (actor) => selfScope(actor, "riwi.chat.self", scopeDeps),
  }, async (input, { actor }) => contract.handler(actor, input.language));

  registerEvaluation({
    name: "riwi.coach.writing.evaluateLatestSelf",
    description: "Evaluate the authenticated user's latest eligible saved Writing draft with the canonical WritingEvaluationService; never grade pasted chat text.",
    handler: async (actor, language) => {
      const submission = await database.query.writingSubmissions.findFirst({
        where: and(eq(writingSubmissions.userId, actor.id), eq(writingSubmissions.status, "draft")),
        orderBy: desc(writingSubmissions.updatedAt),
      });
      if (!submission) return notEvaluated("no_saved_work");
      const prompt = await database.query.writingPrompts.findFirst({
        where: and(eq(writingPrompts.id, submission.promptId), liveWhere({
          publicationState: writingPrompts.publicationState, publishAt: writingPrompts.publishAt,
        })),
      });
      if (!prompt) return notEvaluated("source_unavailable");
      if (countWords(submission.content) < 20) return notEvaluated("input_too_short");
      const outcome = await services.evaluateWritingSubmission({
        userId: actor.id,
        submissionId: submission.id,
        taskType: prompt.taskType,
        prompt: prompt.prompt,
        content: submission.content,
        targetWordCount: prompt.targetWordCount,
        category: prompt.category,
        language,
      });
      return resolved(`Writing ${prompt.taskType.toUpperCase()} saved draft`, outcome);
    },
  });

  registerEvaluation({
    name: "riwi.coach.speaking.evaluateLatestSelf",
    description: "Evaluate only the authenticated user's latest submitted Speaking transcript with the canonical SpeakingEvaluationService; no audio or acoustic evidence is fabricated.",
    handler: async (actor, language) => {
      const attempt = await database.query.speakingAttempts.findFirst({
        where: and(eq(speakingAttempts.userId, actor.id), eq(speakingAttempts.status, "submitted")),
        orderBy: desc(speakingAttempts.submittedAt),
      });
      if (!attempt) return notEvaluated("no_saved_work");
      if (!attempt.transcript?.trim()) return notEvaluated("transcript_unavailable");
      const prompt = attempt.promptId
        ? await database.query.speakingPrompts.findFirst({ where: eq(speakingPrompts.id, attempt.promptId) })
        : null;
      const transcriptOrigin = attempt.transcriptOrigin === "manual" || attempt.transcriptOrigin === "stt" || attempt.transcriptOrigin === "browser_stt"
        ? attempt.transcriptOrigin : null;
      const outcome = await services.evaluateSpeakingAttempt({
        userId: actor.id,
        attemptId: attempt.id,
        part: attempt.part,
        promptText: prompt?.promptText ?? null,
        transcript: attempt.transcript,
        transcriptOrigin,
        durationMs: attempt.recordingDurationMs,
        language,
      });
      return resolved(`Speaking ${attempt.part.replace("part", "Part ")} ${transcriptOrigin === "manual" ? "manually typed" : transcriptOrigin === "stt" ? "server-transcribed" : transcriptOrigin === "browser_stt" ? "browser-recognized" : "saved"} transcript`, outcome);
    },
  });

  registerEvaluation({
    name: "riwi.coach.grammar.evaluateLatestSelf",
    description: "Evaluate the authenticated user's latest visible Activate It Grammar attempt with the canonical GrammarEvaluationService; the authored answer key is never returned.",
    handler: async (actor, language) => {
      const [attempt] = await database.select({
        attempt: grammarAttempts,
        exercise: grammarExercises,
        topic: grammarTopics,
      }).from(grammarAttempts)
        .innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
        .innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
        .where(and(
          eq(grammarAttempts.userId, actor.id), eq(grammarAttempts.activity, "activate_it"),
          grammarVisibleTo(actor.id),
        ))
        .orderBy(desc(grammarAttempts.attemptedAt)).limit(1);
      if (!attempt?.attempt.responseText?.trim()) return notEvaluated("no_saved_work");
      const evidence = grammarPracticeEvidence(attempt.exercise, "activate_it", attempt.topic.title);
      if (!evidence) return notEvaluated("source_unavailable");
      const outcome = await services.evaluateGrammarProduction({
        userId: actor.id,
        attemptId: attempt.attempt.id,
        ...evidence,
        studentAnswer: attempt.attempt.responseText,
        activity: "activate_it",
        language,
      });
      return resolved("Grammar Activate It saved attempt", outcome);
    },
  });

  registerEvaluation({
    name: "riwi.coach.vocabulary.evaluateLatestSelf",
    description: "Evaluate one existing unevaluated sentence in the authenticated user's canonical vocabulary bank and confirm it through the shared vocabulary engine without creating duplicate entries.",
    handler: async (actor, language) => {
      const [usage] = await database.select({
        usage: vocabularyUsages,
        entry: userVocabulary,
        lexeme: lexemes,
      }).from(vocabularyUsages)
        .innerJoin(userVocabulary, eq(userVocabulary.id, vocabularyUsages.userVocabularyId))
        .innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
        .where(and(
          eq(vocabularyUsages.userId, actor.id), eq(userVocabulary.userId, actor.id),
          eq(vocabularyUsages.origin, "manual"), isNull(vocabularyUsages.evaluationId),
        ))
        .orderBy(desc(vocabularyUsages.createdAt)).limit(1);
      if (!usage?.usage.sentence.trim() || usage.usage.sentence.trim().length < 3) return notEvaluated("no_saved_work");
      const lexical = await lexicalDetailFor(usage.lexeme, database);
      const outcome = await services.evaluateVocabularyUsage({
        userId: actor.id,
        usageId: usage.usage.id,
        targetWord: usage.lexeme.term,
        definition: usage.lexeme.definitionEn,
        studentSentence: usage.usage.sentence,
        language,
      });
      if (!outcome.ok) return notEvaluated("evaluation_unavailable");
      if (!vocabularyEvaluationMatchesUsage(outcome.evaluation, actor.id, usage.usage.id)) return notEvaluated("evaluation_unavailable");
      const confirmed = await services.confirmSentenceUse({
        userId: actor.id,
        usageId: usage.usage.id,
        accepted: outcome.evaluation.verdict === "correct",
        evaluationId: outcome.evaluation.id,
        origin: "riwi",
        verdict: outcome.evaluation.verdict,
      }, database);
      if (!confirmed.ok) {
        const current = await database.query.vocabularyUsages.findFirst({
          where: and(eq(vocabularyUsages.id, usage.usage.id), eq(vocabularyUsages.userId, actor.id)),
        });
        if (confirmed.error !== "already_evaluated" || !current || current.origin !== "riwi"
          || current.evaluationId !== outcome.evaluation.id
          || current.riwiAccepted !== (outcome.evaluation.verdict === "correct")) return notEvaluated("persistence_unavailable");
      }
      const lexicalType = lexical?.lexicalType;
      const sourceLabel = `Vocabulary ${usage.lexeme.term}${lexicalType ? ` (${lexicalType})` : ""} sentence`;
      return resolved(sourceLabel, outcome);
    },
  });
}

export function formatRiwiEvaluation(evaluation: RiwiEvaluation, sourceLabel: string, locale: "en" | "uz"): string {
  const uz = locale === "uz";
  const lines = [sourceLabel, ""];
  if (evaluation.overallEstimate !== null) {
    lines.push(`${uz ? "Umumiy baho" : "Overall estimate"}: ${evaluation.overallEstimate.toFixed(1)} / 9.`);
  } else if (evaluation.verdict) {
    const verdict = evaluation.verdict === "correct" ? (uz ? "to'g'ri" : "correct")
      : evaluation.verdict === "mostly_correct" ? (uz ? "asosan to'g'ri" : "mostly correct")
        : (uz ? "tuzatish kerak" : "needs correction");
    lines.push(`${uz ? "Natija" : "Result"}: ${verdict}.`);
  } else {
    lines.push(uz ? "Kanonik natijada umumiy ball berilmagan." : "The canonical result contains no overall band.");
  }
  if (evaluation.criteria.length) {
    lines.push(uz ? "Mezonlar:" : "Criteria:");
    for (const item of evaluation.criteria) {
      const score = item.band === null ? (item.limited ? (uz ? "baholanmadi" : "not assessed") : (uz ? "ball yo'q" : "no band")) : item.band.toFixed(1);
      lines.push(`• ${item.label}: ${score}${item.note ? ` — ${item.note}` : ""}`);
    }
  }
  const strengths = evaluation.strengths.slice(0, 3);
  const issues = evaluation.issues.slice(0, 3);
  if (strengths.length) lines.push(`${uz ? "Kuchli tomonlar" : "Strengths"}: ${strengths.join("; ")}`);
  if (issues.length) lines.push(`${uz ? "Dalilli tuzatishlar" : "Evidence-led fixes"}: ${issues.map((item) => `${item.message}${item.suggestion ? ` — ${item.suggestion}` : ""}`).join("; ")}`);
  if (!issues.length && evaluation.nextActions.length) lines.push(`${uz ? "Keyingi qadam" : "Next step"}: ${evaluation.nextActions.slice(0, 3).join("; ")}`);
  lines.push(`${uz ? "Tekshiruvchi" : "Checked by"}: ${evaluation.checkedBy}.`);
  lines.push(`${uz ? "Rubrika" : "Rubric"}: ${evaluation.rubricVersion}; ${uz ? "prompt" : "prompt"}: ${evaluation.promptVersion}.`);
  if (evaluation.fallbackUsed) lines.push(uz ? "Zaxira baholash yo'li ishlatilgan." : "The canonical fallback path was used.");
  return lines.join("\n");
}
