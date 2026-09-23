import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listUserSubmissions } from "@/lib/data/writing";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function WritingHistoryPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const rows = await listUserSubmissions(session.sub);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.writing.historyTitle}</h1>

      {rows.length === 0 && (
        <EmptyState
          icon="✎"
          title={dict.dashboard.noAttemptsYet}
          action={
            <Link href="/writing" className="btn-primary">
              {dict.dashboard.startWriting}
            </Link>
          }
        />
      )}

      {rows.map(({ submission, prompt }) => (
        <Link key={submission.id} href={`/writing/submissions/${submission.id}`}>
          <Card className="flex items-center justify-between hover:border-signal-400">
            <div>
              <p className="text-sm font-medium text-ink-900">{prompt.category}</p>
              <p className="text-xs text-ink-300">
                {prompt.taskType === "task1" ? dict.writing.task1 : dict.writing.task2} ·{" "}
                {dict.writing.status[submission.status]} · {submission.wordCount} {dict.common.words}
              </p>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
