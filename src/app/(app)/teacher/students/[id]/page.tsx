import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getStudentDetail } from "@/lib/data/teacher";
import { Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/Badge";
import { TeacherFeedbackForm } from "@/components/teacher/TeacherFeedbackForm";

export default async function StudentDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const detail = await getStudentDetail(params.id);
  if (!detail) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{detail.student.name}</h1>
        <p className="text-sm text-ink-500">{detail.student.email ?? "Telegram account"}</p>
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
