import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { createGradeRequest, runGrade } from "@/lib/services/writing/grade";
import { countEssayWords, MIN_GRADE_WORDS } from "@/lib/writing/grade-criteria";
import { livePromptForGrade } from "@/lib/data/writing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  taskType: z.enum(["task1", "task2"]),
  question: z.string().trim().min(10).max(4000),
  essay: z.string().max(20000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  promptId: z.string().uuid().nullish(),
}).strict();

/**
 * POST /api/writing/grade — save the immutable snapshot, then grade it with the
 * external AI provider (no RIWI fallback). The same idempotency key never
 * creates a second request or a second provider call.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return NextResponse.json({ error: { code: "invalid_input", message: "Check the question and essay.", field } }, { status: 400 });
  }
  if (countEssayWords(parsed.data.essay) < MIN_GRADE_WORDS) {
    return NextResponse.json({ error: { code: "too_short", message: "The essay is too short to grade.", field: "essay" } }, { status: 400 });
  }
  // A chosen published prompt is authoritative: its exact wording is graded and its visual is shown with the result.
  let input = { ...parsed.data, promptId: null as string | null };
  if (parsed.data.promptId) {
    const prompt = await livePromptForGrade(parsed.data.promptId, parsed.data.taskType);
    if (!prompt) return NextResponse.json({ error: { code: "invalid_input", message: "This question is not available.", field: "promptId" } }, { status: 400 });
    input = { ...parsed.data, question: prompt.prompt, promptId: prompt.id };
  }
  const { row } = await createGradeRequest(user.id, input);
  const outcome = await runGrade(row.id, user.id, await getLocale());
  if (outcome.ok) return NextResponse.json({ ok: true, id: row.id, status: "evaluated" });
  const retryable = outcome.error !== "external_required" && outcome.error !== "not_found";
  return NextResponse.json({ ok: false, id: row.id, status: outcome.error === "in_progress" ? "pending" : "failed", error: { code: outcome.error, message: "AI grading did not complete. Your essay is saved.", retryable } }, { status: 200 });
}
