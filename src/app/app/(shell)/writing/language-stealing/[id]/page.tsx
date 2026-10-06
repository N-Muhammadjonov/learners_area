import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { getStealing } from "@/lib/services/writing/stealing";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { BackLink } from "@/components/ui/BackLink";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { StealingFlow } from "@/components/writing/stealing/StealingFlow";

export const dynamic = "force-dynamic";

export default async function LanguageStealingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  const { id } = await params;
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const dict = getDictionary(locale);
  const t = dict.writingWorkspace.stealing;
  const loaded = await safeWritingQuery(() => getStealing(user.id, id));
  if (!loaded.ok) return <div className="mx-auto max-w-6xl"><NotMigrated dict={dict} /></div>;
  const view = loaded.value;
  if (!view) notFound();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-route-usable="writing-language-stealing">
      <BackLink fallbackHref="/app/writing?tab=language-stealing" label={t.back} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow} · {view.source.taskType === "task1" ? "Task 1" : "Task 2"} · Band {view.source.targetBand}</p>
        <h1 className="font-display text-2xl text-ink-900">{view.source.title}</h1>
        <p className="mt-1 text-base text-ink-500">{view.source.topic}</p>
      </div>
      <StealingFlow dict={dict} initial={view} locale={locale} />
    </div>
  );
}
