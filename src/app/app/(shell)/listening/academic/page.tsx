import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { academicListeningCards } from "@/lib/data/listening-academic";

export const dynamic = "force-dynamic";

/**
 * Listening → Academic Listening.
 *
 * The canonical catalogue: only PUBLISHED Academic Listening tests, read from the one
 * content layer (`listening_tests` + `listening_packages`), never from a hard-coded list
 * and never from a title convention. A draft is invisible here; a learner cannot open one.
 *
 * Each card states the truth about the test in front of the reader — how many sections and
 * questions it has, how many activities it supports for THIS learner, and how many of them
 * they have finished — so the catalogue never promises a fixed ten-card grid.
 */
export default async function AcademicListeningPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.listening.academic;
  const cards = await academicListeningCards(user.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening-academic">
      <div>
        <BackLink fallbackHref="/app/listening" label={dict.listening.practiceTitle} data-listening-academic-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">🎧 {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
        {cards.length > 0 && (
          <p className="mt-1 text-xs text-ink-300" data-listening-academic-count>
            {t.catalogueCount.replace("{n}", String(cards.length))}
          </p>
        )}
      </div>

      {cards.length === 0 ? (
        <Card data-listening-academic-empty>
          <h2 className="font-display text-lg text-ink-900">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-500">{t.emptyHint}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-listening-academic-grid>
          {cards.map((card) => (
            <Card key={card.testId} data-listening-academic-card={card.testId}>
              <div className="flex h-full flex-col gap-2">
                <h2 className="font-display text-lg text-ink-900">{card.title}</h2>
                <p className="text-xs text-ink-300">
                  <span data-listening-academic-card-parts>{t.parts.replace("{n}", String(card.parts))}</span>
                  {" · "}
                  <span data-listening-academic-card-questions>{t.questions.replace("{n}", String(card.questions))}</span>
                  {card.minutes !== null && (
                    <>
                      {" · "}
                      <span>
                        {card.minutes} {t.minutes}
                      </span>
                    </>
                  )}
                </p>
                <p className="text-xs text-ink-500" data-listening-academic-card-progress>
                  {t.activitiesLabel.replace("{done}", String(card.completed)).replace("{total}", String(card.activityCount))}
                </p>
                {card.exam ? (
                  <p className="text-xs text-ink-500" data-listening-academic-card-exam>
                    {t.examResult
                      .replace("{score}", String(card.exam.score ?? "—"))
                      .replace("{total}", String(card.exam.total ?? "—"))}
                  </p>
                ) : (
                  <p className="text-xs text-ink-300">{t.noProgress}</p>
                )}
                <Link
                  className="btn-secondary mt-auto self-start"
                  href={`/app/listening/academic/${card.testId}`}
                  data-listening-academic-open
                >
                  {card.started ? t.open : t.openTest}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
