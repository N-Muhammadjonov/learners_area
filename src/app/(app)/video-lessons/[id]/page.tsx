import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getStandaloneVideoLesson } from "@/lib/data/video-lessons";
import { isUuid } from "@/lib/validation/ids";
import { VideoLessonStudio } from "@/components/courses/VideoLessonStudio";

export const dynamic = "force-dynamic";

/**
 * /video-lessons/:id — a standalone TED / Podcast item on its own native URL.
 *
 * No roadmap prerequisite: the item is visible when it is live (published, or
 * scheduled and due). Drafts, archived items and course-linked videos are not
 * served here — the latter stay behind their lesson's access on the course route.
 */
export default async function StandaloneVideoLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, locale, { id }] = await Promise.all([requireActiveUser(), getLocale(), params]);
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const data = await getStandaloneVideoLesson(id, user.id);
  if (!data) notFound();
  const dict = getDictionary(locale);
  const { videoLesson, questions, progress } = data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-route-usable="video-lesson" data-video-standalone={videoLesson.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl text-ink-900">{videoLesson.title}</h1>
        <Link href="/video-lessons" className="btn-secondary">{dict.videoLessons.title}</Link>
      </div>
      <VideoLessonStudio
        dict={dict}
        lessonId={videoLesson.id}
        videoLesson={{
          id: videoLesson.id,
          provider: videoLesson.provider,
          videoId: videoLesson.videoId,
          title: videoLesson.title,
          beforeYouWatch: videoLesson.beforeYouWatch,
          durationSeconds: videoLesson.durationSeconds,
          transcript: videoLesson.transcript ?? null,
          transcriptSource: videoLesson.transcriptSource,
          transcriptAttribution: videoLesson.transcriptAttribution,
          transcriptText: videoLesson.transcriptText ?? null,
          notes: videoLesson.notes ?? null,
        }}
        questions={questions.map((question) => ({
          id: question.id,
          stage: question.stage,
          prompt: question.prompt,
          atSeconds: question.atSeconds,
        }))}
        initialProgress={
          progress
            ? {
                state: progress.state,
                watchedSeconds: progress.watchedSeconds,
                answers: progress.answers ?? {},
                responseText: progress.responseText,
                summaryText: progress.summaryText,
              }
            : null
        }
      />
    </div>
  );
}
