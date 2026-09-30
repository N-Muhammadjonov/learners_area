import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/listening";
import { ListeningExam } from "@/components/listening/ListeningExam";
import { ListeningAnalysis } from "@/components/listening/ListeningAnalysis";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { isUuid } from "@/lib/validation/ids";
import { OwnerMaterialBlocks } from "@/components/resources/OwnerMaterialBlocks";

export default async function ListeningAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getAttemptDetail(id, user.id);
  if (!detail) notFound();
  const { attempt, test, questions, answers } = detail;

  return (
    <div className="mx-auto max-w-3xl">
      {attempt.status === "in_progress" ? (
        <ListeningExam
          dict={dict}
          attemptId={attempt.id}
          testTitle={test.title}
          audioUrl={test.audioUrl}
          audioType={test.audioType}
          questions={questions.map((q) => ({
            id: q.id,
            order: q.order,
            type: q.type,
            questionText: q.questionText,
            options: q.options ?? null,
          }))}
        />
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <Link
              href={`/listening/attempts/${attempt.id}/revision`}
              className="btn-secondary "
              data-revision-link
            >
              {dict.listening.revisionStudio} →
            </Link>
          </div>
          <ListeningAnalysis dict={dict} score={attempt.score} total={attempt.totalQuestions} questions={questions} answers={answers} />
          {test.transcript && (
            <div className="card mt-4" data-interactive-transcript>
              <h3 className="mb-2 font-display text-base text-ink-900">{dict.listening.transcript}</h3>
              <p className="mb-2 text-xs text-ink-300">{dict.listening.transcriptHint}</p>
              {/* The transcript is interactive: every word can be looked up or saved. */}
              <ClickableText
                dict={dict}
                text={test.transcript}
                sourceType="listening"
                sourceId={test.id}
                className="text-sm leading-relaxed text-ink-700"
              />
            </div>
          )}
        </>
      )}

      {/* Notes, a transcript file or a link the administrator attached to this
          test. Shown for an open attempt as well as after submitting, because
          material that only appears after the test would be useless. */}
      <div className="mt-4">
        <OwnerMaterialBlocks ownerType="listening" ownerId={test.id} ownerVisible />
      </div>
    </div>
  );
}
