import Link from "next/link";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { db } from "@/db/client";
import {
  grammarTopics,
  listeningTests,
  readingPassages,
  videoLessons,
  writingPrompts,
} from "@/db/schema";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { isLive } from "@/lib/services/cms/publication";

export const metadata = { title: "Content" };

/**
 * /admin/content — the content library index.
 *
 * The Management sidebar pointed at this path before it existed, which is how the
 * owner's own menu offered a 404. It lists every publishable content kind with a
 * truthful count — how many are live for students right now, and how many are not
 * — and links to the surface where each one is written.
 *
 * The counts are counted, never typed: `isLive()` is the same rule the student
 * queries use, so this page cannot claim a passage is visible when it is not.
 */
export default async function AdminContentPage() {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());

  const [readingRows, listeningRows, writingRows, grammarRows, videoRows] = await Promise.all([
    db
      .select({ state: readingPassages.publicationState, publishAt: readingPassages.publishAt })
      .from(readingPassages),
    db
      .select({ state: listeningTests.publicationState, publishAt: listeningTests.publishAt })
      .from(listeningTests),
    db
      .select({ state: writingPrompts.publicationState, publishAt: writingPrompts.publishAt })
      .from(writingPrompts),
    db.select({ value: count() }).from(grammarTopics),
    db
      .select({ state: videoLessons.publicationState, publishAt: videoLessons.publishAt })
      .from(videoLessons),
  ]);

  const published = (rows: { state: typeof readingRows[number]["state"]; publishAt: Date | null }[]) =>
    rows.filter((row) => isLive({ publicationState: row.state, publishAt: row.publishAt })).length;

  const sections = [
    {
      key: "reading",
      title: dict.admin.readingTitle,
      href: "/admin/reading",
      materialsType: "reading" as const,
      total: readingRows.length,
      live: published(readingRows),
    },
    {
      key: "listening",
      title: dict.admin.listeningTitle,
      href: "/admin/listening",
      materialsType: "listening" as const,
      total: listeningRows.length,
      live: published(listeningRows),
    },
    {
      key: "writing",
      title: dict.admin.promptsTitle,
      href: "/admin/writing-prompts",
      materialsType: "writing" as const,
      total: writingRows.length,
      live: published(writingRows),
    },
    {
      key: "grammar",
      title: dict.admin.grammarTitle,
      href: "/admin/grammar",
      materialsType: "grammar" as const,
      // Grammar topics carry no publication state, so "live" and "total" are the
      // same number here rather than a second workflow invented for the count.
      total: grammarRows[0]?.value ?? 0,
      live: grammarRows[0]?.value ?? 0,
    },
    {
      key: "video",
      title: dict.admin.videoLessonTitle,
      href: "/admin/video-lessons",
      total: videoRows.length,
      live: published(videoRows),
    },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-content-library>
      <h1 className="font-display text-2xl text-ink-900">{dict.nav.contentLibrary}</h1>
      <p className="body-text">{dict.admin.contentLibraryHint}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.key} className="flex flex-col gap-2">
            <h2 className="card-title">{section.title}</h2>
            <p className="meta-text">
              {dict.admin.contentLibraryLive.replace("{n}", String(section.live))}
              {" · "}
              {dict.admin.contentLibraryDraft.replace("{n}", String(section.total - section.live))}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={section.href} className="btn-secondary" data-content-section={section.key}>
                {dict.admin.contentLibraryOpen}
              </Link>
              {/* The universal composer lives on its own surface, one entry per
                  content kind, so a lesson or a live class can be given material
                  without a bespoke editor on eight different pages. */}
              {section.materialsType && (
                <Link
                  href={`/admin/materials/${section.materialsType}`}
                  className="btn-secondary"
                  data-content-materials={section.materialsType}
                >
                  {dict.admin.materialsTitle}
                </Link>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
