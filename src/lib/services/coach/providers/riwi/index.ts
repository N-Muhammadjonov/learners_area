import "server-only";
import { getBrand } from "@/lib/config/brand";
import { RIWI_PROMPT_VERSION, RIWI_RUBRIC_VERSION } from "../../rubric";
import type { ProviderCapability, ProviderEvaluationOutput } from "../../schema";
import {
  providerFail,
  providerOk,
  type AssignmentEvaluationInput,
  type EvaluationContext,
  type EvaluationProvider,
  type GrammarEvaluationInput,
  type SpeakingEvaluationInput,
  type VocabularyEvaluationInput,
  type WritingEvaluationInput,
} from "../../types";
import { evaluateAssignmentWithRiwi } from "./assignment";
import { evaluateGrammarWithRiwi } from "./grammar";
import { evaluateSpeakingWithRiwi } from "./speaking";
import { evaluateVocabularyWithRiwi } from "./vocabulary";
import { evaluateWritingWithRiwi } from "./writing";

/**
 * The visible name of the internal evaluator.
 *
 * The provider *id* is the stable contract (`riwi` is what the database, the
 * fallback logic and every historical row store); the display name is branding
 * and may change. Because each evaluation persists the name it was produced
 * under, renaming the brand never rewrites past feedback.
 */
export const RIWI_DISPLAY_NAME = getBrand().aiDisplayName;

/**
 * RIWI — the internal Learners Area evaluator.
 *
 * Two properties matter more than anything else about this class:
 *
 * 1. It is self-contained. It calls no external service, reads no API key and
 *    never reaches back into the provider resolver, so it can never be part of
 *    a fallback loop.
 * 2. It does not overclaim. Every band it produces comes from a signal it can
 *    actually compute from the text, and criteria it cannot judge (speaking
 *    pronunciation, for instance) are returned as `limited` with a null band
 *    rather than a number.
 */
export class RiwiProvider implements EvaluationProvider {
  readonly id = "riwi";
  readonly displayName = RIWI_DISPLAY_NAME;
  readonly type = "internal" as const;
  readonly version = "1.1.0";
  readonly model = null;
  readonly capabilities: readonly ProviderCapability[] = [
    "text-evaluation",
    "writing-evaluation",
    "speaking-evaluation",
    "grammar-evaluation",
    "vocabulary-evaluation",
    "assignment-evaluation",
  ];
  readonly requiredSecrets: readonly string[] = [];
  readonly promptVersion = RIWI_PROMPT_VERSION;
  readonly rubricVersion = RIWI_RUBRIC_VERSION;

  async evaluateWriting(_ctx: EvaluationContext, input: WritingEvaluationInput) {
    try {
      return providerOk(evaluateWritingWithRiwi(input));
    } catch {
      return providerFail("provider_error", "riwi_writing_failed");
    }
  }

  async evaluateSpeaking(_ctx: EvaluationContext, input: SpeakingEvaluationInput) {
    if (!input.transcript || input.transcript.trim().length === 0) {
      // Refusing here is the point: there is nothing to evaluate without a
      // transcript, and inventing one would be fabrication.
      return providerFail("not_configured", "transcript_unavailable");
    }
    try {
      return providerOk(evaluateSpeakingWithRiwi(input));
    } catch {
      return providerFail("provider_error", "riwi_speaking_failed");
    }
  }

  async evaluateGrammar(ctx: EvaluationContext, input: GrammarEvaluationInput) {
    const task = ctx.assessmentContract?.key;
    if (task && task !== "grammar.correct-it" && task !== "grammar.activate-it") {
      return providerFail("capability_missing", "riwi_grammar_task_semantics_unsupported");
    }
    try {
      const output = evaluateGrammarWithRiwi(input);
      if (!output.issues.length && output.criteria.some(c => c.key === "target_structure" && c.limited)) {
        return providerFail("capability_missing", "riwi_grammar_semantics_unassessed");
      }
      return providerOk(output);
    } catch {
      return providerFail("provider_error", "riwi_grammar_failed");
    }
  }

  async evaluateVocabulary(ctx: EvaluationContext, input: VocabularyEvaluationInput) {
    const task = ctx.assessmentContract?.key;
    if (task && task !== "vocabulary.use-in-sentence" && task !== "vocabulary.activation") {
      return providerFail("capability_missing", "riwi_vocabulary_task_semantics_unsupported");
    }
    try {
      const output = evaluateVocabularyWithRiwi(input);
      if (!output.issues.length) return providerFail("capability_missing", "riwi_vocabulary_semantics_unassessed");
      return providerOk(output);
    } catch {
      return providerFail("provider_error", "riwi_vocabulary_failed");
    }
  }

  async evaluateAssignment(_ctx: EvaluationContext, input: AssignmentEvaluationInput) {
    try {
      return providerOk(evaluateAssignmentWithRiwi(input));
    } catch {
      return providerFail("provider_error", "riwi_assignment_failed");
    }
  }
}

export type { ProviderEvaluationOutput };
