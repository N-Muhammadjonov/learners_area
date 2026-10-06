import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { examplePackageFor, importCapabilities, registerImportDescriptors } from "@/lib/import/capabilities";

/**
 * GET /api/admin/content/template?module=listening&contentType=full_test&kind=template
 *
 * The canonical template (and, where published, a full synthetic example) for a
 * module, so an author — human or AI — never has to guess the schema.
 */
export async function GET(req: NextRequest) {
  registerImportDescriptors();
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const moduleName = req.nextUrl.searchParams.get("module") ?? "";
  const contentType = req.nextUrl.searchParams.get("contentType") ?? "";
  const kind = req.nextUrl.searchParams.get("kind") === "example" ? "example" : "template";

  const capability = importCapabilities().find(
    (entry) => entry.module === moduleName && entry.contentType === contentType,
  );
  if (!capability) return NextResponse.json({ error: "unknown_content_type" }, { status: 404 });

  const payload = kind === "example" ? examplePackageFor(moduleName, contentType) : capability.template;
  if (payload === null || payload === undefined)
    return NextResponse.json({ error: "asset_missing", detail: `No ${kind} is published for this content type.` }, { status: 404 });

  const filename = `${moduleName}-${contentType}-${kind}-v${capability.schemaVersion}.json`;
  return new NextResponse(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
