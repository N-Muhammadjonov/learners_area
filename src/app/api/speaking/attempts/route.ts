import { withUploadErrorBoundary } from "@/lib/uploads/server-errors";
import { NextRequest, NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { ATTEMPT_HISTORY_LIMIT, listAttempts } from "@/lib/data/speaking-practice";
import { startSpeakingAttempt } from "@/lib/services/speaking/attempts";
import { createAttemptSchema } from "@/lib/validation/speaking-practice";

/**
 * POST /api/speaking/attempts — start a practice attempt.
 *
 * The row is created in `recording` state before any audio exists, so the
 * client has an attemptId to scope its upload-intent to. That is what keeps a
 * recording's object key inside `speaking/attempts/<attemptId>/` instead of an
 * anonymous `pending/` namespace.
 *
 * GET /api/speaking/attempts — the caller's own attempt history, most recent
 * first, bounded at ATTEMPT_HISTORY_LIMIT. A student only ever sees their own;
 * teachers and admins see attempts across learners for review, within the same
 * bound. The response reports `limit` and `returned` so a caller can tell a
 * complete history from the first page of a longer one.
 */
export async function POST(req: NextRequest) {
  return withUploadErrorBoundary("speaking_attempt_start", () => start(req), "database");
}

async function start(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createAttemptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });
  }
  const data = parsed.data;

  // The service owns the identity rules: the prompt must exist, must be LIVE for
  // learners, must match the declared part, and the attempt records the exact revision
  // it answered (§5). Free practice (no prompt) stays free.
  const started = await startSpeakingAttempt({ actorId: user.id, promptId: data.promptId ?? null, part: data.part });

  if (!started.ok) {
    const status = started.reason === "prompt_not_found" ? 404 : 422;
    return NextResponse.json({ error: started.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    attempt: started.attempt,
    // The client is told whether its attempt is bound to a revision, so it never
    // implies a pinned prompt it does not have.
    binding: started.binding,
    contentVersionId: started.contentVersionId,
  });
}

export async function GET(_req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Bounded through the same read the history page uses, rather than querying the table here.
  //
  // This handler used to run `findMany({ where, orderBy: [desc(startedAt)] })` with no limit at
  // all, so the response grew without bound with the caller's history. Measured on a local
  // PostgreSQL 18 with pg_stat_statements (docs/SCALE-MEASUREMENT.md), at 100 / 1 000 / 10 000
  // attempts for one learner:
  //
  //   attempts   returned   payload      median     rows read
  //        100        100      46 324 B     9.3 ms        505
  //      1 000      1 000     463 024 B    17.0 ms      5 005
  //     10 000     10 000   4 630 024 B   116.4 ms     50 005
  //
  // Over the same series GET /app/speaking/history — which goes through listAttempts() — stayed at
  // 373 721 bytes and 505 rows read, because that function bounds the read at 100 and resolves the
  // referenced prompts in one query. The page was O(1) while this endpoint was O(n) on the same
  // table. For a staff caller it was worse than O(n) on one learner: `where: undefined` read every
  // attempt belonging to every user in the system.
  //
  // Delegating keeps one source of truth for the read, keeps the reviewer scope, and returns the
  // attempts with their prompt attached. `limit` is reported so a caller can see the bound instead
  // of inferring that it has the whole history.
  const isReviewer = isStaff(user.role);
  const attempts = await listAttempts(isReviewer ? {} : { userId: user.id });

  return NextResponse.json({ ok: true, attempts, limit: ATTEMPT_HISTORY_LIMIT, returned: attempts.length });
}
