import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getStudentDetail } from "@/lib/data/teacher";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/Badge";
import { TeacherFeedbackForm } from "@/components/teacher/TeacherFeedbackForm";
import { NewAssignmentForm } from "@/components/teacher/NewAssignmentForm";
import { db } from "@/db/client";
import { writingPrompts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isUuid } from "@/lib/validation/ids";
import { liveWhere } from "@/lib/services/cms/publication";

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  if (!user) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getStudentDetail(id);
  if (!detail) notFound();

  // The Coach's evaluation is shown to the teacher as a separate, read-only
  // block: a teacher reviews automated feedback, adds their own, and never has
  // their own feedback overwritten by it.
  const evaluations = await findEvaluationsForSources({
    sourceType: "writing_submission",
    sourceIds: detail.submissions.map(({ submission }) => submission.id),
  });

  const prompts = await db
    .select({ id: writingPrompts.id, category: writingPrompts.category, taskType: writingPrompts.taskType })
    .from(writingPrompts)
    // A teacher may only set work on a prompt that is live for students.
    .where(
      liveWhere({
        publicationState: writingPrompts.publicationState,
        publishAt: writingPrompts.publishAt,
      }),
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{detail.student.name}</h1>
          <p className="text-sm text-ink-500">{detail.student.email ?? "Telegram account"}</p>
        </div>
        {/* Follow-up work assigned after reviewing the Coach's and the teacher's feedback. */}
        <NewAssignmentForm
          dict={dict}
          studentId={detail.student.id}
          prompts={prompts.map((prompt) => ({
            id: prompt.id,
            label: `${prompt.taskType === "task1" ? dict.writing.task1 : dict.writing.task2} · ${prompt.category}`,
          }))}
        />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg text-ink-900">{dict.teacher.submissionsTitle}</h2>
        <div className="flex flex-col gap-3">
          {detail.submissions.map(({ submission, prompt }) => {
            const feedbackRows = detail.feedbackBySubmission.get(submission.id) ?? [];
            return (
              <Card key={submission.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink-900">{prompt.category}</p>
                  <span className="text-xs text-ink-300">{dict.writing.status[submission.status]}</span>
                </div>
                <p className="line-clamp-2 text-sm text-ink-500">{submission.content || "—"}</p>
                {(() => {
                  const evaluation = evaluations.get(submission.id);
                  if (!evaluation) {
                    return <p className="text-xs text-ink-300">{dict.coach.noEvaluation}</p>;
                  }
                  return (
                    <div className="flex flex-col gap-1 rounded-sm bg-paper-sunken px-3 py-2">
                      <div className="flex items-center gap-2">
                        <BandBadge band={evaluation.overallEstimate} />
                        <span
                          className="badge bg-signal-100 text-signal-700"
                          data-checked-by={evaluation.checkedByName}
                        >
                          {dict.coach.checkedBy} {evaluation.checkedByName}
                        </span>
                        <span className="text-xs text-ink-300">
                          {dict.coach.confidence} {(evaluation.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      {evaluation.weaknesses.slice(0, 2).map((weakness, index) => (
                        <p key={index} className="text-xs text-ink-500">
                          {weakness}
                        </p>
                      ))}
                    </div>
                  );
                })()}
                {feedbackRows.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-sm bg-paper-sunken px-3 py-2 text-sm">
                    <span className="text-xs uppercase text-ink-300">{f.source}</span>
                    <BandBadge band={f.overallBand} />
                    {f.comment && <span className="text-ink-700">{f.comment}</span>}
                  </div>
                ))}
                {submission.status !== "draft" && <TeacherFeedbackForm dict={dict} submissionId={submission.id} />}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
