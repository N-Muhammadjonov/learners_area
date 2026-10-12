import { LessonWorkspace } from "@/components/courses/LessonWorkspace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { LessonNotesPanel } from "@/components/notes/LessonNotesPanel";
import { ListeningLessonBody } from "@/components/listening/ListeningLessonBody";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { loadLessonLibraryDetail } from "@/lib/content/lesson-library";
import { isUuid } from "@/lib/validation/ids";
import { resolveDirectMedia } from "@/lib/services/video/direct";

export const dynamic = "force-dynamic";

const TABS = ["description", "teacher-notes", "xulosangiz"] as const;
type Tab = (typeof TABS)[number];

function resolveTab(requested: string | undefined): Tab {
  return (TABS as readonly string[]).includes(requested ?? "") ? (requested as Tab) : "description";
}

export default async function GrammarLessonPage({
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

  const detail = await loadLessonLibraryDetail(lessonId, user.id, "grammar");
  if (!detail) notFound();

  const dict = getDictionary(locale);
  const t = { ...dict.listening.lessons, areaLabel: dict.grammar.lessonsTitle, backToList: dict.grammar.lessonBack };
  const tab = resolveTab(query.tab);
  const direct = detail.media ? resolveDirectMedia(detail.media.provider, detail.media.videoId) : null;
  const mediaUrl = direct?.src ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-route-usable="grammar-lesson">
      <div>
        <BackLink fallbackHref="/app/grammar/lessons" label={t.backToList} data-grammar-lesson-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">{detail.lesson.title}</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-ink-300">{t.areaLabel}</p>
      </div>

      {/* MAIN CONTENT FIRST: the lesson itself. */}
      <Card data-grammar-lesson-body-card>
        <h2 className="mb-3 font-display text-lg text-ink-900">{t.bodyTitle}</h2>

        {detail.media && detail.media.mediaKind === "audio" && mediaUrl && (
          <figure className="mb-4 flex flex-col gap-2">
            <audio controls preload="none" className="w-full" src={mediaUrl} data-grammar-lesson-audio />
            <figcaption className="text-xs text-ink-300">
              {t.mediaKind.audio}
              {detail.media.durationSeconds ? ` · ${Math.round(detail.media.durationSeconds / 60)} ${t.minutes}` : ""}
            </figcaption>
          </figure>
        )}
        {detail.media && detail.media.mediaKind === "video" && mediaUrl && (
          <video controls preload="none" className="mb-4 w-full rounded-md bg-ink-950" src={mediaUrl} data-grammar-lesson-video />
        )}
        {detail.media && !mediaUrl && (
          // A provider-hosted item is played by the canonical media studio, not by a
          // second player invented here.
          <p className="mb-4 text-sm text-ink-500" data-grammar-lesson-media-elsewhere>
            <Link className="underline" href={`/app/video-lessons/${detail.media.id}`} data-grammar-lesson-media-link>
              {detail.media.title}
            </Link>
          </p>
        )}

        <ListeningLessonBody dict={dict} blocks={detail.blocks} highlightScope={`${user.id}:${detail.lesson.id}`} />
      </Card>

      <LessonWorkspace dict={dict} lessonId={detail.lesson.id} state={detail.progress.state} completedAt={detail.progress.completedAt?.toISOString() ?? null} initialNotes="" showNotes={false} />

      {/* Then exactly the three approved controls. */}
      <div className="flex flex-wrap gap-2" role="tablist" data-grammar-lesson-tabs>
        {TABS.map((candidate) => (
          <Link
            key={candidate}
            href={`/app/grammar/lessons/${detail.lesson.id}?tab=${candidate}`}
            role="tab"
            aria-selected={tab === candidate}
            className={tab === candidate ? "btn-primary" : "btn-secondary"}
            data-grammar-lesson-tab={candidate}
            data-active={tab === candidate ? "true" : "false"}
          >
            {t.tabs[candidate === "teacher-notes" ? "teacherNotes" : candidate]}
          </Link>
        ))}
      </div>

      <Card data-grammar-lesson-panel={tab}>
        {tab === "description" && (
          <div className="flex flex-col gap-2">
            {detail.lesson.summary ? (
              <p className="text-sm leading-relaxed text-ink-700" data-grammar-description>
                {detail.lesson.summary}
              </p>
            ) : (
              <p className="text-sm text-ink-500" data-grammar-description-empty>
                {t.descriptionEmpty}
              </p>
            )}
            {detail.media?.focus && (
              <p className="text-sm leading-relaxed text-ink-700" data-grammar-description-focus>
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
            <p className="text-xs text-ink-300">{detail.teacherNotesSource === "media" ? t.teacherNotesLegacyHint : t.teacherNotesHint}</p>
            {detail.teacherNotes ? (
              <p
                className="whitespace-pre-line text-sm leading-relaxed text-ink-700"
                data-grammar-teacher-notes
                data-teacher-notes-source={detail.teacherNotesSource ?? "none"}
              >
                {detail.teacherNotes}
              </p>
            ) : (
              <p className="text-sm text-ink-500" data-grammar-teacher-notes-empty>
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
