import "server-only";

/**
 * The Coach subsystem — one entry point per evaluation domain.
 *
 *   WritingEvaluationService      <- ./writing
 *   SpeakingEvaluationService     <- ./speaking
 *   GrammarEvaluationService      <- ./grammar
 *   VocabularyFeedbackService     <- ./vocabulary
 *   AssignmentEvaluationService   <- ./assignment
 *   SpeechToTextService           <- ./stt   (separate on purpose)
 *
 * Every one of them shares the same provider registry, provider resolver,
 * normalized result schema, persistence layer, weakness memory, error
 * convention and fallback policy. None of them knows a vendor name.
 */

export { evaluateWritingSubmission } from "./writing";
export { evaluateSpeakingAttempt } from "./speaking";
export { evaluateGrammarProduction } from "./grammar";
export { evaluateVocabularyUsage } from "./vocabulary";
export {
  classifyAssignment,
  evaluateAssignment,
  type AssignmentTaskKind,
} from "./assignment";
export { SpeechToTextService, isSttConfigured } from "./stt";
export { transcribePrivateRecording, type ServiceError, type ServiceOutcome } from "./service";
export {
  providerRegistry,
  registerProvider,
  listConfiguredProviderIds,
} from "./registry";
export { readCoachConfig, RIWI_PROVIDER_ID, NO_STT_PROVIDER_ID } from "./config";
export { categoriesCheckedBy, WEAKNESS_CATEGORY_META } from "./categories";
export {
  evaluationResultSchema,
  providerEvaluationOutputSchema,
  weaknessCategorySchema,
  type EvaluationResult,
  type EvaluationType,
  type ProviderCapability,
  type WeaknessCategory,
} from "./schema";
export type { EvaluationContext, ProviderAttempt, ProviderFailure } from "./types";
