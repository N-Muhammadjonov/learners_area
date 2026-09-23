import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getTopicMastery } from "@/lib/data/grammar";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

export default async function GrammarPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const rows = await getTopicMastery(session.sub);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.grammar.title}</h1>
        <p className="text-sm text-ink-500">{dict.grammar.subtitle}</p>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map(({ topic, totalExercises, correct }) => (
          <Link key={topic.id} href={`/grammar/${topic.id}`}>
            <Card className="hover:border-signal-400">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-900">{topic.title}</p>
                <span className="text-xs text-ink-300">
                  {dict.grammar.mastery}: {correct}/{totalExercises}
                </span>
              </div>
              <ProgressBar value={totalExercises ? (correct / totalExercises) * 100 : 0} />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
