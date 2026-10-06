import Link from "next/link";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { LessonAuthoringDesk } from "@/components/lessons/LessonAuthoringDesk";
import { requireStaff } from "@/lib/auth/current-user";
import { isAdministrator } from "@/lib/auth/roles";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLessonsForStaff, listUnitOptions } from "@/lib/content/lesson-staff";

export const dynamic = "force-dynamic";

/**
 * The staff-safe LESSON AUTHORING DESK.
 *
 * Why it exists: lessons are the staff's teaching material for a subject, and the only
 * editor for them used to live inside `/app/admin/content/workspace`, which is gated by
 * `requireAdministrator()`. A TEACHER — who is staff, and who is exactly the person the
 * centre asks to write a lesson's description and teacher notes — was therefore shown an
 * "Author a lesson" link to a page they could not open.
 *
 * The fix is NOT to hand teachers the admin workspace (that would expose admissions,
 * user administration, migration controls and every other module's authoring). It is this
 * desk: one page, scoped to lessons, open to any staff role, which writes through the
 * SAME pipeline as the admin workspace — `POST /api/admin/content/drafts` →
 * `saveContentDraft` → the lesson author → `saveLessonStructure` + `pinVersion`, and
 * `POST /api/admin/content/versions/:id/publication` for the workflow.
 *
 * Publication authority is unchanged and is NOT decided here: `mayPublish` comes from
 * the permission layer, the service enforces it, and the desk only hides what the service
 * would refuse.
 */
export default async function LessonAuthoringPage() {
  const [user, locale] = await Promise.all([requireStaff(), getLocale()]);
  // Not staff: the same answer the other staff-only pages give — back to the dashboard,
  // never an empty shell that looks like a broken page.
  if (!user) redirect("/app");

  const dict = getDictionary(locale);
  const t = dict.listening.lessons.authoring;
  const [lessons, unitOptions] = await Promise.all([listLessonsForStaff("listening"), listUnitOptions()]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-route-usable="lesson-authoring">
      <div>
        <BackLink fallbackHref="/app/listening/lessons" label={dict.listening.lessons.backToList} data-lesson-authoring-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
      </div>

      {unitOptions.length === 0 ? (
        <Card data-lesson-authoring-no-structure>
          <h2 className="font-display text-lg text-ink-900">{t.noUnitsTitle}</h2>
          <p className="mt-1 text-sm text-ink-500">{t.noUnitsHint}</p>
        </Card>
      ) : (
        <LessonAuthoringDesk
          dict={dict}
          area="listening"
          lessons={lessons.map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            slug: lesson.slug,
            sourceRef: lesson.sourceRef,
            learningArea: lesson.learningArea,
            publicationState: lesson.publicationState,
            version: lesson.version,
          }))}
          units={unitOptions.map((unit) => ({ id: unit.id, label: unit.label }))}
          locale={locale}
          canPublish={mayPublishImportedContent(user.role)}
          isAdministrator={isAdministrator(user.role)}
        />
      )}

      <p className="text-xs text-ink-300">
        {t.footer}{" "}
        <Link className="underline" href="/app/listening/lessons">
          {dict.listening.lessons.title}
        </Link>
      </p>
    </div>
  );
}
