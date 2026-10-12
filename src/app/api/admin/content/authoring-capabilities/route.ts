import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/current-user";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { mayAuthorContent } from "@/lib/content/authoring-access";
import { listRegisteredAuthors, registerModuleAuthors } from "@/lib/content/authors";
import { importCapabilities } from "@/lib/import/capabilities";
import { MODULE_DESCRIPTORS } from "@/lib/content/taxonomy";

/**
 * GET /api/admin/content/authoring-capabilities
 *
 * What the authoring workspace may offer, and what it may not. A content type
 * without an author is reported as such instead of opening a form that writes
 * nothing.
 *
 * The answer is PER ROLE, because "registered" and "this person may write it" are
 * different facts: every registered content type is authorable by an administrator or
 * the owner, while a teacher may author only the ones the capability rule grants (a
 * lesson, for example). `authorable` is computed by the same `mayAuthorContent` the
 * write routes enforce, so a UI that derives its controls from here cannot offer a door
 * the server would refuse — and `authorableKeys` is the flat list a desk can check
 * without walking the tree.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  registerModuleAuthors();
  const authors = new Map(listRegisteredAuthors().map((author) => [`${author.module}:${author.contentType}`, author]));
  const authorableKeys = [...authors.keys()].filter((key) => {
    const [module, contentType] = key.split(":") as [string, string];
    return mayAuthorContent(user.role, module, contentType);
  });
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
        // Registered AND within this role's authority — the two must both hold for a
        // form to be honest, so the boolean the UI reads is the combined one.
        authorable: mayAuthorContent(user.role, module.module, contentType),
        registered: authors.has(`${module.module}:${contentType}`),
        importable: importable.has(`${module.module}:${contentType}`),
        label: authors.get(`${module.module}:${contentType}`)?.label ?? null,
      })),
    })),
    authorableKeys,
    mayPublish: mayPublishImportedContent(user.role),
  });
}
