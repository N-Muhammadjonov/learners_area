import { requireActiveUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePassages } from "@/lib/data/reading";
import { Card } from "@/components/ui/Card";
import { StartPassageButton } from "@/components/reading/StartPassageButton";

export default async function ReadingPage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(getLocale());
  const passages = await listActivePassages();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.reading.practiceTitle}</h1>
        <Link href="/reading/history" className="text-sm text-signal-600 hover:underline">
          {dict.reading.historyTitle} →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {passages.map((p) => (
          <Card key={p.id} data-passage={p.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="badge bg-signal-100 text-signal-700">{p.difficultyLevel}</span>
              <span className="text-xs text-ink-300">
                {p.suggestedMinutes} {dict.reading.minutes}
              </span>
            </div>
            <p className="text-sm font-medium text-ink-900">{p.title}</p>
            <div className="flex justify-end">
              <StartPassageButton passageId={p.id} label={dict.reading.startAttempt} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
