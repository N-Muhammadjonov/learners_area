import { notFound, redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { BackLink } from "@/components/ui/BackLink";
import { PublicationControl } from "@/components/admin/PublicationControl";
import { ResourceComposer } from "@/components/resources/ResourceComposer";
import { WritingContentForm } from "@/components/admin/writing/WritingContentForm";
import { toResourceBlockView, listResourceBlocks } from "@/lib/data/resources";
import { getWritingContent, listWritingContent } from "@/lib/services/writing/admin";
import { PUBLICATION_TYPE, isWritingAdminKind } from "@/lib/writing/admin-schemas";

export const dynamic = "force-dynamic";

export default async function EditWritingContentPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const { kind, id } = await params;
  if (!isWritingAdminKind(kind) || !isUuid(id)) notFound();
  const row = await getWritingContent(kind, id);
  if (!row) notFound();
  const dict = getDictionary(await getLocale());
  const t = dict.admin.writingAdmin;
  const sources = kind === "pattern" ? (await listWritingContent("model-text")).map((r) => ({ id: r.id, title: r.title })) : [];
  // Task 1 visuals use the existing secure material-block upload path (owner type "writing").
  const blocks = kind === "prompt" ? toResourceBlockView(await listResourceBlocks("writing", id)) : [];
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5" data-admin-writing-edit-page={kind}>
      <BackLink fallbackHref={`/admin/writing?section=${kind === "prompt" ? "exam" : kind}`} label={t.back} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.sections[kind]}</p>
        <h1 className="font-display text-2xl text-ink-900">{t.editTitle}</h1>
      </div>
      <section className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-paper-raised p-4">
        <h2 className="font-display text-lg text-ink-900">{t.publication}</h2>
        <PublicationControl type={PUBLICATION_TYPE[kind]} id={id} state={row.publicationState} publishAt={row.publishAt} dict={dict} issueLabels={t.issues} />
      </section>
      <WritingContentForm dict={dict} kind={kind} id={id} initial={row} sources={sources} />
      {kind === "prompt" && (
        <section className="flex flex-col gap-2" data-admin-writing-visuals>
          <h2 className="font-display text-lg text-ink-900">{t.visuals}</h2>
          <ResourceComposer dict={dict} ownerType="writing" ownerId={id} initial={blocks} />
        </section>
      )}
    </div>
  );
}
