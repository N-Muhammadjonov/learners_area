import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { MAX_PACKAGE_BYTES, IMPORT_ERROR_STATUS, MAX_PACKAGE_BYTES as LIMIT } from "@/lib/import/core/validation";
import { runContentImport, registerImportFramework } from "@/lib/import/server";

/**
 * POST /api/admin/content/import
 *
 * The ONE canonical content import endpoint, for every module:
 *
 *   {
 *     package: <canonical envelope, or a still-supported older version>,
 *     assetUploads: { "<asset key>": "<finalized upload id>" },
 *     dryRun?: boolean,               // real validation, always rolled back
 *     publish?: boolean,              // explicit authorized publish action
 *     acknowledgeGradeImpact?: boolean,
 *     originalFilename?: string
 *   }
 *
 * Structured JSON travels as an authenticated request — it never needs object
 * storage. Only the declared BINARY assets go through the upload lifecycle, and
 * the client sends upload ids, never object keys.
 */
export async function POST(req: NextRequest) {
  registerImportFramework();
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > MAX_PACKAGE_BYTES)
    return NextResponse.json({ error: "payload_too_large", detail: `Max ${LIMIT} bytes.` }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return NextResponse.json({ error: "invalid_input", detail: "Body must be a JSON object." }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pkg = body.package ?? body.raw ?? null;
  if (!pkg) return NextResponse.json({ error: "invalid_input", detail: "Missing `package`." }, { status: 400 });

  const assetUploadsRaw = body.assetUploads;
  const assetUploads: Record<string, string> = {};
  if (assetUploadsRaw && typeof assetUploadsRaw === "object" && !Array.isArray(assetUploadsRaw)) {
    for (const [key, value] of Object.entries(assetUploadsRaw as Record<string, unknown>)) {
      if (typeof value === "string" && value.length <= 64) assetUploads[key.slice(0, 61)] = value;
    }
  }

  try {
    const outcome = await runContentImport({
      actor: { id: user.id, role: user.role },
      raw: pkg,
      assetUploads,
      dryRun: body.dryRun === true,
      publish: body.publish === true,
      acknowledgeGradeImpact: body.acknowledgeGradeImpact === true,
      ...(typeof body.originalFilename === "string" ? { originalFilename: body.originalFilename.slice(0, 255) } : {}),
    });
    if (outcome.ok) return NextResponse.json(outcome, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    const status = IMPORT_ERROR_STATUS[outcome.code] ?? 400;
    return NextResponse.json(outcome, { status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // Never an HTML 500: the staff UI maps `error` to readable copy and shows
    // the reference; the technical detail stays in the server log.
    const correlationId = crypto.randomUUID().slice(0, 8);
    console.error("[content-import] failed", {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "unknown", correlationId }, { status: 500 });
  }
}

/** GET /api/admin/content/import — capabilities the caller may import. */
export async function GET() {
  registerImportFramework();
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { listRegisteredImporters } = await import("@/lib/import/core/server-registry");
  const { importCapabilities } = await import("@/lib/import/capabilities");
  return NextResponse.json(
    { capabilities: importCapabilities(), importers: listRegisteredImporters() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
