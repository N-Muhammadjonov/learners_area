import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { academicListeningTest } from "@/lib/data/listening-academic";

export const dynamic = "force-dynamic";

/**
 * The Academic Listening TEST HUB.
 *
 * Not a fixed grid of ten cards: the activities come from the registry
 * (`src/lib/listening/activities.ts`) fed by this test's authored facts and this learner's
 * real state, so a test with matching questions shows Matching, a test without a transcript
 * shows no Script Completion, and "Review" or "Retry Weak Areas" appear only when there is
 * something to review or retry. Nothing is disabled to look complete, and MCQ is MCQ —
 * Matching is never filed under it.
 *
 * The routes themselves are the existing ones: `/app/listening/tests/:id/1` is the focus
 * exam (its own timer, audio, navigation and autosave), `.../2` is review, `.../3`, `.../4`,
 * `.../5` are the study activities, and `mcq` / `matching` / `completion` / `retry` are the
 * graded practice screens that already exist. The hub only points at them.
 */
export default async function AcademicListeningTestPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.listening.academic;
  const test = await academicListeningTest(testId, user);
  if (!test) notFound();

  return (
    <div
      className="listening-workspace listening-hub mx-auto flex max-w-5xl flex-col gap-6"
      data-route-usable="listening-academic-test"
      data-listening-academic-test={test.testId}
    >
      <div>
        <BackLink fallbackHref="/app/listening/academic" label={t.hubBack} data-listening-academic-test-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">{test.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.hubSubtitle}</p>
        <p className="mt-1 text-xs text-ink-300">
          <span>{t.parts.replace("{n}", String(test.parts))}</span>
          {" · "}
          <span>{t.questions.replace("{n}", String(test.questions))}</span>
          {test.minutes !== null && (
            <>
              {" · "}
              <span>
                {test.minutes} {t.minutes}
              </span>
            </>
          )}
          {" · "}
          <span data-listening-academic-transcript>{test.transcriptAvailable ? t.transcriptYes : t.transcriptNo}</span>
        </p>
        <p className="mt-1 text-sm text-ink-700" data-listening-academic-progress>
          {t.progressLabel.replace("{done}", String(test.progress.completed)).replace("{total}", String(test.progress.total))}
          {test.progress.exam && (
            <>
              {" · "}
              <span data-listening-academic-exam>
                {t.examScore
                  .replace("{score}", String(test.progress.exam.score ?? "—"))
                  .replace("{total}", String(test.progress.exam.total ?? "—"))}
              </span>
            </>
          )}
        </p>
        {test.draft && (
          <p className="mt-2 text-xs text-amber-700" data-listening-academic-draft>
            {t.draftNotice}
          </p>
        )}
      </div>

      {/* The SAME purpose grid the app's existing test hub uses, so the academic hub is the
          familiar Listening hub — not a second design — and the exam card spans the row. */}
      <div className="listening-purpose-grid" data-listening-academic-activities>
        {test.activities.map((activity) => (
          <Card
            key={activity.id}
            className={activity.id === "exam" ? "listening-exam-purpose" : undefined}
            data-listening-academic-activity={activity.id}
          >
            <div className="flex h-full flex-col gap-2">
              <h2 className="font-display text-lg text-ink-900">{t.activity[activity.id]}</h2>
              <p className="text-sm text-ink-500">{t.activity[`${activity.id}Hint`]}</p>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-2 text-xs text-ink-300">
                {activity.complete && <span data-listening-academic-complete>{t.complete}</span>}
                {activity.latest && (
                  <span data-listening-academic-latest>
                    {t.latestScore
                      .replace("{score}", String(activity.latest.score ?? "—"))
                      .replace("{total}", String(activity.latest.total ?? "—"))}
                  </span>
                )}
              </div>
              <Link
                className="btn-secondary mt-2 self-start"
                href={`/app/listening/tests/${test.testId}/${activity.path}`}
                data-listening-academic-run={activity.id}
              >
                {t.open}
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
