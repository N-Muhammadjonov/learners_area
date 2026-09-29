import { Suspense } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { isAdministrator } from "@/lib/auth/roles";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicMastery } from "@/lib/data/grammar";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { MASTERY_SESSIONS } from "@/lib/services/grammar/mastery";

async function GrammarTopics({ userId, isAdmin, dict }: {
  userId: string;
  isAdmin: boolean;
  dict: ReturnType<typeof getDictionary>;
}) {
  const rows = await getTopicMastery(userId);
  return (
    <>
      {rows.length === 0 && <EmptyState title={dict.grammar.emptyTitle} body={dict.grammar.emptyHint}
        action={<Link className="text-sm text-signal-600 underline" href={isAdmin ? "/admin/grammar" : "/dashboard"}>
          {isAdmin ? dict.grammar.manageContent : dict.nav.dashboard}
        </Link>} />}
      <div className="flex flex-col gap-3" data-grammar-topics data-async-content="grammar-topics">
        {rows.map(({ topic, totalExercises, mastery }) => (
          <Link key={topic.id} href={`/grammar/${topic.id}`}>
            <Card className="hover:border-signal-400" data-topic-row={topic.id}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-900">{topic.title}</p>
                <span className="flex items-center gap-2 text-xs text-ink-300">
                  {mastery.mastered && (
                    <span className="badge bg-band-good/10 text-band-good" data-topic-mastered={topic.id}>
                      {dict.grammar.masteryMastered}
                    </span>
                  )}
                  <span data-topic-score={topic.id}>
                    {dict.grammar.masteryScore}: {mastery.scorePercent}% · {mastery.sessions}/
                    {MASTERY_SESSIONS} {dict.grammar.masterySessions.toLowerCase()}
                  </span>
                </span>
              </div>
              <ProgressBar value={mastery.scorePercent} />
              <p className="mt-1 text-xs text-ink-300">
                {dict.grammar.masteryActivities}: {totalExercises} {dict.grammar.exercises}
              </p>
            </Card>
          </Link>
        ))}
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

export default async function GrammarPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-route-usable="grammar">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.grammar.title}</h1>
        <p className="text-sm text-ink-500">{dict.grammar.subtitle}</p>
      </div>
      <Suspense fallback={<GrammarTopicsSkeleton />}>
        <GrammarTopics userId={user.id} isAdmin={isAdministrator(user.role)} dict={dict} />
      </Suspense>
    </div>
  );
}
