import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { listWritingLessons, writingContentCounts } from "@/lib/data/writing-workspace";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import type { WritingTab } from "@/lib/writing/tabs";
import { NotMigrated } from "./NotMigrated";

/** Lessons library (§37): real published lessons, real duration and completion only. */
export async function WritingLessonsTab({ dict, userId }: { dict: Dictionary; userId: string }) {
  const t = dict.writingWorkspace.lessons;
  const rows = await safeWritingQuery(() => listWritingLessons(userId));
  if (!rows.ok) return <NotMigrated dict={dict} />;
  if (rows.value.length === 0) return <EmptyTool title={t.emptyTitle} body={t.emptyBody} />;
  return (
    <ul className="motion-enter-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-writing-lessons>
      {rows.value.map((l) => (
        <li key={l.id}>
          <Link href={`/writing/lessons/${l.id}`} className="card motion-lift flex h-full flex-col gap-2 p-5" data-writing-lesson={l.id}>
            <span className="text-xs font-semibold uppercase tracking-wider text-signal-600 dark:text-signal-400">{t.category[l.category as keyof typeof t.category] ?? l.category}</span>
            <span className="font-display text-lg text-ink-900">{l.title}</span>
            {l.summary && <span className="text-sm text-ink-500">{l.summary}</span>}
            <span className="mt-auto flex gap-3 text-xs text-ink-500">
              {l.durationMinutes ? <span>{t.minutes.replace("{n}", String(l.durationMinutes))}</span> : null}
              {l.completedAt ? <span className="text-band-good">{t.completed}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function EmptyTool({ title, body }: { title: string; body: string }) {
  return (
    <div className="card flex flex-col gap-1 p-6" data-writing-empty>
      <p className="font-semibold text-ink-900">{title}</p>
      <p className="text-base text-ink-500">{body}</p>
    </div>
  );
}

/** Tools whose workflows need reviewed content: honest state from real counts. */
export async function WritingContentTab({ dict, tab }: { dict: Dictionary; tab: WritingTab }) {
  const t = dict.writingWorkspace.empty;
  const counts = await safeWritingQuery(() => writingContentCounts());
  if (!counts.ok) return <NotMigrated dict={dict} />;
  const copy = tab === "translation" ? t.translation : tab === "language-stealing" ? t.patterns : tab === "activation" ? t.activation : t.topicVocabulary;
  return <EmptyTool title={copy.title} body={copy.body} />;
}
