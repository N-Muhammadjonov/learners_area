import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail } from "@/lib/data/full-listening";
import { listeningSequenceAccess } from "@/lib/data/listening-sequence";
import { originalCourseStatus, recordOriginalCourseWork } from "@/lib/data/listening-course";
import { hasOriginalListeningRuntime } from "@/lib/listening/original-listening";
import { enforce } from "@/lib/http/rate-limit";
import { isUuid } from "@/lib/validation/ids";

const headers = { "Cache-Control": "private, no-store" };
const input = z.object({
  activity: z.enum(["review", "script", "mcq", "matching", "map", "multi", "completion", "vocab", "retry"]),
  answers: z.record(z.string().min(1).max(160), z.string().min(1).max(4000)),
}).refine((value) => Object.keys(value.answers).length <= 80);

async function context(id: string) {
  const user = await requireActiveUser();
  if (!user)
    return { response: NextResponse.json({ error: "unauthenticated" }, { status: 401, headers }) };
  if (!isUuid(id))
    return { response: NextResponse.json({ error: "not_found" }, { status: 404, headers }) };
  if (!await listeningSequenceAccess(user, id))
    return { response: NextResponse.json({ error: "sequence_locked" }, { status: 403, headers }) };
  const detail = await fullListeningDetail(id, user.role);
  if (!detail || !hasOriginalListeningRuntime(id, detail.pkg.sourceId))
    return { response: NextResponse.json({ error: "not_found" }, { status: 404, headers }) };
  return { user, sourceId: detail.pkg.sourceId };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await context(id);
  if ("response" in ctx) return ctx.response;
  return NextResponse.json(await originalCourseStatus(ctx.user.id, id, ctx.sourceId), { headers });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await context(id);
  if ("response" in ctx) return ctx.response;
  const limited = enforce({ name: "listening_course_work", limit: 240, windowMs: 60000 }, ctx.user.id);
  if (limited) return limited;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
  try {
    return NextResponse.json(
      await recordOriginalCourseWork(ctx.user.id, id, ctx.sourceId, parsed.data.activity, parsed.data.answers),
      { headers },
    );
  } catch (error) {
    if (error instanceof Error && ["invalid_activity", "exam_required", "invalid_answers"].includes(error.message))
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    throw error;
  }
}
