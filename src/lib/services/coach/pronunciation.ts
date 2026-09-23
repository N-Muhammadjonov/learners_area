import type { Criterion } from "./schema";

/**
 * PronunciationEvaluationService.
 *
 * Pronunciation is the one criterion that cannot be judged from text. Every
 * component that touches it asks this module instead of deciding for itself,
 * so there is exactly one answer to "can pronunciation be assessed here?" and
 * exactly one wording for "it was not assessed".
 *
 * The module is deliberately free of `server-only`: provider adapters and the
 * provider test-suite use it, and it holds no configuration or secrets.
 */

export const PRONUNCIATION_CRITERION_KEY = "pronunciation";

export type PronunciationAssessment =
  | {
      /** A registered provider genuinely declares audio analysis. */
      assessed: true;
      providerId: string;
    }
  | {
      assessed: false;
      reason: "no_audio_capable_provider";
    };

/**
 * `audioCapableProviderIds` comes from the provider registry —
 * `idsWithCapability("pronunciation")`. An empty list means every available
 * evaluator works from text, and text cannot carry pronunciation.
 */
export function resolvePronunciationAssessment(
  audioCapableProviderIds: readonly string[]
): PronunciationAssessment {
  const providerId = audioCapableProviderIds.find((id) => id.trim().length > 0);
  return providerId
    ? { assessed: true, providerId }
    : { assessed: false, reason: "no_audio_capable_provider" };
}

/**
 * The honest answer when nothing can judge pronunciation: a criterion that is
 * present, explicitly limited, and carries **no** band. Never a number.
 */
export function notAssessedPronunciationCriterion(): Criterion {
  return {
    key: PRONUNCIATION_CRITERION_KEY,
    label: "Pronunciation",
    band: null,
    limited: true,
    note:
      "Not assessed: pronunciation cannot be judged from a transcript, and no connected provider analyses audio. " +
      "This criterion is left empty on purpose rather than estimated.",
  };
}
