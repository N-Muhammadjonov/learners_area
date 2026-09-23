import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getDashboardData } from "@/lib/data/dashboard";
import { StatCard, Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const SKILLS = ["listening", "reading", "writing", "speaking"] as const;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null; // middleware + layout already guard this
  const dict = getDictionary(getLocale());
  const data = await getDashboardData(session.sub);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">
          {dict.dashboard.greeting}, {session.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-ink-500">{dict.nav.course} · IELTS</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={dict.dashboard.targetBand} value={data.profile?.targetBand?.toFixed(1) ?? "—"} />
        <StatCard label={dict.dashboard.streak} value={String(data.streak)} />
        <StatCard label={dict.writing.historyTitle} value={String(data.writingAttempts)} />
        <StatCard label={dict.dashboard.vocabDue} value={String(data.vocabDueCount)} />
      </div>

      <Card>
        <h2 className="font-display text-lg text-ink-900">{dict.dashboard.continueLearning}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {data.writingAttempts > 0
            ? "Pick up another Writing prompt or clear your vocabulary queue."
            : "Start with a Writing Task 2 prompt — it's the fastest way to see the full feedback loop."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/writing"><Button>{dict.dashboard.startWriting}</Button></Link>
          <Link href="/vocabulary"><Button variant="secondary">{dict.dashboard.reviewVocab}</Button></Link>
        </div>
      </Card>

      {data.latestEvaluation && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg text-ink-900">{dict.dashboard.recentFeedback}</h2>
            <BandBadge band={data.latestEvaluation.overallEstimate} />
          </div>
          {data.latestEvaluation.weaknesses[0] && (
            <p className="mt-2 text-sm text-ink-500">{data.latestEvaluation.weaknesses[0]}</p>
          )}
          <p className="mt-2 text-xs text-ink-300" data-checked-by={data.latestEvaluation.checkedByName}>
            {dict.coach.checkedBy} {data.latestEvaluation.checkedByName}
          </p>
          <Link href="/coach" className="mt-3 inline-block text-sm text-signal-600 hover:underline">
            {dict.coach.title} →
          </Link>
        </Card>
      )}

      <div>
        <h2 className="mb-3 font-display text-lg text-ink-900">{dict.dashboard.skillSummary}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SKILLS.map((skill) => (
            <Card key={skill} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-900">{dict.nav[skill]}</span>
              {skill === "writing" && data.latestEvaluation ? (
                <BandBadge band={data.latestEvaluation.overallEstimate} />
              ) : (
                <span className="text-xs text-ink-300">{dict.dashboard.noAttemptsYet}</span>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
