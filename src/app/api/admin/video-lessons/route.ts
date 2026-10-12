import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/validation/ids";
import { z } from "zod";
import { db } from "@/db/client";
import { videoLessons } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canManageContent } from "@/lib/auth/ownership";
import { actorOf, requireStaff } from "@/lib/auth/current-user";
import { createVideoLesson, listVideoLessons } from "@/lib/data/video-lessons";
import { recordAudit } from "@/lib/data/audit";
import { describeParseFailure } from "@/lib/services/video/provider";

/**
 * POST /api/admin/video-lessons — author a public video lesson.
 *
 * Authorised staff only, and the video is stored as a validated provider
 * reference: the form pastes a normal YouTube link, the server parses it, and an
 * unsupported host or a malformed id is refused with the reason — it never
 * becomes an arbitrary embed snippet on a student's page.
 *
 * The transcript is required to declare where it came from (`authored`,
 * `licensed`, `permitted`). A public video being embeddable is not permission to
 * copy its transcript, so the source is recorded rather than assumed.
 */
const transcriptLine = z.object({ startSeconds: z.number().min(0).max(60 * 60 * 12), text: z.string().max(600) });

const schema = z.object({
  // Absent/null = a standalone TED / Podcast item (no roadmap lesson needed).
  lessonId: z.string().uuid().optional().nullable(),
  videoLessonId: z.string().uuid().optional().nullable(),
  /** A Podcast episode is authored as an audio lesson (§28). */
  mediaKind: z.enum(["video", "audio"]).optional().nullable(),
  title: z.string().trim().min(3).max(200),
  videoUrl: z.string().trim().min(3).max(500),
  beforeYouWatch: z.string().max(2000).optional().nullable(),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 12).optional().nullable(),
  transcriptSource: z.enum(["authored", "licensed", "permitted"]).optional().nullable(),
  transcriptAttribution: z.string().max(200).optional().nullable(),
  transcript: z.array(transcriptLine).max(2000).optional().nullable(),
  // Optional plain transcript (owner-authored paragraphs, no timestamps).
  transcriptText: z.string().max(20000).optional().nullable(),
  // Optional study notes: absent means the learner surface shows no notes
  // control at all, never an empty one.
  notes: z.string().max(4000).optional().nullable(),
  vocabulary: z.array(z.object({word: z.string().trim().min(1).max(120), pos: z.string().max(30), def: z.string().trim().min(1).max(500), uz: z.string().max(500), ex: z.string().trim().min(1).max(500)})).max(100).optional(),
  questions: z
    .array(
      z.object({
        stage: z.enum(["comprehension", "gap_fill"]),
        prompt: z.string().trim().min(3).max(600),
        acceptedAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
        atSeconds: z.number().int().min(0).max(60 * 60 * 12).optional().nullable(),
      })
    )
    .max(200)
    .optional(),
});

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await listVideoLessons();
  return NextResponse.json({
    videoLessons: rows.map(({ videoLesson, lesson }) => ({
      id: videoLesson.id,
      lessonId: lesson?.id ?? null,
      lessonTitle: lesson?.title ?? null,
      standalone: !lesson,
      provider: videoLesson.provider,
      videoId: videoLesson.videoId,
      title: videoLesson.title,
      isActive: videoLesson.isActive,
    })),
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", detail: parsed.error.issues[0]?.message }, { status: 400 });
  }

  if (parsed.data.lessonId && !isUuid(parsed.data.lessonId)) {
    return NextResponse.json({ error: "invalid_input", detail: "lessonId" }, { status: 400 });
  }
  if (parsed.data.lessonId && parsed.data.videoLessonId) {
    return NextResponse.json({ error: "invalid_input", detail: "lessonId_or_videoLessonId" }, { status: 400 });
  }
  if (parsed.data.transcript?.length && parsed.data.transcriptText?.trim()) {
    return NextResponse.json({ error: "invalid_input", detail: "transcript_ambiguous" }, { status: 400 });
  }

  if (parsed.data.vocabulary?.length) {
    const body = [parsed.data.transcriptText, ...(parsed.data.transcript ?? []).map(line => line.text), parsed.data.notes].filter(Boolean).join("\n");
    if (parsed.data.vocabulary.some(entry => !body.includes(entry.ex))) {
      return NextResponse.json({error: "vocabulary_context_required"}, {status: 400});
    }
  }
  if ((parsed.data.transcript?.length || parsed.data.transcriptText?.trim()) && !parsed.data.transcriptSource) {
    return NextResponse.json({error: "invalid_input", detail: "transcript_source_required"}, {status: 400});
  }
  const existing = parsed.data.videoLessonId
    ? await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, parsed.data.videoLessonId) })
    : parsed.data.lessonId
      ? await db.query.videoLessons.findFirst({ where: eq(videoLessons.lessonId, parsed.data.lessonId) })
      : null;
  if (existing && !canManageContent(actorOf(staff), existing.createdByUserId ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await createVideoLesson(parsed.data, staff.id);
  if (!result.ok) {
    if (result.reason === "lesson_not_found" || result.reason === "video_lesson_not_found") {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    if (result.reason === "video_exists") {
      return NextResponse.json({ error: "video_exists" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "video_rejected", reason: result.reason, detail: describeParseFailure(result.reason) },
      { status: 400 }
    );
  }

  await recordAudit({
    actorUserId: staff.id,
    action: "video_lesson.saved",
    targetType: "video_lesson",
    targetId: result.videoLessonId,
    metadata: {
      lessonId: parsed.data.lessonId ?? null,
      standalone: !parsed.data.lessonId,
      hasTranscript: Boolean(parsed.data.transcript?.length || parsed.data.transcriptText?.trim()),
      hasNotes: Boolean(parsed.data.notes?.trim()),
    },
  });

  return NextResponse.json({ ok: true, id: result.videoLessonId });
}
