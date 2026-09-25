import { requireActiveUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActiveTests } from "@/lib/data/listening";
import { Card } from "@/components/ui/Card";
import { StartTestButton } from "@/components/listening/StartTestButton";

export default async function ListeningPage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(getLocale());
  const tests = await listActiveTests();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.listening.practiceTitle}</h1>
        <Link href="/listening/history" className="text-sm text-signal-600 hover:underline">
          {dict.listening.historyTitle} →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tests.map((t) => (
          <Card key={t.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="badge bg-signal-100 text-signal-700">{t.difficultyLevel}</span>
            </div>
            <p className="text-sm font-medium text-ink-900">{t.title}</p>
            <div className="flex justify-end">
              <StartTestButton testId={t.id} label={dict.listening.startAttempt} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
