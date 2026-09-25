/**
 * Lesson state — LOCKED, SCHEDULED, AVAILABLE, IN_PROGRESS, COMPLETED.
 *
 * The state is a server decision, not a button the student can press in any
 * order: a locked lesson stays locked (a release date is the centre's call), and
 * progress only ever moves forward. The client asks; this module decides.
 */

export const LESSON_STATES = ["locked", "scheduled", "available", "assigned", "in_progress", "completed"] as const;

export type LessonState = (typeof LESSON_STATES)[number];

/** States a student may actually work in. */
export const OPEN_STATES: LessonState[] = ["available", "assigned", "in_progress"];

export function isOpen(state: LessonState): boolean {
  return OPEN_STATES.includes(state);
}

/** What a lesson without an explicit row shows: the centre's default release state. */
export function resolveState(row: LessonState | undefined, defaultState: LessonState): LessonState {
  return row ?? defaultState;
}

export type TransitionResult =
  | { ok: true; state: LessonState }
  | { ok: false; error: "locked" | "wrong_direction" };

/**
 * The only legal moves: locked/scheduled never open from the client, an open
 * lesson becomes in_progress, and either open or in_progress can be completed.
 *
 * Starting an already-started lesson is idempotent — the state after the call is
 * the state before it, so there is nothing to refuse — while completing twice is
 * refused rather than silently re-stamped, because `completedAt` has to keep
 * meaning the moment the work was actually finished.
 */
export function transition(current: LessonState, requested: "in_progress" | "completed"): TransitionResult {
  if (current === "locked" || current === "scheduled") return { ok: false, error: "locked" };

  if (requested === "in_progress") {
    if (current === "completed") return { ok: false, error: "wrong_direction" };
    return { ok: true, state: "in_progress" };
  }

  if (current === "completed") return { ok: false, error: "wrong_direction" };
  return { ok: true, state: "completed" };
}
