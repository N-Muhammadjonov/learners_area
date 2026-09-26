import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoLessons } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isLive } from "@/lib/services/cms/publication";
import { saveResponse } from "@/lib/data/video-lessons";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";

/**
 * POST /api/video-lessons/:id/response
 *
 * "Your opinion" and "Summary": the student's own writing. It is stored against
 * their progress so the teacher can read and respond to it. Nothing here is
 * auto-graded and no model comment is invented — an empty review is shown as
 * waiting, never as a band.
 */
const schema = z.object({
  responseText: z.string().max(4000).optional(),
  summaryText: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const limited = enforce(RULES.evaluation, clientKey(req));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const videoLesson = await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, id) });
  if (!videoLesson || !isLive(videoLesson)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const state = await saveResponse(videoLesson.id, user.id, parsed.data);
  return NextResponse.json({ state });
}
