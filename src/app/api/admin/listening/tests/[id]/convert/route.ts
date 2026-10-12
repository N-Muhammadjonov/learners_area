import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { listeningPackages } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { mayImportListening } from "@/lib/listening/permissions";
import { listeningPackageSchema } from "@/lib/listening/package";
import { recordAudit } from "@/lib/data/audit";
import { contentImportSchemaReady } from "@/lib/import/core/readiness";
import { applyListeningConversion, classifyListeningPayload } from "@/lib/import/listening/legacy";
import { validateCanonicalListeningPackage } from "@/lib/import/listening/canonical";
import { isUuid } from "@/lib/validation/ids";

/**
 * GET  /api/admin/listening/tests/:id/convert
 *   → the stored package plus its structural classification and runtime file list,
 *     for the inert converter that runs where the extractor already runs (browser
 *     DOMParser for a preview, Node + jsdom for the migration script). Marker
 *     only: never executable HTML in the browser as a runtime.
 *
 * POST /api/admin/listening/tests/:id/convert
 *   → apply an ALREADY CONVERTED canonical package to this test: same ids, same
 *     publication state, attempt history preserved, `content.import.legacy_converted`
 *     audited. The server validates the package with the same rules an uploaded
 *     package faces, so a client cannot slip unvalidated data into the database.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayImportListening(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await contentImportSchemaReady())) return NextResponse.json({ error: "qa_migration_0040_required" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await db.query.listeningPackages.findFirst({ where: (table, { eq }) => eq(table.testId, id) });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = listeningPackageSchema.safeParse(row.payload);
  if (!parsed.success)
    return NextResponse.json(
      { classification: "INVALID", reasons: parsed.error.issues.slice(0, 5).map((issue) => issue.message) },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  const scan = classifyListeningPayload(parsed.data);
  return NextResponse.json(
    { classification: scan.classification, reasons: scan.reasons, runtimeFiles: scan.runtimeFiles, payload: parsed.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayImportListening(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await contentImportSchemaReady())) return NextResponse.json({ error: "qa_migration_0040_required" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const validated = validateCanonicalListeningPackage(body?.package);
  if (!validated.ok)
    return NextResponse.json(
      { error: "invalid_package", issues: validated.issues },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  if (validated.pkg.sourceRef !== (await db.query.listeningPackages.findFirst({ where: (table, { eq }) => eq(table.testId, id) }))?.sourceId)
    return NextResponse.json({ error: "source_conflict", detail: "The converted package must keep the original sourceRef." }, { status: 409 });

  const result = await db.transaction((tx) =>
    applyListeningConversion(tx, {
      testId: id,
      actorUserId: user.id,
      package: validated.pkg,
      note: "Converted from the legacy review surface.",
    }),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

  await recordAudit({
    actorUserId: user.id,
    action: "content.import.legacy_converted",
    targetType: "listening_test",
    targetId: id,
    metadata: { questions: result.questions, contentHash: result.contentHash },
  });

  return NextResponse.json({ ok: true, applied: true, questions: result.questions }, { headers: { "Cache-Control": "private, no-store" } });
}
