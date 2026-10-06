import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { ContentWorkspace } from "@/components/admin/ContentWorkspace";

export const metadata = { title: "Authoring workspace" };

/**
 * /admin/content/workspace — the authoring workspace (§AA).
 *
 * ONE admin surface over the content bank, the revision history, the native preview and
 * the publication service. It is not a second CMS: the screen reads and writes through
 * the admin content routes, which call the authoring registry, the version store, the
 * preview projection and the publication service — so nothing here can invent a
 * publication state, a revision identity or a visibility rule of its own.
 *
 * The page is administrator-gated, and `canPublish` comes from the same permission
 * helper the publication route uses, so the publish buttons are shown to exactly the
 * roles the service will accept. A hidden button is a courtesy, not the control: the
 * service still refuses anyone else (§role bypass).
 */
export default async function AdminContentWorkspacePage() {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-6">
      <ContentWorkspace dict={dict} canPublish={mayPublishImportedContent(administrator.role)} />
    </div>
  );
}
