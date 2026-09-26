import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getSubmissionDetail } from "@/lib/data/writing";
import { findEvaluation } from "@/lib/data/evaluations";
import { Editor } from "@/components/writing/Editor";
import { FeedbackView } from "@/components/writing/FeedbackView";
import { EvaluationView } from "@/components/coach/EvaluationView";
import { Card } from "@/components/ui/Card";
import { isUuid } from "@/lib/validation/ids";

export const dynamic = "force-dynamic";

/**
 * A submission page shows two independent things:
 *
 *   - the Coach evaluation (whoever produced it — RIWI or a configured provider)
 *   - the teacher's own feedback, which lives in its own table and is never
 *     overwritten by an automated evaluation
 */
export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getSubmissionDetail(id, user.id);
  if (!detail) notFound();
  const { submission, prompt, feedback } = detail;

  const evaluation = await findEvaluation({
    sourceType: "writing_submission",
    sourceId: submission.id,
  });

  const isDraft = submission.status === "draft";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <span className="badge bg-signal-100 text-signal-700">
          {prompt.taskType === "task1" ? dict.writing.task1 : dict.writing.task2}
        </span>
        <h1 className="mt-2 font-display text-xl text-ink-900">{prompt.prompt}</h1>
      </div>

      {isDraft ? (
        <Editor
          dict={dict}
          submissionId={submission.id}
          initialContent={submission.content}
          targetWordCount={prompt.targetWordCount}
        />
      ) : (
        <>
          {evaluation ? (
            <EvaluationView dict={dict} evaluation={evaluation} />
          ) : (
            <Card>
              <p className="text-sm text-ink-500">{dict.coach.noEvaluationNoProvider}</p>
            </Card>
          )}

          {feedback && feedback.source === "teacher" && (
            <FeedbackView dict={dict} feedback={feedback} submissionId={submission.id} />
          )}
        </>
      )}
    </div>
  );
}
