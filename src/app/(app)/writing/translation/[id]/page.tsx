import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { getTranslationView } from "@/lib/services/writing/translation";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { BackLink } from "@/components/ui/BackLink";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { TranslationRunner } from "@/components/writing/translation/TranslationRunner";
import { TranslationResultView } from "@/components/writing/translation/TranslationResultView";

export const dynamic = "force-dynamic";

export default async function TranslationAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  const { id } = await params;
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const dict = getDictionary(locale);
  const t = dict.writingWorkspace.translation;
  const loaded = await safeWritingQuery(() => getTranslationView(user.id, id));
  if (!loaded.ok) return <div className="mx-auto max-w-6xl"><NotMigrated dict={dict} /></div>;
  const view = loaded.value;
  if (!view) notFound();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-route-usable="writing-translation">
      <BackLink fallbackHref="/writing?tab=translation" label={t.back} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.types[view.set.questionType]} · {t.band} {view.set.targetBand}</p>
        <h1 className="font-display text-2xl text-ink-900">{view.set.title}</h1>
        <p className="mt-1 max-w-3xl whitespace-pre-line text-base text-ink-700">{view.set.prompt}</p>
      </div>
      {view.status === "completed" ? (
        <>
          <h2 className="font-display text-xl text-ink-900">{t.resultTitle}</h2>
          <TranslationResultView dict={dict} view={view} />
          <Link href="/writing?tab=translation" className="btn-primary min-h-11 self-start">{t.newAttempt}</Link>
        </>
      ) : (
        <TranslationRunner dict={dict} initial={view} aiReady={writingAiReady()} />
      )}
    </div>
  );
}
