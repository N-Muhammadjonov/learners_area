import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { listeningPackages } from "@/db/schema";
import { publicationBlockers, publicationIssues } from "@/lib/listening/package";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  courses,
  listeningTests,
  readingPassages,
  speakingMaterials,
  speakingPrompts,
  videoLessons,
  writingPrompts,
} from "@/db/schema";
import { requireAdministrator } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { recordAudit } from "@/lib/data/audit";
import { changeWritingPublication } from "@/lib/services/writing/admin";
import type { WritingAdminKind } from "@/lib/writing/admin-schemas";

/** Writing kinds: same rule + audit, plus Writing publish-readiness (services/writing/admin). */
const WRITING_TYPES: Record<string, WritingAdminKind> = {
  writing: "prompt", "writing-lesson": "lesson", "writing-translation": "translation", "writing-model-text": "model-text", "writing-pattern": "pattern",
};
import {
  canTransition,
  isLive,
  isPublicationState,
  publicationProblem,
  type PublicationState,
} from "@/lib/services/cms/publication";

/**
 * POST /api/admin/content/:type/:id/publication
 *
 * The ONE place content is published, scheduled or archived. Every content type
 * shares this endpoint and the same rule, so a change to the rule cannot reach
 * Reading and forget Listening.
 *
 * Who may call it: ADMIN and OWNER. A teacher authors questions through the
 * existing admin surfaces but does not decide what students may see, which is
 * exactly the separation the roles exist for.
 *
 * What it refuses:
 *   - a transition the rule does not allow (`archived → published` without a
 *     deliberate restore);
 *   - `scheduled` without a moment, and a moment attached to any other state;
 *   - a type or id that does not exist (the same 404 either way).
 *
 * Every accepted change writes an audit row with the previous and the new state,
 * so "why did this disappear on Tuesday?" has an answer months later. Archiving
 * never deletes: attempts, scores and history stay exactly where they were.
 */
const schema = z
  .object({
    state: z.string(),
    /** ISO instant, required for `scheduled` and refused for everything else. */
    publishAt: z.string().datetime({ offset: true }).nullish(),
  })
  .strict();

/**
 * The publishable content types, each with the loader and the audit label. Adding
 * a type is one line here plus the columns on its table — there is no second
 * publication mechanism anywhere in the codebase.
 */
const CONTENT_TYPES = {
  reading: {
    label: "reading_passage",
    load: (id: string) => db.query.readingPassages.findFirst({ where: eq(readingPassages.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(readingPassages).set(values).where(eq(readingPassages.id, id)),
  },
  listening: {
    label: "listening_test",
    load: (id: string) => db.query.listeningTests.findFirst({ where: eq(listeningTests.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(listeningTests).set(values).where(eq(listeningTests.id, id)),
  },
  writing: {
    label: "writing_prompt",
    load: (id: string) => db.query.writingPrompts.findFirst({ where: eq(writingPrompts.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(writingPrompts).set(values).where(eq(writingPrompts.id, id)),
  },
  speaking: {
    label: "speaking_material",
    load: (id: string) => db.query.speakingMaterials.findFirst({ where: eq(speakingMaterials.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(speakingMaterials).set(values).where(eq(speakingMaterials.id, id)),
  },
  "speaking-prompt": {
    label: "speaking_prompt",
    load: (id: string) => db.query.speakingPrompts.findFirst({ where: eq(speakingPrompts.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(speakingPrompts).set(values).where(eq(speakingPrompts.id, id)),
  },
  video: {
    label: "video_lesson",
    load: (id: string) => db.query.videoLessons.findFirst({ where: eq(videoLessons.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(videoLessons).set(values).where(eq(videoLessons.id, id)),
  },
  course: {
    label: "course",
    load: (id: string) => db.query.courses.findFirst({ where: eq(courses.id, id) }),
    save: (id: string, values: { publicationState: PublicationState; publishAt: Date | null }) =>
      db.update(courses).set(values).where(eq(courses.id, id)),
  },
} as const;

type ContentType = keyof typeof CONTENT_TYPES;

export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const administrator = await requireAdministrator();
  if (!administrator) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contentType = CONTENT_TYPES[type as ContentType];
  if (!contentType && !WRITING_TYPES[type]) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (!isPublicationState(parsed.data.state)) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }

  const state = parsed.data.state;
  const publishAt = parsed.data.publishAt ? new Date(parsed.data.publishAt) : null;

  const writingKind = WRITING_TYPES[type];
  if (writingKind) {
    const r = await changeWritingPublication(writingKind, id, state, publishAt, administrator.id);
    if (!r.ok) return NextResponse.json({ error: r.error, issues: r.issues }, { status: r.status });
    return NextResponse.json(r);
  }

  const problem = publicationProblem(state, publishAt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  if (type === "listening" && (state === "published" || state === "scheduled") && await listeningSchemaReady()) {
    const pkg = await db.query.listeningPackages.findFirst({ where: eq(listeningPackages.testId, id) });
    if (pkg) {
      const issues = publicationIssues(pkg.payload);
      if (issues.length)
        return NextResponse.json(
          { error: "incomplete_listening_package", issues, blockers: publicationBlockers(pkg.payload) },
          { status: 409 },
        );
    }
  }
  if (!contentType) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await contentType.load(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const from = isPublicationState(row.publicationState) ? row.publicationState : "published";
  if (from === state) {
    // Idempotent: pressing the same state twice is not an error, and it does not
    // write a second audit row that would suggest something happened.
    return NextResponse.json({ ok: true, state, publishAt: row.publishAt ?? null, changed: false });
  }
  if (!canTransition(from, state)) {
    return NextResponse.json({ error: "invalid_transition", from, to: state }, { status: 409 });
  }

  // The `is_active` boolean is kept in step as the older hint other screens still
  // read; the publication state is what takes the decision.
  await contentType.save(id, { publicationState: state, publishAt });
  await recordAudit({
    actorUserId: administrator.id,
    action: "content.updated",
    targetType: contentType.label,
    targetId: id,
    metadata: {
      from,
      to: state,
      publishAt: publishAt ? publishAt.toISOString() : null,
      live: isLive({ publicationState: state, publishAt }),
    },
  });

  return NextResponse.json({
    ok: true,
    state,
    publishAt: publishAt ? publishAt.toISOString() : null,
    changed: true,
  });
}
