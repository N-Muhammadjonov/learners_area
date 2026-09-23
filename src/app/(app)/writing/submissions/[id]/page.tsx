import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getSubmissionDetail } from "@/lib/data/writing";
import { Editor } from "@/components/writing/Editor";
import { FeedbackView } from "@/components/writing/FeedbackView";

export default async function SubmissionPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());

  const detail = await getSubmissionDetail(params.id, session.sub);
  if (!detail) notFound();
  const { submission, prompt, feedback } = detail;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <span className="badge bg-signal-100 text-signal-700">
          {prompt.taskType === "task1" ? dict.writing.task1 : dict.writing.task2}
        </span>
        <h1 className="mt-2 font-display text-xl text-ink-900">{prompt.prompt}</h1>
      </div>

      {submission.status === "draft" || !feedback ? (
        <Editor
          dict={dict}
          submissionId={submission.id}
          initialContent={submission.content}
          targetWordCount={prompt.targetWordCount}
        />
      ) : (
        <FeedbackView dict={dict} feedback={feedback} submissionId={submission.id} />
      )}
    </div>
  );
}
