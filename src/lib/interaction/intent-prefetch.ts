// Only canonical module landing routes. Never prefetch attempts, answers, admin
// records, evaluations or arbitrary private identifiers through this policy.
// Keep this aligned with SidebarNav hrefs: /app/reading and /app/listening are
// redirect-only doorways, so prefetching them wastes a network round trip.
const LANDINGS = new Set([
  "/app",
  "/app/reading/lessons",
  "/app/listening/lessons",
  "/app/writing",
  "/app/speaking",
  "/app/grammar/lessons",
  "/app/vocabulary",
  "/app/video-lessons",
  "/app/progress",
]);
// Warm only the two most-used learning entry routes while the browser is idle.
// Routes remain guarded by middleware, the authoritative DB-backed /app layout
// and the individual API authorizers. No attempts or authored answers are warmed.
export const IDLE_SHELL_PREFETCH_ROUTES = ["/app/reading/lessons", "/app/listening/lessons"] as const;
export function eligibleIntentTarget(raw: string, origin: string, current: string): string | null {
  try {
    const destination = new URL(raw, origin);
    const here = new URL(current, origin);
    if (destination.origin !== origin || destination.search || destination.hash || !LANDINGS.has(destination.pathname)) return null;
    if (destination.pathname === here.pathname && destination.search === here.search) return null;
    return destination.pathname;
  } catch { return null; }
}
// Dispatch budget, NOT a promise that Next has completed an in-flight request.
// No private data is stored here. Route names expire every minute.
export class IntentPrefetchBudget {
  private windowStart = 0;
  private last = Number.NEGATIVE_INFINITY;
  private targets = new Set<string>();
  take(target: string, now: number): boolean {
    if (now < this.windowStart || now - this.windowStart >= 60_000) {
      this.windowStart = now; this.targets.clear(); this.last = Number.NEGATIVE_INFINITY;
    }
    if (this.targets.has(target) || this.targets.size >= 6 || now - this.last < 750) return false;
    this.targets.add(target); this.last = now; return true;
  }
}

/** One bounded client budget shared by intent links and the idle shell warmer. */
export const sharedIntentPrefetchBudget = new IntentPrefetchBudget();
