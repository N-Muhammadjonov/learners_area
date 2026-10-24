/**
 * THE BROWSER-LOCAL, ATTEMPT-SCOPED LISTENING STATE — and exactly when it ends.
 *
 * While a learner is working in a Listening attempt, three things live in their own browser only:
 * the answer draft (a crash-recovery copy of what they have typed), the note they are taking and
 * the highlights they made. Everything here is keyed by the ATTEMPT id, so nothing can leak into
 * another attempt, another section, another learner, a staff surface, search, Progress or
 * Reports — and none of it is ever sent to the server.
 *
 * WHY THIS MODULE EXISTS. These keys were previously spelled out in three places inside the exam
 * component, and only the answer draft was ever removed. That meant a finished attempt left its
 * note and its highlights behind in the browser: temporary study material outliving the activity
 * it belonged to. The owner's rule is explicit — the note belongs to the activity, it must not
 * become permanent student content, and it must be cleared when the activity is finished. Key
 * NAMING and CLEARING therefore live in one place, so "which keys exist" and "when they end" can
 * be read, tested and changed together instead of drifting apart.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO:
 *   • it never calls `localStorage.clear()` — that would destroy unrelated application state;
 *   • it never touches ANOTHER attempt's keys — a learner may legitimately have a second attempt
 *     open, and its note is its own;
 *   • it never persists anything to the server, and adds no table and no migration: the approved
 *     contract is browser-local, attempt-scoped, private state.
 */
/** The three attempt-scoped key families, named once. */
export const LISTENING_ATTEMPT_LOCAL_PREFIXES = {
    /** The crash-recovery copy of the learner's answers. */
    draft: "la-listening-draft",
    /** The learner's own note for this attempt (NOT Xulosangiz, NOT teacher notes). */
    notes: "la-listening-notes",
    /** The learner's own highlights on the visible text of this attempt. */
    highlights: "la-listening-highlights",
};
/** Every browser-local key belonging to ONE attempt. */
export function listeningAttemptLocalKeys(attemptId) {
    return {
        draft: `${LISTENING_ATTEMPT_LOCAL_PREFIXES.draft}:${attemptId}`,
        notes: `${LISTENING_ATTEMPT_LOCAL_PREFIXES.notes}:${attemptId}`,
        highlights: `${LISTENING_ATTEMPT_LOCAL_PREFIXES.highlights}:${attemptId}`,
    };
}
function defaultStorage() {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    }
    catch {
        return null;
    }
}
/**
 * END OF THE ACTIVITY: drop this attempt's temporary state, and nothing else.
 *
 * Called ONLY after the server has confirmed the submission (see `NativeListeningExam.submit`).
 * A failed submission must leave every key in place, because the learner is still working and a
 * retry must find their answers, note and highlights exactly as they left them.
 *
 * Returns the keys it removed, so the lifecycle can be asserted rather than assumed.
 */
export function clearListeningAttemptLocalState(attemptId, storage = defaultStorage()) {
    const keys = Object.values(listeningAttemptLocalKeys(attemptId));
    if (!storage)
        return [];
    const removed = [];
    for (const key of keys) {
        try {
            if (storage.removeItem)
                storage.removeItem(key);
            removed.push(key);
        }
        catch {
            // A storage that refuses to forget (quota policies, private mode) must never break the
            // submission flow: the learner's result is already saved on the server.
        }
    }
    return removed;
}
