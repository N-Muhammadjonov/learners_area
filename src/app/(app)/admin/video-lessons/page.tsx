import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listAllVideoLessons, listLessonsWithoutVideo } from "@/lib/data/video-lessons";
import { NewVideoLessonForm } from "@/components/admin/NewVideoLessonForm";
import { Card } from "@/components/ui/Card";
import { PublicationControl } from "@/components/admin/PublicationControl";

export const dynamic = "force-dynamic";

/**
 * The CMS surface for public video lessons.
 *
 * Administrators and owners author a lesson here — no source-code edit, no raw embed HTML, and the
 * transcript has to declare where it came from. The list below shows what has
 * already been authored so a teacher can see the state of the course.
 */
export default async function AdminVideoLessonsPage() {
  // Authorization is a database read, not a menu decision.
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());

  const [lessons, authored] = await Promise.all([listLessonsWithoutVideo(), listAllVideoLessons()]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.videoLessonAdmin.title}</h1>

      <Card>
        <NewVideoLessonForm dict={dict} lessons={lessons.map((l) => ({ id: l.id, title: l.title }))} />
      </Card>

      <Card data-video-admin-list>
        <h2 className="mb-2 font-display text-lg text-ink-900">{dict.videoLessonAdmin.existing}</h2>
        {authored.length === 0 ? (
          <p className="text-sm text-ink-500">{dict.videoLessonAdmin.none}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {authored.map(({ videoLesson, lesson }) => (
              <li key={videoLesson.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200/60 pb-2 last:border-0">
                <span className="text-ink-800">{videoLesson.title}</span>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs text-ink-500">
                    {lesson.title} · {videoLesson.provider} · {videoLesson.transcriptSource ?? dict.videoLessonAdmin.transcriptSourceNone}
                  </span>
                  <PublicationControl
                    type="video"
                    id={videoLesson.id}
                    state={videoLesson.publicationState}
                    publishAt={videoLesson.publishAt ? videoLesson.publishAt.toISOString() : null}
                    dict={dict}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
