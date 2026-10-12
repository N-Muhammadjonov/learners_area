import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { startExamPaper } from "@/lib/services/writing/exam";
import { safeWritingQuery } from "@/lib/writing/safe-query";

export const dynamic = "force-dynamic";
const body = z.object({ mode: z.enum(["task1", "task2", "full"]) }).strict();

/** POST /api/writing/exam — start (or resume) a Real Exam paper. The client sends only the mode. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Choose Task 1, Task 2 or Full Writing.", field: "mode" } }, { status: 400 });
  const result = await safeWritingQuery(() => startExamPaper(user.id, parsed.data.mode));
  if (!result.ok) return NextResponse.json({ error: { code: "not_migrated", message: "Real exam mode is not available yet.", retryable: false } }, { status: 503 });
  const r = result.value;
  if (!r.ok) {
    const status = r.code === "no_prompts" ? 404 : 409;
    return NextResponse.json({ error: { code: r.code, message: r.code === "no_prompts" ? "No published questions for this task." : "Another exam is open.", retryable: false }, openPaperId: r.openPaperId }, { status });
  }
  return NextResponse.json({ ok: true, id: r.paper.id, resumed: r.resumed });
}
