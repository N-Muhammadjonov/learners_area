import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { mcqProgramDays } from "@/lib/data/listening-mcq";
import { MCQ_DAY_QUESTION_COUNT } from "@/lib/listening/mcq-program";

export const dynamic = "force-dynamic";

/**
 * LISTENING MCQ — the programme home: DAY cards, and nothing else.
 *
 * The owner's fourth destination is a training programme, not a test library. Each card is one
 * authored DAY holding exactly five multiple-choice questions, and it states only what is true: the
 * day number the centre authored, how many questions it really holds, and THIS learner's status.
 * A day that has not been published is not rendered as an empty card, and the programme's target of
 * thirty days is never presented as available content.
 *
 * The chrome is English and Uzbek; the questions themselves are the owner's material and are never
 * translated or generated.
 */
export default async function ListeningMcqPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;

  const dict = getDictionary(locale);
  const t = dict.listening.mcqProgram;
  const staff = isStaff(user.role);
  const { days, progress } = await mcqProgramDays(user, { includeDrafts: staff });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening-mcq">
      <div>
        <BackLink fallbackHref="/app/listening" label={dict.listening.practiceTitle} data-listening-mcq-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">🎯 {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
        {/* Truthful arithmetic: published days first, the authored target stated separately. */}
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
          <span data-listening-mcq-days-published={progress.daysPublished}>
            {t.daysPublished.replace("{published}", String(progress.daysPublished)).replace("{target}", String(progress.dayTarget))}
          </span>
          {progress.daysPublished > 0 && (
            <span data-listening-mcq-days-completed={progress.daysCompleted}>
              {t.daysCompleted
                .replace("{done}", String(progress.daysCompleted))
                .replace("{available}", String(progress.daysPublished))}
            </span>
          )}
        </p>
      </div>

      {days.length === 0 ? (
        <section className="card space-y-2 p-6" data-listening-mcq-empty>
          <h2 className="font-display text-lg text-ink-900">{t.emptyTitle}</h2>
          <p className="text-sm text-ink-500">{t.emptyHint}</p>
          {/* A learner never gets a dead administration link; staff are told where days come from. */}
          {staff && <p className="text-sm text-ink-300" data-listening-mcq-staff-hint>{t.staffHint}</p>}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-listening-mcq-grid>
          {days.map((card) => (
            <section key={card.testId} className="card flex flex-col gap-3 p-5" data-listening-mcq-card={card.day}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip" data-listening-mcq-card-day>
                  {t.dayLabel.replace("{n}", String(card.day))}
                </span>
                <span className="text-xs text-ink-300" data-listening-mcq-card-questions>
                  {t.questions.replace("{n}", String(card.questionCount))}
                </span>
                {card.draft && (
                  <span className="text-xs text-ink-300" data-listening-mcq-card-draft>
                    {t.draftNotice}
                  </span>
                )}
              </div>
              <h2 className="font-display text-lg text-ink-900">{card.title}</h2>
              {/* The learner's own truth: nothing is claimed before they open the day. */}
              <p className="text-xs text-ink-500" data-listening-mcq-card-status={card.status.state}>
                {card.status.state === "completed" ? t.completed : card.status.state === "in_progress" ? t.inProgress : t.notStarted}
                {card.status.state === "in_progress" &&
                  ` · ${t.dayProgress.replace("{done}", String(card.status.completed)).replace("{total}", String(card.status.total))}`}
              </p>
              {/* ONE address per day, whatever state the learner is in: reload, back, forward and a
                  bookmark all land on the same day (and show its real progress). */}
              <div className="mt-auto">
                <Link
                  className="btn-primary"
                  href={`/app/listening/mcq/day/${card.day}`}
                  data-listening-mcq-open
                  data-listening-mcq-action={card.status.state === "completed" ? "review" : card.status.state === "in_progress" ? "continue" : "start"}
                >
                  {card.status.state === "completed" ? t.review : card.status.state === "in_progress" ? t.continue : t.start}
                </Link>
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-300">
        {t.targetNote
          .replace("{target}", String(progress.dayTarget))
          .replace("{perDay}", String(MCQ_DAY_QUESTION_COUNT))}
      </p>
    </div>
  );
}
