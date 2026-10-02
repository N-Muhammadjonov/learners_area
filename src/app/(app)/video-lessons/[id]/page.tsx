import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getStandaloneVideoLesson } from "@/lib/data/video-lessons";
import { isUuid } from "@/lib/validation/ids";
import { resolveDirectMedia } from "@/lib/services/video/direct";
import { headers } from "next/headers";
import { publicBaseUrl } from "@/lib/config/site";
import { resolveEmbedOrigin } from "@/lib/services/video/embed-origin";
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
  const [user, locale, { id }, requestHeaders] = await Promise.all([requireActiveUser(), getLocale(), params, headers()]);
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const data = await getStandaloneVideoLesson(id, user.id);
  if (!data) notFound();
  const dict = getDictionary(locale);
  const { videoLesson, progress } = data;
  const minutes = videoLesson.durationSeconds && videoLesson.durationSeconds > 0 ? Math.max(1, Math.round(videoLesson.durationSeconds / 60)) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4" data-route-usable="video-lesson" data-video-standalone={videoLesson.id}>
      <BackLink fallbackHref="/video-lessons" label={dict.videoLessons.title} data-video-back />
      <header className="flex flex-col gap-1" data-video-detail-header>
        <h1 className="font-display text-2xl text-ink-900">{videoLesson.title}</h1>
        {minutes !== null ? (
          <p className="text-sm text-ink-500" data-video-detail-meta>{dict.videoLessons.minutes.replace("{n}", String(minutes))}</p>
        ) : null}
      </header>
      <VideoLessonStudio
        mode="standalone"
        embedOrigin={resolveEmbedOrigin(requestHeaders, publicBaseUrl)}
          directMedia={resolveDirectMedia(videoLesson.provider, videoLesson.videoId)}
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
        questions={[]}
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
