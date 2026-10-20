import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicMastery } from "@/lib/data/grammar";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { MASTERY_SESSIONS } from "@/lib/services/grammar/mastery";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

async function GrammarTopics({ userId, dict, area }: {
  area: "writing" | "speaking";
  userId: string;
  dict: ReturnType<typeof getDictionary>;
}) {
  const rows = await getTopicMastery(userId, area);
  const selectedRows = rows.filter(row => row.topic.skillArea === area);
  const masteryUnavailable = selectedRows.some((row) => row.masteryUnavailable);
  return (
    <>
      {masteryUnavailable && (
        <RegionFailureNotice region="grammar-mastery" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />
      )}
      <div className="flex flex-col gap-3" data-grammar-topics data-async-content="grammar-topics">
        <section key={area} className="space-y-3" data-grammar-skill={area}>
        {selectedRows.map(({ topic, totalExercises, mastery }) => (
          <Link key={topic.id} href={`/app/grammar/${topic.id}`}>
            <Card className="hover:border-signal-400" data-topic-row={topic.id}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-900">{topic.title}</p>
                <span className="flex items-center gap-2 text-xs text-ink-300">
                  {mastery?.mastered && (
                    <span className="badge bg-band-good/10 text-band-good" data-topic-mastered={topic.id}>
                      {dict.grammar.masteryMastered}
                    </span>
                  )}
                  {mastery ? (
                    <span data-topic-score={topic.id}>
                      {dict.grammar.masteryScore}: {mastery.scorePercent}% · {mastery.sessions}/
                      {MASTERY_SESSIONS} {dict.grammar.masterySessions.toLowerCase()}
                    </span>
                  ) : <span data-topic-mastery-unavailable={topic.id}>—</span>}
                </span>
              </div>
              {mastery && <ProgressBar value={mastery.scorePercent} />}
              <p className="mt-1 text-xs text-ink-300">
                {dict.grammar.masteryActivities}: {totalExercises} {dict.grammar.exercises}
              </p>
            </Card>
          </Link>
        ))}
        </section>
      </div>
    </>
  );
}

function GrammarTopicsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3" data-grammar-topics-skeleton data-async-loading="grammar-topics">
      {[0, 1, 2].map((row) => <div key={row} className="h-24 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function GrammarPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  // The first Grammar module section is Lessons; explicit Writing/Speaking tabs remain real URLs.
  if (!query.tab) redirect("/app/grammar/lessons");
  const area = query.tab === "speaking" ? "speaking" : "writing";
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-route-usable="grammar">
      <Suspense fallback={<GrammarTopicsSkeleton />}>
        <GrammarTopics userId={user.id} area={area} dict={dict} />
      </Suspense>
    </div>
  );
}
