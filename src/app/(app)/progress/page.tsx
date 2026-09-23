import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getDashboardData } from "@/lib/data/dashboard";
import { StatCard } from "@/components/ui/Card";

export default async function ProgressPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const data = await getDashboardData(session.sub);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 font-display text-2xl text-ink-900">{dict.nav.progress}</h1>
      <p className="mb-6 text-sm text-ink-500">
        Built from what&apos;s actually persisted so far — Writing attempts and vocabulary. Listening/Reading/Speaking/Mocks
        will appear here once those modules are built.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={dict.writing.historyTitle} value={String(data.writingAttempts)} />
        <StatCard label={dict.dashboard.streak} value={String(data.streak)} />
        <StatCard label={dict.dashboard.vocabDue} value={String(data.vocabDueCount)} />
      </div>
    </div>
  );
}
