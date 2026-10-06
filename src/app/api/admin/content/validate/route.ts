import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { registerImportDescriptors } from "@/lib/import/capabilities";
import { parseContentPackage } from "@/lib/import/core/parse";
import { packageContentHash } from "@/lib/import/core/identity";
import { peekSourceStatus } from "@/lib/import/core/pipeline";
import { mayImportModule } from "@/lib/import/core/permissions";
import { MAX_PACKAGE_BYTES, issue } from "@/lib/import/core/validation";

/**
 * POST /api/admin/content/validate
 *
 * Level 1 + level 2 validation, and the ASSET REQUIREMENTS the package implies,
 * with no database write and nothing claimed. This is what lets the admin UI
 * check a 50 KB JSON file BEFORE a 25 MB recording is uploaded, and tell the
 * operator exactly which files the package expects.
 */
export async function POST(req: NextRequest) {
  registerImportDescriptors();
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > MAX_PACKAGE_BYTES)
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  let candidate: unknown;
  try {
    const body: unknown = JSON.parse(raw || "null");
    candidate = body && typeof body === "object" && !Array.isArray(body) && "package" in (body as object)
      ? (body as { package: unknown }).package
      : body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseContentPackage(candidate);
  if (!parsed.ok)
    return NextResponse.json(
      { ok: false, code: parsed.code, issues: parsed.report.issues, warnings: parsed.report.warnings },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );

  const { pkg, descriptor, migratedFrom, warnings } = parsed;
  if (!mayImportModule(user.role, pkg.module))
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sourceStatus = await peekSourceStatus(pkg.module, pkg.contentType, pkg.sourceRef, packageContentHash(pkg));
  const requirements = descriptor.requiredAssets?.(pkg.content) ?? [];
  const declared = new Map(pkg.assets.map((asset) => [asset.key, asset]));
  const missing = requirements
    .filter((requirement) => requirement.required && !declared.has(requirement.key))
    .map((requirement) => requirement.key);
  const preview = descriptor.preview?.(pkg) ?? null;
  const issues = [...requirements.filter((requirement) => requirement.required && !declared.has(requirement.key)).map((requirement) => issue(3, "asset_missing", `Asset "${requirement.key}" is required.`, "assets"))];

  return NextResponse.json(
    {
      ok: issues.length === 0,
      module: pkg.module,
      contentType: pkg.contentType,
      schemaVersion: pkg.schemaVersion,
      importerVersion: descriptor.schemaVersion,
      title: pkg.title,
      sourceRef: pkg.sourceRef,
      ...(migratedFrom !== undefined ? { migratedFrom } : {}),
      contentHash: pkg.contentHash ?? null,
      capabilities: { key: `${pkg.module}:${pkg.contentType}:v${descriptor.schemaVersion}`, label: descriptor.label },
      requiredAssets: requirements.map((requirement) => ({
        key: requirement.key,
        role: requirement.role,
        required: requirement.required,
        label: requirement.label ?? null,
        mimeTypes: requirement.mimeTypes,
        maxBytes: requirement.maxBytes,
        declared: declared.has(requirement.key),
        path: declared.get(requirement.key)?.path ?? null,
      })),
      missingAssetKeys: missing,
      sourceStatus,
      preview,
      issues,
      warnings: warnings.map((entry) => entry.message),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
