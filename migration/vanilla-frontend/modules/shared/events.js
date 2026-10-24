/**
 * Cross-module notifications for learner data. Dispatched on `window` after the SERVER accepted a change; listeners
 * re-read the server rather than trusting the event payload, so a stale or missing event can only delay a refresh.
 */

/** An assignment was evaluated (POST /api/assignments/:id/evaluate succeeded). */
export const EVALUATION_CHANGED = 'learners-area:evaluation-changed';

export function notifyEvaluationChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVALUATION_CHANGED));
}
