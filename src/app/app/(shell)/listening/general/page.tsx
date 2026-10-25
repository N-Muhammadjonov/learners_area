import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { generalListeningCards } from "@/lib/data/listening-general";

export const dynamic = "force-dynamic";

/**
 * GENERAL LISTENING — the catalogue of standalone SECTIONS.
 *
 * The owner's product: one published section opens DIRECTLY into the familiar Listening
 * attempt interface. There is deliberately NO activity hub here, no combined four-part exam
 * and no per-activity cards (Script / MCQ / Matching belong to the Academic full test's hub).
 * A section's multiple-choice questions are answered inside that one attempt.
 *
 * Every card states only what is true about the section — its authored section number when it
 * has one, how long the recording is when the centre stored that, how many questions it really
 * has, and this learner's own status — and the read is paged, so a centre with 120 sections
 * does not stop the learner at the first screenful.
 */
export default async function GeneralListeningPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.listening.general;
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const { cards, hasMore, total } = await generalListeningCards(user.id, page);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening-general">
      <div>
        <BackLink fallbackHref="/app/listening" label={dict.listening.practiceTitle} data-listening-general-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">🎙️ {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
        {total > 0 && (
          <p className="mt-1 text-xs text-ink-300" data-listening-general-count data-listening-general-total={total}>
            {t.catalogueCount.replace("{n}", String(total))}
          </p>
        )}
      </div>

      {cards.length === 0 ? (
        <section className="card space-y-2 p-6" data-listening-general-empty>
          <h2 className="font-display text-lg text-ink-900">{t.emptyTitle}</h2>
          <p className="text-sm text-ink-500">{t.emptyHint}</p>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-listening-general-grid>
          {cards.map((card) => (
            <section key={card.testId} className="card flex flex-col gap-3 p-5" data-listening-general-card={card.testId}>
              <div className="flex flex-wrap items-center gap-2">
                {card.sectionNo !== null && (
                  <span className="chip" data-listening-general-card-section>
                    {t.sectionLabel.replace("{n}", String(card.sectionNo))}
                  </span>
                )}
                {card.durationSec !== null && (
                  <span className="text-xs text-ink-300" data-listening-general-card-duration>
                    {Math.max(1, Math.round(card.durationSec / 60))} {t.minutes}
                  </span>
                )}
                <span className="text-xs text-ink-300" data-listening-general-card-questions>
                  {t.questions.replace("{n}", String(card.questionCount))}
                </span>
              </div>
              <h2 className="font-display text-lg text-ink-900">{card.title}</h2>
              {/* The learner's own truth: nothing is claimed before they open the section. */}
              <p className="text-xs text-ink-500" data-listening-general-card-status>
                {card.completed && card.lastScore !== null && card.lastTotal !== null
                  ? t.lastResult.replace("{score}", String(card.lastScore)).replace("{total}", String(card.lastTotal))
                  : card.started
                    ? t.inProgress
                    : t.notStarted}
              </p>
              {/*
                * ONE address per section, whatever state the learner is in: it is the section
                * itself, so reload, back, forward and a bookmark all land on the same exercise
                * (or on its result once it is finished). The attempt's own URL is internal —
                * the catalogue never needs to know an attempt id to open a section.
                */}
              <div className="mt-auto">
                <Link
                  className="btn-primary"
                  href={`/app/listening/general/${card.testId}`}
                  data-listening-general-open
                  data-listening-general-action={card.completed ? "review" : card.started ? "continue" : "open"}
                >
                  {card.completed ? t.reviewSection : card.started ? t.continueSection : t.openSection}
                </Link>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Every published section is reachable: the list is bounded per page and the reader moves
          through it here, so a catalogue of 120 sections never stops at the first screenful. */}
      {(page > 1 || hasMore) && (
        <nav className="flex items-center justify-between gap-3" aria-label={t.paginationLabel} data-listening-general-pagination>
          {page > 1 ? (
            <Link className="btn-secondary" href={page === 2 ? "/app/listening/general" : `/app/listening/general?page=${page - 1}`} data-listening-general-prev>
              ← {t.previousPage}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ink-300">{t.pageLabel.replace("{page}", String(page))}</span>
          {hasMore ? (
            <Link className="btn-secondary" href={`/app/listening/general?page=${page + 1}`} data-listening-general-next>
              {t.nextPage} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
