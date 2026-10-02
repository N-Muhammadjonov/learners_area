import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { NextRequest, NextResponse } from "next/server";
import { ingestListeningOccurrences } from "@/lib/services/lexical/listening-occurrences";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  listeningPackages,
  listeningTests,
  listeningQuestions,
  resourceBlocks,
  uploadIntents,
} from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { mayImportListening } from "@/lib/listening/permissions";
import {
  listeningPackageSchema,
  publicationIssues,
} from "@/lib/listening/package";
import { AUDIO_MIME } from "@/lib/listening/discover";
// Every recording format the ZIP importer accepts (stored as the canonical MIME
// for its extension; an audio-only .webm is stored as video/webm by the
// upload policy and plays in <audio> all the same).
const LISTENING_AUDIO_MIME = new Set([...Object.values(AUDIO_MIME), "video/webm"]);
const input = z.object({
  payload: listeningPackageSchema,
  audioUploadId: z.string().uuid(),
  imageUploadId: z.string().uuid().nullable(),
});
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (error) {
    // Never an HTML 500: the staff UI maps `error` to a readable message and
    // shows the reference; the technical detail stays in the server log.
    const correlationId = crypto.randomUUID().slice(0, 8);
    console.error("[listening-import] failed", { correlationId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "unknown", correlationId }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayImportListening(user.role))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await listeningSchemaReady()))
    return NextResponse.json(
      { error: "qa_migration_0028_required" },
      { status: 503 },
    );
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      // Stable code for the UI; the first schema issue is detail for staff/logs.
      { error: "invalid_package", detail: parsed.error.issues[0]?.message?.slice(0, 200) },
      { status: 400 },
    );
  const { payload, audioUploadId, imageUploadId } = parsed.data;
  if (!!payload.imagePath !== !!imageUploadId)
    return NextResponse.json({ error: "missing_map" }, { status: 400 });
  const ids = [audioUploadId, ...(imageUploadId ? [imageUploadId] : [])];
  if (new Set(ids).size !== ids.length)
    return NextResponse.json({ error: "duplicate_asset" }, { status: 400 });
  const result = await db.transaction(async (tx) => {
    // All intents are claimed together, so an interrupted import cannot attach half a package.
    const intents = await tx
      .select()
      .from(uploadIntents)
      .where(inArray(uploadIntents.id, ids))
      .orderBy(uploadIntents.id)
      .for("update");
    if (
      intents.length !== ids.length ||
      intents.some(
        (x) =>
          x.userId !== user.id ||
          x.status !== "finalized" ||
          x.usedAt ||
          x.purpose !== "material_primary",
      )
    )
      return { error: "upload_not_owned_or_finalized" };
    const audio = intents.find((x) => x.id === audioUploadId)!;
    const image = intents.find((x) => x.id === imageUploadId);
    if (
      !LISTENING_AUDIO_MIME.has(audio.mimeType) ||
      (image &&
        !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType))
    )
      return { error: "invalid_media_type" };
    if (
      await tx.query.listeningPackages.findFirst({
        where: eq(listeningPackages.sourceId, payload.testId),
      })
    )
      return { error: "source_already_imported" };
    const [test] = await tx
      .insert(listeningTests)
      .values({
        title: payload.title,
        createdByUserId: user.id,
        audioType: "audio",
        publicationState: "draft",
        transcript: payload.sections.map((s) => s.transcript).join("\n\n"),
        audioUrl: `/api/resources/${audio.objectKey}`,
      })
      .returning();
    await tx
      .insert(listeningPackages)
      .values({
        testId: test!.id,
        sourceId: payload.testId,
        payload,
        audioObjectKey: audio.objectKey,
        imageObjectKey: image?.objectKey ?? null,
        sourceHash: createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex"),
      });
    await tx
      .insert(listeningQuestions)
      .values(
        payload.questions.map((q) => ({
          testId: test!.id,
          order: q.number,
          type: q.options.length
            ? ("multiple_choice" as const)
            : ("short_answer" as const),
          questionText: q.text,
          options: q.options,
          correctAnswer: q.options.find(o => o === q.key || o.startsWith(q.key + " ")) ?? q.key,
          explanation: q.evidence.why,
        })),
      );
    await tx
      .insert(resourceBlocks)
      .values(
        intents.map((x, position) => ({
          ownerType: "listening" as const,
          ownerId: test!.id,
          position,
          type:
            x.id === audioUploadId ? ("audio" as const) : ("image" as const),
          objectKey: x.objectKey,
          originalName: x.originalName,
          mimeType: x.mimeType,
          size: x.size,
          createdByUserId: user.id,
        })),
      );
    await tx
      .update(uploadIntents)
      .set({ status: "attached", usedAt: new Date() })
      .where(
        and(
          inArray(uploadIntents.id, ids),
          eq(uploadIntents.status, "finalized"),
        ),
      );
    // Authored vocabulary → exact transcript occurrences, in the same transaction:
    // a test is never live with transcript words that point at no checked sense.
    const lexical = await ingestListeningOccurrences(tx, test!.id, payload);
    return { id: test!.id, publicationIssues: publicationIssues(payload), lexical };
  }).catch((error: unknown) => {
    // Two uploads of the same source can race past the read check. The unique
    // source ID remains authoritative and the transaction rolls back all claims.
    let cause = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      const current = cause as { code?: unknown; cause?: unknown };
      if (current.code === "23505") return { error: "source_already_imported" };
      cause = current.cause;
    }
    throw error;
  });
  return NextResponse.json(result, { status: "error" in result ? 409 : 201 });
}
