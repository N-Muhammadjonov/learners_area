import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { McqMastery } from "@/components/listening/McqMastery";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { mcqDayFor } from "@/lib/data/listening-mcq";
import { MCQ_FINAL_STAGE, mcqActivePosition } from "@/lib/listening/mcq-program";
import type { McqStage } from "@/lib/services/listening/mcq-mastery";

export const dynamic = "force-dynamic";

/**
 * ONE DAY OF THE MCQ PROGRAMME — DAY N, five staged questions, one at a time.
 *
 * This page is a DAY LAYER, not a second engine: every staged step (listen → notes → commit → reveal
 * → choose → reason) is performed by the SAME server-authoritative drill the rest of Listening uses,
 * handed exactly one question. Nothing here keeps progress of its own — the question the learner is
 * on, and the stage they reached, come from `listening_mcq_sessions`, which is also what makes a
 * mid-day return resume where they stopped instead of starting over.
 *
 * What must never happen here: the options or the key of a question that has not reached its stage
 * are absent from this payload entirely (the drill's API decides what to send), the day is never
 * declared complete before all five questions reach the final stage, and a learner is never shown a
 * day the centre has not published.
 */
export default async function ListeningMcqDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ day: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [user, locale, route, query] = await Promise.all([requireActiveUser(), getLocale(), params, searchParams]);
  if (!user) return null;

  const dayNumber = Number.parseInt(route.day ?? "", 10);
  const staff = isStaff(user.role);
  const day = await mcqDayFor(dayNumber, user, { includeDrafts: staff });
  if (!day) notFound();

  const dict = getDictionary(locale);
  const t = dict.listening.mcqProgram;
  const questions = day.questions;

  /*
   * WHICH QUESTION THE LEARNER IS ON. The default is the first question they have not finished, so a
   * return mid-day lands where they stopped — and once all five are finished the day opens on
   * question 1 for review. `?q=` lets the day's own 1–5 navigation choose a question; it is a
   * position, never a stage, and asking for a question that is not in this day falls back to the
   * default rather than inventing one.
   */
  const requested = Number.parseInt(query.q ?? "", 10);
  // 1-based position, derived by the shared rule so the page and its tests cannot disagree.
  const activePosition = mcqActivePosition(questions, Number.isInteger(requested) ? requested : null);
  // A 0-based index, so position and question can never disagree.
  const activeIndex = activePosition - 1;
  const active = activeIndex >= 0 ? questions[activeIndex] ?? null : null;

  const complete = questions.length > 0 && day.status.state === "completed";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-route-usable="listening-mcq-day" data-listening-mcq-day={day.day}>
      <div>
        <BackLink fallbackHref="/app/listening/mcq" label={t.backToDays} data-listening-mcq-day-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900" data-listening-mcq-day-title>
          {t.dayLabel.replace("{n}", String(day.day))} · {day.title}
        </h1>
        {/*
          * DAY PROGRESS, derived from the server's own session rows: how many of this day's
          * questions reached the final stage. A day is complete only when all of them did.
          */}
        <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-500">
          <span data-listening-mcq-day-progress={`${day.status.completed}/${day.status.total}`}>
            {t.dayProgress.replace("{done}", String(day.status.completed)).replace("{total}", String(day.status.total))}
          </span>
          <span data-listening-mcq-day-status={day.status.state}>
            {day.status.state === "completed" ? t.completed : day.status.state === "in_progress" ? t.inProgress : t.notStarted}
          </span>
        </p>
        {day.draft && (
          <p className="mt-1 text-sm text-ink-300" data-listening-mcq-day-draft>
            {t.draftNotice}
          </p>
        )}
      </div>

      {questions.length === 0 || !active ? (
        /* Truthful empty state: nothing is invented to fill a day that holds no questions yet. */
        <section className="card space-y-2 p-6" data-listening-mcq-day-empty>
          <h2 className="font-display text-lg text-ink-900">{t.notFoundTitle}</h2>
          <p className="text-sm text-ink-500">{t.notFoundHint}</p>
        </section>
      ) : (
        <>
          {/*
            * THE DAY'S OWN SEQUENCE, 1…5. It shows a position and the learner's own stage label for
            * that position — never the question text of a question they have not opened, and never an
            * option, a key or an outcome. Colour is not the only signal: every number carries the
            * stage as text for a screen reader.
          */}
          <nav className="flex flex-wrap items-center gap-2" aria-label={t.questionNavLabel} data-listening-mcq-day-nav>
            {questions.map((question, index) => {
              const position = index + 1;
              const current = position === activeIndex + 1;
              const stageLabel =
                question.stage === null ? t.notStarted : question.stage === MCQ_FINAL_STAGE ? t.completed : t.inProgress;
              return (
                <Link
                  key={question.id}
                  href={position === 1 ? `/app/listening/mcq/day/${day.day}` : `/app/listening/mcq/day/${day.day}?q=${position}`}
                  aria-current={current ? "step" : undefined}
                  aria-label={`${t.questionOf.replace("{n}", String(position)).replace("{total}", String(questions.length))} — ${stageLabel}`}
                  className={current ? "btn-primary" : "btn-secondary"}
                  data-listening-mcq-day-step={position}
                  data-listening-mcq-day-step-state={question.stage === null ? "not_started" : question.stage === MCQ_FINAL_STAGE ? "completed" : "in_progress"}
                >
                  {position}
                </Link>
              );
            })}
            {complete && (
              <span className="text-sm text-band-good" data-listening-mcq-day-complete>
                {t.practiceComplete}
              </span>
            )}
          </nav>

          <p className="text-sm text-ink-500" data-listening-mcq-day-position={activeIndex + 1}>
            {t.questionOf.replace("{n}", String(activeIndex + 1)).replace("{total}", String(questions.length))}
          </p>

          {/*
            * THE ONE ENGINE. The drill receives a single question: its own persisted stage, the
            * question text and the audio address. Its options arrive from the server only when the
            * session reaches the reveal stage, and the key only after the learner commits.
            */}
          <McqMastery
            key={active.id}
            dict={dict}
            questions={[{ id: active.id, order: activeIndex + 1, questionText: active.questionText, stage: (active.stage ?? "listen") as McqStage }]}
            dayNavigation={{currentHref: `/app/listening/mcq/day/${day.day}?q=${activeIndex + 1}`, nextHref: activeIndex + 1 < questions.length ? `/app/listening/mcq/day/${day.day}?q=${activeIndex + 2}` : null}}
            audioUrl={day.audioUrl}
          />

          <p className="text-xs text-ink-300">{t.practiceOnly}</p>
        </>
      )}
    </div>
  );
}
