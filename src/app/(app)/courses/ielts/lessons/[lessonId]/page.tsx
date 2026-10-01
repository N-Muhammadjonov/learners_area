import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getLessonDetail } from "@/lib/data/roadmap";
import { isOpen, type LessonState } from "@/lib/services/lessons/state";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/ui/Badge";
import { LessonWorkspace } from "@/components/courses/LessonWorkspace";
import { VideoLessonStudio } from "@/components/courses/VideoLessonStudio";
import { getVideoLessonForLesson } from "@/lib/data/video-lessons";
import { isUuid } from "@/lib/validation/ids";
import { resolveDirectMedia } from "@/lib/services/video/direct";
import { OwnerMaterialBlocks } from "@/components/resources/OwnerMaterialBlocks";

export const dynamic = "force-dynamic";

/**
 * The lesson shell.
 *
 * A lesson has a state the server decides, the recording of the session when one
 * exists, and a private notes pad. A locked lesson shows why it cannot be opened
 * instead of offering controls that would fail.
 */
export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  // A route segment is user input: a non-uuid value is "no such lesson", not an
  // internal error from the database cast.
  if (!isUuid(lessonId)) notFound();
  const detail = await getLessonDetail(lessonId, user.id);
  if (!detail) notFound();
  const { lesson, unitTitle, state, notes, completedAt } = detail;
  const openable = isOpen(state as LessonState);

  // A lesson may carry a public video lesson. It is only shown when the lesson
  // itself is open, so the roadmap still decides what a student can reach.
  const video = openable ? await getVideoLessonForLesson(lesson.id, user.id) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Link href="/courses/ielts" className="btn-secondary " data-lesson-back>
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

      {video ? (
        <VideoLessonStudio
          directMedia={resolveDirectMedia(video.videoLesson.provider, video.videoLesson.videoId)}
          dict={dict}
          lessonId={lesson.id}
          videoLesson={{
            id: video.videoLesson.id,
            provider: video.videoLesson.provider,
            videoId: video.videoLesson.videoId,
            title: video.videoLesson.title,
            beforeYouWatch: video.videoLesson.beforeYouWatch,
            durationSeconds: video.videoLesson.durationSeconds,
            transcript: video.videoLesson.transcript ?? null,
            transcriptSource: video.videoLesson.transcriptSource,
            transcriptAttribution: video.videoLesson.transcriptAttribution,
            transcriptText: video.videoLesson.transcriptText ?? null,
            notes: video.videoLesson.notes ?? null,
          }}
          questions={video.questions.map((question) => ({
            id: question.id,
            stage: question.stage,
            prompt: question.prompt,
            atSeconds: question.atSeconds,
          }))}
          initialProgress={
            video.progress
              ? {
                  state: video.progress.state,
                  watchedSeconds: video.progress.watchedSeconds,
                  answers: video.progress.answers ?? {},
                  responseText: video.progress.responseText,
                  summaryText: video.progress.summaryText,
                }
              : null
          }
        />
      ) : null}

      {/* Material an administrator attached to this lesson. A locked lesson shows
          none of it: the roadmap decides what is reachable, and a draft's files
          must not leak through a URL the student cannot otherwise open. */}
      <OwnerMaterialBlocks ownerType="lesson" ownerId={lesson.id} ownerVisible={openable} />

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
