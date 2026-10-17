import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { mcqProgramDays } from "@/lib/data/listening-mcq";

export const dynamic = "force-dynamic";

/**
 * LISTENING MCQ — the programme home: DAY cards, and nothing else.
 *
 * The owner's fourth destination is a training programme, not a test library. Each card is one
 * authored DAY holding exactly five multiple-choice questions, and it states only what is true: the
 * day number the centre authored, how many questions it really holds, and THIS learner's status.
 * A day that has not been published is not rendered as an empty card, and NO target day count is
 * claimed: the programme has no maximum number of days, so the only figure shown is how many days
 * genuinely exist. Days are read one bounded page at a time, so a programme of a thousand days
 * stays reachable and no page streams an unbounded result set.
 *
 * The chrome is English and Uzbek; the questions themselves are the owner's material and are never
 * translated or generated.
 */
export default async function ListeningMcqPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, locale, params] = await Promise.all([
    requireActiveUser(),
    getLocale(),
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  if (!user) return null;

  const dict = getDictionary(locale);
  const t = dict.listening.mcqProgram;
  const staff = isStaff(user.role);
  // A hostile or mistyped ?page= is normalised, never trusted: a non-number is page 1.
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const requestedPage = Number.parseInt(String(rawPage ?? "1"), 10);
  const { days } = await mcqProgramDays(user, {
    includeDrafts: staff,
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening-mcq">
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
                {card.locked?<div data-listening-mcq-locked><button className="btn-secondary" disabled>🔒 {dict.listening.academic.locked}</button><p className="mt-2 text-xs text-ink-500">{t.lockedHint}</p></div>:<Link
                  prefetch={false}
                  className="btn-primary"
                  href={`/app/listening/mcq/day/${card.day}`}
                  data-listening-mcq-open
                  data-listening-mcq-action={card.status.state === "completed" ? "review" : card.status.state === "in_progress" ? "continue" : "start"}
                >
                  {card.status.state === "completed" ? t.review : card.status.state === "in_progress" ? t.continue : t.start}
                </Link>}
              </div>
            </section>
          ))}
        </div>
      )}


    </div>
  );
}
