/**
 * MCQ Mastery — the staged multiple-choice drill.
 *
 * The whole point of the drill is the order:
 *
 *   listen → write notes → commit to *your* answer → only now reveal the
 *   options → choose → explain the choice.
 *
 * If the options are on screen while the student commits, they are choosing from
 * a menu instead of from what they heard, and the drill measures nothing. So the
 * stage is persisted server-side (`listening_mcq_sessions.stage`) and the API
 * refuses to send `options` or `correctAnswer` until the session has reached
 * `revealed`. Hiding them in the browser would be decoration.
 *
 * This is practice: it never touches exam scores and never advances the
 * vocabulary SRS ladder.
 */

export const MCQ_STAGES = ["listen", "notes", "committed", "revealed", "chosen", "reasoned"] as const;

export type McqStage = (typeof MCQ_STAGES)[number];

/** The field a step asks the student to fill, and how short it may be. */
export type McqField = "notes" | "ownAnswer" | "chosenAnswer" | "reasoning";

export type McqStep = {
  from: McqStage;
  to: McqStage;
  field: McqField | null;
  /** Minimum length of the text the student must write (0 = nothing to write). */
  minLength: number;
};

export const MCQ_FLOW: McqStep[] = [
  { from: "listen", to: "notes", field: "notes", minLength: 3 },
  { from: "notes", to: "committed", field: "ownAnswer", minLength: 1 },
  { from: "committed", to: "revealed", field: null, minLength: 0 },
  { from: "revealed", to: "chosen", field: "chosenAnswer", minLength: 1 },
  { from: "chosen", to: "reasoned", field: "reasoning", minLength: 10 },
];

export function stageIndex(stage: McqStage): number {
  return MCQ_STAGES.indexOf(stage);
}

/** The single legal next step, or null when the drill is finished. */
export function nextStep(stage: McqStage): McqStep | null {
  return MCQ_FLOW.find((step) => step.from === stage) ?? null;
}

/**
 * Whether the correct options may be sent to the client yet.
 *
 * `committed` is deliberately false: the student has written their own answer,
 * but the drill's rule is *commit first, then look* — seeing the options is
 * itself the reveal step, so it happens when they ask for it.
 */
export function optionsVisible(stage: McqStage): boolean {
  return stageIndex(stage) >= stageIndex("revealed");
}

/** Whether the student's choice may be judged against the key. */
export function outcomeVisible(stage: McqStage): boolean {
  return stageIndex(stage) >= stageIndex("chosen");
}

export type AdvanceResult =
  | { ok: true; stage: McqStage }
  | { ok: false; error: "out_of_order" | "missing_text" | "not_in_options" };

/**
 * Validate and apply one step.
 *
 * Rules the client cannot talk its way around:
 * - a step is only accepted from the stage it belongs to (no skipping);
 * - text fields must be non-empty at the declared minimum length;
 * - the chosen answer must be one of the question's real options — the choice
 *   arrives as a string, and a string the options list does not contain is a
 *   malformed submission, not a new option.
 */
export function advance(
  stage: McqStage,
  input: { step?: string; text?: string; options?: string[] }
): AdvanceResult {
  const step = nextStep(stage);
  if (!step || input.step !== step.to) return { ok: false, error: "out_of_order" };

  if (step.field) {
    const text = (input.text ?? "").trim();
    if (text.length < step.minLength) return { ok: false, error: "missing_text" };
    if (step.field === "chosenAnswer") {
      const options = input.options ?? [];
      if (!options.includes(text)) return { ok: false, error: "not_in_options" };
    }
  }

  return { ok: true, stage: step.to };
}

/**
 * The types of progress the drill makes visible, counted from the session rows
 * themselves — never a score the student did not earn.
 */
export function summarizeStages(stages: McqStage[]) {
  return {
    started: stages.length,
    committed: stages.filter((s) => stageIndex(s) >= stageIndex("committed")).length,
    reasoned: stages.filter((s) => stageIndex(s) >= stageIndex("reasoned")).length,
  };
}
