// A bounded allowlist of canonical, static learning INDEX routes only.
// Important: do not prefetch exam starts, attempts, answers, reports, admin
// views, teacher actions, arbitrary IDs, or parameterized personal searches.
// These are read-only learner catalogue/section landing pages under the
// existing server-authoritative /app access gate. No blanket Next prefetch.
const SAFE_INDEX_ROUTES = new Set([
    "/app",
    "/app/listening/lessons",
    "/app/listening/academic",
    "/app/listening/general",
    "/app/listening/mcq",
    "/app/reading/lessons",
    "/app/reading/academic",
    "/app/reading/general",
    "/app/reading/question-types",
    // Retention is deliberately excluded: even a read of its active session is
    // time-sensitive. Never warm that route until a learner intentionally opens it.
    "/app/writing",
    "/app/speaking",
    "/app/speaking/lessons",
    "/app/speaking/practice",
    "/app/grammar/lessons",
    "/app/vocabulary",
    "/app/vocabulary/games",
    "/app/video-lessons",
    "/app/progress",
]);
// Warm only the two most-used learning entry routes while the browser is idle.
// Routes remain guarded by middleware, the authoritative DB-backed /app layout
// and the individual API authorizers. No attempts or authored answers are warmed.
export const IDLE_SHELL_PREFETCH_ROUTES = ["/app/reading/lessons", "/app/listening/lessons"];
export function eligibleIntentTarget(raw, origin, current) {
    try {
        const destination = new URL(raw, origin);
        const here = new URL(current, origin);
        if (destination.origin !== origin || destination.search || destination.hash || !SAFE_INDEX_ROUTES.has(destination.pathname))
            return null;
        if (destination.pathname === here.pathname && destination.search === here.search)
            return null;
        return destination.pathname;
    }
    catch {
        return null;
    }
}
// Dispatch budget, NOT a promise that Next has completed an in-flight request.
// No private data is stored here. Route names expire every minute.
export class IntentPrefetchBudget {
    windowStart = 0;
    last = Number.NEGATIVE_INFINITY;
    targets = new Set();
    take(target, now) {
        if (now < this.windowStart || now - this.windowStart >= 60_000) {
            this.windowStart = now;
            this.targets.clear();
            this.last = Number.NEGATIVE_INFINITY;
        }
        if (this.targets.has(target) || this.targets.size >= 6 || now - this.last < 750)
            return false;
        this.targets.add(target);
        this.last = now;
        return true;
    }
}
/** One bounded client budget shared by intent links and the idle shell warmer. */
export const sharedIntentPrefetchBudget = new IntentPrefetchBudget();
