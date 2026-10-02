import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listUserAttempts } from "@/lib/data/listening";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function ListeningHistoryPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const rows = await listUserAttempts(user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink fallbackHref="/listening" label={dict.common.back} />
      <h1 className="font-display text-2xl text-ink-900">{dict.listening.historyTitle}</h1>
      {rows.length === 0 && (
        <EmptyState
          icon="🎧"
          title={dict.dashboard.noAttemptsYet}
          action={<Link href="/listening" className="btn-primary">{dict.listening.pickTest}</Link>}
        />
      )}
      {rows.map(({ attempt, test }) => (
        <Link key={attempt.id} href={`/listening/attempts/${attempt.id}`}>
          <Card className="flex items-center justify-between hover:border-signal-400">
            <div>
              <p className="text-sm font-medium text-ink-900">{test.title}</p>
              <p className="text-xs text-ink-300">
                {attempt.status === "completed"
                  ? `${dict.listening.score}: ${attempt.score}/${attempt.totalQuestions}`
                  : dict.listening.resumeAttempt}
              </p>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
