import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listUserSubmissions } from "@/lib/data/writing";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function WritingHistoryPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const rows = await listUserSubmissions(user.id);

  const evaluations = await findEvaluationsForSources({
    sourceType: "writing_submission",
    sourceIds: rows.map(({ submission }) => submission.id),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink fallbackHref="/app/writing" label={dict.common.back} />
      <h1 className="font-display text-2xl text-ink-900">{dict.writing.historyTitle}</h1>

      {rows.length === 0 && (
        <EmptyState
          icon="✎"
          title={dict.dashboard.noAttemptsYet}
          action={
            <Link href="/app/writing" className="btn-primary">
              {dict.dashboard.startWriting}
            </Link>
          }
        />
      )}

      {rows.map(({ submission, prompt }) => {
        const evaluation = evaluations.get(submission.id);
        return (
          <Link key={submission.id} href={`/app/writing/submissions/${submission.id}`}>
            <Card className="flex items-center justify-between gap-3 hover:border-signal-400">
              <div>
                <p className="text-sm font-medium text-ink-900">{prompt.category}</p>
                <p className="text-xs text-ink-300">
                  {prompt.taskType === "task1" ? dict.writing.task1 : dict.writing.task2} ·{" "}
                  {dict.writing.status[submission.status]} · {submission.wordCount} {dict.common.words}
                </p>
              </div>
              {evaluation && (
                <span className="badge bg-signal-100 text-signal-700" data-checked-by={evaluation.checkedByName}>
                  {dict.coach.checkedBy} {evaluation.checkedByName}
                </span>
              )}
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
