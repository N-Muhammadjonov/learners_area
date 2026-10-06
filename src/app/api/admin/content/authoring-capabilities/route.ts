import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/current-user";
import { listRegisteredAuthors, registerModuleAuthors } from "@/lib/content/authors";
import { importCapabilities } from "@/lib/import/capabilities";
import { MODULE_DESCRIPTORS } from "@/lib/content/taxonomy";

/**
 * GET /api/admin/content/authoring-capabilities
 *
 * What the authoring workspace may offer, and what it may not. A content type
 * without an author is reported as such instead of opening a form that writes
 * nothing.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  registerModuleAuthors();
  const authors = new Map(listRegisteredAuthors().map((author) => [`${author.module}:${author.contentType}`, author]));
  // Importability is a fact of the importer registry, so the workspace never has to
  // guess which content types accept a package with assets.
  const importable = new Set(importCapabilities().map((entry) => `${entry.module}:${entry.contentType}`));
  return NextResponse.json({
    modules: MODULE_DESCRIPTORS.map((module) => ({
      module: module.module,
      label: module.label,
      tracks: module.tracks,
      contentTypes: module.contentTypes.map((contentType) => ({
        contentType,
        authorable: authors.has(`${module.module}:${contentType}`),
        importable: importable.has(`${module.module}:${contentType}`),
        label: authors.get(`${module.module}:${contentType}`)?.label ?? null,
      })),
    })),
  });
}
