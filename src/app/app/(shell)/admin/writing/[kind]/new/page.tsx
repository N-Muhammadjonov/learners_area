import { notFound, redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BackLink } from "@/components/ui/BackLink";
import { WritingContentForm } from "@/components/admin/writing/WritingContentForm";
import { listWritingContent } from "@/lib/services/writing/admin";
import { isWritingAdminKind, type WritingAdminKind } from "@/lib/writing/admin-schemas";

export const dynamic = "force-dynamic";

const DEFAULTS: Record<WritingAdminKind, Record<string, unknown>> = {
  lesson: { category: "task2", position: 0 },
  prompt: { taskType: "task2", targetWordCount: 250 },
  translation: { questionType: "opinion", taskType: "task2", targetBand: 7, sentences: [] },
  "model-text": { taskType: "task2", targetBand: 8.5 },
  pattern: { function: "collocation", taskType: "task2" },
};

export default async function NewWritingContentPage({ params }: { params: Promise<{ kind: string }> }) {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/app");
  const { kind } = await params;
  if (!isWritingAdminKind(kind)) notFound();
  const dict = getDictionary(await getLocale());
  const t = dict.admin.writingAdmin;
  const sources = kind === "pattern" ? (await listWritingContent("model-text")).map((r) => ({ id: r.id, title: r.title })) : [];
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5" data-admin-writing-new-page={kind}>
      <BackLink fallbackHref={`/app/admin/writing?section=${kind === "prompt" ? "exam" : kind}`} label={t.back} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.sections[kind]}</p>
        <h1 className="font-display text-2xl text-ink-900">{t.newTitle}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.publishAfterSave}</p>
      </div>
      <WritingContentForm dict={dict} kind={kind} id={null} initial={DEFAULTS[kind]} sources={sources} />
    </div>
  );
}
