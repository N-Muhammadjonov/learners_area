import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listUserAttempts } from "@/lib/data/reading";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function ReadingHistoryPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const rows = await listUserAttempts(session.sub);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.reading.historyTitle}</h1>
      {rows.length === 0 && (
        <EmptyState
          icon="▤"
          title={dict.dashboard.noAttemptsYet}
          action={<Link href="/reading" className="btn-primary">{dict.reading.pickPassage}</Link>}
        />
      )}
      {rows.map(({ attempt, passage }) => (
        <Link key={attempt.id} href={`/reading/attempts/${attempt.id}`}>
          <Card className="flex items-center justify-between hover:border-signal-400">
            <div>
              <p className="text-sm font-medium text-ink-900">{passage.title}</p>
              <p className="text-xs text-ink-300">
                {attempt.status === "completed"
                  ? `${dict.reading.score}: ${attempt.score}/${attempt.totalQuestions}`
                  : dict.reading.resumeAttempt}
              </p>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
