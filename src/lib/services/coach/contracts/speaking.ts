import {
  defineAssessmentContracts,
  OWNER_OVERLAY_FIELDS_BY_DOMAIN,
  type AssessmentContractKey,
  type AssessmentContractSeed,
} from "./types";

export const SPEAKING_DOMAIN_RULES = `SPEAKING DOMAIN
- Evaluate only the transcript and server-supplied duration/part metadata. State whether a transcript was manually typed or produced by speech-to-text when that context is available.
- Fluency signals derived from transcript length and duration are estimates, not acoustic measurements. Do not claim to have heard pauses, stress, intonation, accent, clarity, or pronunciation.
- Return exactly three scored criteria with the canonical keys fluency, lexical, and grammar; the server appends the pronunciation criterion.
- Pronunciation remains null and limited in the current transcript-only Coach contract, even if a prompt requests a number. Do not replace missing acoustic evidence with a proxy.`;

const fields = OWNER_OVERLAY_FIELDS_BY_DOMAIN.speaking;
function speaking(key: AssessmentContractKey, purpose: string, taskRules: string, scoringMode: AssessmentContractSeed["scoringMode"] = "speaking_band_estimate", execution: AssessmentContractSeed["execution"] = "coach_evaluation"): AssessmentContractSeed {
  return { key, domain: "speaking", execution, scoringMode, purpose, taskRules, ownerOverlayFields: fields };
}

export const speakingContracts = defineAssessmentContracts([
  speaking("speaking.part1", "IELTS Speaking Part 1 short personal questions.", "Judge relevance and development for the specific short question. Do not demand a Part 2-length monologue or infer facts about the speaker's private life."),
  speaking("speaking.part2", "IELTS Speaking Part 2 long-turn cue card.", "Use the cue-card prompt and transcript to assess whether the learner develops the requested points into a coherent long turn. Do not fabricate omitted cue-card facts or acoustic timing."),
  speaking("speaking.part3", "IELTS Speaking Part 3 abstract discussion.", "Assess the relevance and development of the response to the stated abstract question. Distinguish an unsupported opinion from a verified fact; do not impose a Part 1 answer length."),
  speaking("speaking.general", "General speaking response without a narrower IELTS part.", "Use only the supplied prompt and transcript. Do not assume a formal test structure or make claims about audio quality."),
  speaking("speaking.mock", "A mock speaking evaluation that combines submitted transcript evidence.", "Assess only the submitted transcript and its recorded origin. Do not invent examiner questions, missing answers, audio analysis, or a complete test result."),
  speaking("speaking.shadowing", "Speaking shadowing activity catalog entry.", "This contract documents a practice activity only. The current Coach evaluator does not compare audio or score pronunciation; do not route it to an evaluation provider.", "instruction_only", "instruction_catalog"),
  speaking("speaking.top-structures", "Top speaking structures practice catalog entry.", "This contract documents language-pattern practice only. It does not establish an AI speaking-practice or pronunciation-scoring capability.", "instruction_only", "instruction_catalog"),
] as const);
