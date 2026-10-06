import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { LessonNotesPanel } from "@/components/notes/LessonNotesPanel";
import { ListeningLessonBody } from "@/components/listening/ListeningLessonBody";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { loadListeningLesson } from "@/lib/listening/lessons";
import { isUuid } from "@/lib/validation/ids";
import { resolveDirectMedia } from "@/lib/services/video/direct";
import { publicBaseUrl } from "@/lib/config/site";

export const dynamic = "force-dynamic";

/**
 * One listening lesson.
 *
 * The body comes FIRST (the authored blocks: audio/video/text/quizzes/references —
 * the main content), and then the three learner-facing controls, exactly as approved:
 * **Description**, **Teacher notes**, **Xulosangiz**. The tab is part of the URL
 * (`?tab=…`), so a reload keeps the section the learner was reading; the tab bar is
 * plain links, so it works without client JavaScript and cannot drift out of sync
 * with the rendered panel.
 *
 * Every panel reads a canonical source and says so when a source is empty — there are
 * no placeholder paragraphs anywhere on this page:
 *   • Description  → `lessons.summary` + the attached media item's authored focus text;
 *   • Teacher notes→ the centre's authored notes on the attached media item;
 *   • Xulosangiz   → the learner's own private note (`lesson_notes`, migration 0049).
 *
 * A lesson that is not live, does not exist, or is not a listening lesson is a 404 —
 * the same answer for all three, so the page cannot confirm content the learner may
 * not open.
 */
const TABS = ["description", "teacher-notes", "xulosangiz"] as const;
type Tab = (typeof TABS)[number];

function resolveTab(requested: string | undefined): Tab {
  return (TABS as readonly string[]).includes(requested ?? "") ? (requested as Tab) : "description";
}

export default async function ListeningLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ lessonId }, query, user, locale] = await Promise.all([
    params,
    searchParams,
    requireActiveUser(),
    getLocale(),
  ]);
  if (!user) return null;
  if (!isUuid(lessonId)) notFound();

  const detail = await loadListeningLesson(lessonId, user.id);
  if (!detail) notFound();

  const dict = getDictionary(locale);
  const t = dict.listening.lessons;
  const tab = resolveTab(query.tab);
  const direct = detail.media ? resolveDirectMedia(detail.media.provider, detail.media.videoId) : null;
  const mediaUrl = direct?.src ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-route-usable="listening-lesson">
      <div>
        <BackLink fallbackHref="/app/listening/lessons" label={t.backToList} data-listening-lesson-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">{detail.lesson.title}</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-ink-300">{t.source[detail.source]}</p>
      </div>

      {/* MAIN CONTENT FIRST: the lesson itself. */}
      <Card data-listening-lesson-body-card>
        <h2 className="mb-3 font-display text-lg text-ink-900">{t.bodyTitle}</h2>

        {detail.media && detail.media.mediaKind === "audio" && mediaUrl && (
          <figure className="mb-4 flex flex-col gap-2">
            <audio controls preload="none" className="w-full" src={mediaUrl} data-listening-lesson-audio />
            <figcaption className="text-xs text-ink-300">
              {t.mediaKind.audio}
              {detail.media.durationSeconds ? ` · ${Math.round(detail.media.durationSeconds / 60)} ${t.minutes}` : ""}
            </figcaption>
          </figure>
        )}
        {detail.media && detail.media.mediaKind === "video" && mediaUrl && (
          <video controls preload="none" className="mb-4 w-full rounded-md bg-ink-950" src={mediaUrl} data-listening-lesson-video />
        )}
        {detail.media && !mediaUrl && (
          // A provider-hosted item is played by the canonical media studio, not by a
          // second player invented here.
          <p className="mb-4 text-sm text-ink-500" data-listening-lesson-media-elsewhere>
            <Link className="underline" href={`/app/video-lessons/${detail.media.id}`} data-listening-lesson-media-link>
              {detail.media.title}
            </Link>
          </p>
        )}

        <ListeningLessonBody dict={dict} blocks={detail.blocks} />
      </Card>

      {/* Then exactly the three approved controls. */}
      <div className="flex flex-wrap gap-2" role="tablist" data-listening-lesson-tabs>
        {TABS.map((candidate) => (
          <Link
            key={candidate}
            href={`/app/listening/lessons/${detail.lesson.id}?tab=${candidate}`}
            role="tab"
            aria-selected={tab === candidate}
            className={tab === candidate ? "btn-primary" : "btn-secondary"}
            data-listening-lesson-tab={candidate}
            data-active={tab === candidate ? "true" : "false"}
          >
            {t.tabs[candidate === "teacher-notes" ? "teacherNotes" : candidate]}
          </Link>
        ))}
      </div>

      <Card data-listening-lesson-panel={tab}>
        {tab === "description" && (
          <div className="flex flex-col gap-2">
            {detail.lesson.summary ? (
              <p className="text-sm leading-relaxed text-ink-700" data-listening-description>
                {detail.lesson.summary}
              </p>
            ) : (
              <p className="text-sm text-ink-500" data-listening-description-empty>
                {t.descriptionEmpty}
              </p>
            )}
            {detail.media?.focus && (
              <p className="text-sm leading-relaxed text-ink-700" data-listening-description-focus>
                {detail.media.focus}
              </p>
            )}
            {detail.lesson.estimatedMinutes ? (
              <p className="text-xs text-ink-300">{t.descriptionMinutes.replace("{n}", String(detail.lesson.estimatedMinutes))}</p>
            ) : null}
          </div>
        )}

        {tab === "teacher-notes" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-300">{t.teacherNotesHint}</p>
            {detail.media?.notes ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700" data-listening-teacher-notes>
                {detail.media.notes}
              </p>
            ) : (
              <p className="text-sm text-ink-500" data-listening-teacher-notes-empty>
                {t.teacherNotesEmpty}
              </p>
            )}
          </div>
        )}

        {tab === "xulosangiz" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-300">{t.xulosangizHint}</p>
            {/* The learner's private note: the same panel (and the same 0049 store) the
                course lessons use, keyed by this lesson's stable id. */}
            <LessonNotesPanel dict={dict} lessonId={detail.lesson.id} initialNotes={detail.note} />
          </div>
        )}
      </Card>
    </div>
  );
}
