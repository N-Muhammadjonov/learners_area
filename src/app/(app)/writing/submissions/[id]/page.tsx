import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getSubmissionDetail } from "@/lib/data/writing";
import { findEvaluation } from "@/lib/data/evaluations";
import { Editor } from "@/components/writing/Editor";
import { FeedbackView } from "@/components/writing/FeedbackView";
import { EvaluationView } from "@/components/coach/EvaluationView";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/**
 * A submission page shows two independent things:
 *
 *   - the Coach evaluation (whoever produced it — RIWI or a configured provider)
 *   - the teacher's own feedback, which lives in its own table and is never
 *     overwritten by an automated evaluation
 */
export default async function SubmissionPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());

  const detail = await getSubmissionDetail(params.id, session.sub);
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
