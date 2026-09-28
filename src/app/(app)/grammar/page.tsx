import { EmptyState } from "@/components/ui/EmptyState";
import { isAdministrator } from "@/lib/auth/roles";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicMastery } from "@/lib/data/grammar";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { MASTERY_SESSIONS } from "@/lib/services/grammar/mastery";

export default async function GrammarPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const rows = await getTopicMastery(user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.grammar.title}</h1>
        <p className="text-sm text-ink-500">{dict.grammar.subtitle}</p>
      </div>
      {rows.length === 0 && <EmptyState title={dict.grammar.emptyTitle} body={dict.grammar.emptyHint}
        action={<Link className="text-sm text-signal-600 underline" href={isAdministrator(user.role) ? "/admin/grammar" : "/dashboard"}>
          {isAdministrator(user.role) ? dict.grammar.manageContent : dict.nav.dashboard}
        </Link>} />}
      <div className="flex flex-col gap-3">
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
    </div>
  );
}
