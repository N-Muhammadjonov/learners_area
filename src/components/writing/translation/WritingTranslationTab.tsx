import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { listMyTranslationAttempts, listTranslationSets } from "@/lib/services/writing/translation";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { TranslationStartForm } from "./TranslationStartForm";

/** Translation home: setup + the learner's recent attempts. */
export async function WritingTranslationTab({ dict, userId }: { dict: Dictionary; userId: string }) {
  const t = dict.writingWorkspace.translation;
  const data = await safeWritingQuery(async () => {
    const [sets, recent] = await Promise.all([listTranslationSets(), listMyTranslationAttempts(userId)]);
    return { sets, recent };
  });
  if (!data.ok) return <NotMigrated dict={dict} />;
  const { sets, recent } = data.value;
  return (
    <section className="flex flex-col gap-5" data-writing-translation>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
      </div>
      {sets.length === 0 ? <p role="status" className="rounded-md border border-ink-100 bg-paper-sunken p-4 text-base text-ink-700" data-translation-no-sets>{t.noSets}</p> : <TranslationStartForm dict={dict} sets={sets} />}
      {recent.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-900">{t.recent}</h3>
          <ul className="flex flex-col gap-2">
            {recent.map((a) => (
              <li key={a.id}>
                <Link href={`/writing/translation/${a.id}`} className="card flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink-900">{a.title}</span>
                  <span className="text-ink-500">{a.status === "completed" ? `${t.completed}${a.overall != null ? ` · ${a.overall.toFixed(1)}` : ""}` : t.inProgress}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
