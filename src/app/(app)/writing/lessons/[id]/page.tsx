import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { getWritingLesson } from "@/lib/data/writing-workspace";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { BackLink } from "@/components/ui/BackLink";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { LessonCompleteButton } from "@/components/writing/workspace/LessonCompleteButton";

export const dynamic = "force-dynamic";

export default async function WritingLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, locale] = await Promise.all([params, requireActiveUser(), getLocale()]);
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const dict = getDictionary(locale);
  const t = dict.writingWorkspace.lessons;
  const row = await safeWritingQuery(() => getWritingLesson(id, user.id));
  if (!row.ok) return <div className="mx-auto max-w-3xl"><NotMigrated dict={dict} /></div>;
  if (!row.value) notFound();
  const { lesson, completedAt } = row.value;
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5" data-route-usable="writing-lesson">
      <BackLink fallbackHref="/writing?tab=lessons" label={dict.common.back} />
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-signal-600 dark:text-signal-400">{t.category[lesson.category as keyof typeof t.category] ?? lesson.category}{lesson.durationMinutes ? ` · ${t.minutes.replace("{n}", String(lesson.durationMinutes))}` : ""}</p>
        <h1 className="font-display text-2xl text-ink-900">{lesson.title}</h1>
        {lesson.summary && <p className="mt-1 text-base text-ink-500">{lesson.summary}</p>}
      </header>
      <div className="academic-text flex flex-col gap-4 text-base text-ink-900" data-writing-lesson-body>
        {lesson.body.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line">{para}</p>)}
      </div>
      <LessonCompleteButton id={lesson.id} done={Boolean(completedAt)} label={t.markDone} doneLabel={t.completed} />
    </article>
  );
}
