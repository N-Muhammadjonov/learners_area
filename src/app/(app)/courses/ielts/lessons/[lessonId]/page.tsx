import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getLessonDetail } from "@/lib/data/roadmap";
import { isOpen, type LessonState } from "@/lib/services/lessons/state";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/ui/Badge";
import { LessonWorkspace } from "@/components/courses/LessonWorkspace";

export const dynamic = "force-dynamic";

/**
 * The lesson shell.
 *
 * A lesson has a state the server decides, the recording of the session when one
 * exists, and a private notes pad. A locked lesson shows why it cannot be opened
 * instead of offering controls that would fail.
 */
export default async function LessonPage({ params }: { params: { lessonId: string } }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());

  const detail = await getLessonDetail(params.lessonId, user.id);
  if (!detail) notFound();
  const { lesson, unitTitle, state, notes, completedAt } = detail;
  const openable = isOpen(state as LessonState);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/courses/ielts" className="text-sm text-signal-600 hover:underline" data-lesson-back>
          ← {dict.courseRoadmap.back}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-2xl text-ink-900">{lesson.title}</h1>
          <span data-lesson-state={state}>
            <StateBadge state={state} />
          </span>
        </div>
        {unitTitle && <p className="text-sm text-ink-300">{unitTitle}</p>}
        {lesson.summary && <p className="mt-1 text-sm text-ink-500">{lesson.summary}</p>}
      </div>

      {lesson.recordingUrl && (
        <Card data-lesson-recording>
          <h2 className="mb-2 font-display text-lg text-ink-900">{dict.courseRoadmap.recording}</h2>
          <video controls src={lesson.recordingUrl} className="w-full rounded-md bg-ink-950" />
        </Card>
      )}

      {!openable ? (
        <Card data-lesson-closed>
          <p className="text-sm text-ink-500">{dict.courseRoadmap.notOpenYet}</p>
        </Card>
      ) : (
        <LessonWorkspace
          dict={dict}
          lessonId={lesson.id}
          state={state}
          initialNotes={notes ?? ""}
          completedAt={completedAt ? completedAt.toISOString() : null}
        />
      )}
    </div>
  );
}
