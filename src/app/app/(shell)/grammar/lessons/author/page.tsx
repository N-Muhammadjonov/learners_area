import Link from "next/link";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { LessonAuthoringDesk } from "@/components/lessons/LessonAuthoringDesk";
import { requireStaff } from "@/lib/auth/current-user";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { mayAuthorContent } from "@/lib/content/authoring-access";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLessonsForStaff, listUnitOptions } from "@/lib/content/lesson-staff";

export const dynamic = "force-dynamic";

export default async function LessonAuthoringPage() {
  const [user, locale] = await Promise.all([requireStaff(), getLocale()]);
  // Not staff: the same answer the other staff-only pages give — back to the dashboard,
  // never an empty shell that looks like a broken page.
  if (!user) redirect("/app");

  const dict = getDictionary(locale);
  const t = dict.listening.lessons.authoring;
  // The desk offers lesson authoring only to a role the SAME capability grants it to —
  // the page is a control panel, not an authority, and asking the capability means the
  // panel can never be shown to somebody whose saves the API would refuse.
  if (!mayAuthorContent(user.role, "lesson", "lesson")) redirect("/app");
  const [lessons, unitOptions] = await Promise.all([listLessonsForStaff("grammar"), listUnitOptions()]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-route-usable="lesson-authoring">
      <div>
        <BackLink fallbackHref="/app/grammar/lessons" label={dict.grammar.lessonBack} data-lesson-authoring-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
      </div>

      {unitOptions.options.length === 0 ? (
        <Card data-lesson-authoring-no-structure>
          <h2 className="font-display text-lg text-ink-900">{t.noUnitsTitle}</h2>
          <p className="mt-1 text-sm text-ink-500">{t.noUnitsHint}</p>
        </Card>
      ) : (
        <LessonAuthoringDesk
          dict={dict}
          area="grammar"
          lessons={lessons.map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            slug: lesson.slug,
            sourceRef: lesson.sourceRef,
            learningArea: lesson.learningArea,
            publicationState: lesson.publicationState,
            // Which revision the author would be editing, and which one students are
            // reading — stated in the list so the distinction is visible before opening.
            draft: lesson.draft,
            published: lesson.published,
          }))}
          units={unitOptions.options.map((unit) => ({ id: unit.id, label: unit.label }))}
          locale={locale}
          canPublish={mayPublishImportedContent(user.role)}
        />
      )}

      <p className="text-xs text-ink-300">
        {t.footer}{" "}
        <Link className="underline" href="/app/grammar/lessons">
          {dict.grammar.lessonsTitle}
        </Link>
      </p>
    </div>
  );
}
