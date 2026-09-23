/**
 * Version labels for the evaluation logic itself.
 *
 * `RUBRIC_VERSION` names the public IELTS criteria set this application scores
 * against (Task Achievement/Response, Coherence and Cohesion, Lexical
 * Resource, Grammatical Range and Accuracy, plus the four Speaking criteria).
 * It is a version label for our own mapping, not a claim of endorsement.
 *
 * Bumping either constant is a deliberate act: historical evaluations keep the
 * version they were produced with, so an old band score is never silently
 * re-interpreted by new logic.
 */
export const RIWI_PROMPT_VERSION = "riwi-signals-v1";
export const RIWI_RUBRIC_VERSION = "ielts-public-criteria-v1";
export const EXTERNAL_PROMPT_VERSION = "external-adapter-v1";

/** Reading/Listening keep their own deterministic rubrics, named here for completeness. */
export const OBJECTIVE_RUBRIC_VERSION = "objective-exact-match-v1";
