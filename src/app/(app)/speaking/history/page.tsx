import { getDictionary, getLocale } from "@/lib/i18n";
import { getSession } from "@/lib/auth/session";
import { listAttempts } from "@/lib/data/speaking-practice";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { formatBytes } from "@/lib/uploads/format";
import { formatDuration } from "@/lib/audio/recorder";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { EvaluationView } from "@/components/coach/EvaluationView";
import { ManualTranscriptForm } from "@/components/coach/ManualTranscriptForm";

export const dynamic = "force-dynamic";

export default async function SpeakingHistoryPage() {
  const session = await getSession();
  if (!session) return null;

  const dict = getDictionary(getLocale());
  const t = dict.speakingPractice;
  const attempts = await listAttempts({ userId: session.sub });

  const evaluations = await findEvaluationsForSources({
    sourceType: "speaking_attempt",
    sourceIds: attempts.map((attempt) => attempt.id),
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{t.historyTitle}</h1>

      {attempts.length === 0 && (
        <EmptyState
          icon="🎙"
          title={t.historyEmpty}
          action={
            <Link href="/speaking/practice" className="btn-primary mt-2">
              {t.openStudio}
            </Link>
          }
        />
      )}

      <div className="flex flex-col gap-3">
        {attempts.map((attempt) => {
          const evaluation = evaluations.get(attempt.id);
          return (
            <Card key={attempt.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-900">
                  {t.part[attempt.part]}
                  {attempt.prompt ? ` · ${attempt.prompt.promptText.slice(0, 60)}…` : ""}
                </p>
                <div className="flex items-center gap-2">
                  <span className="badge">{t.attemptStatus[attempt.status]}</span>
                  {evaluation && (
                    <span
                      className="badge bg-signal-100 text-signal-700"
                      data-checked-by={evaluation.checkedByName}
                    >
                      {dict.coach.checkedBy} {evaluation.checkedByName}
                    </span>
                  )}
                </div>
              </div>

              {attempt.recordingObjectKey ? (
                <>
                  <audio
                    controls
                    preload="none"
                    className="w-full"
                    src={`/api/resources/${attempt.recordingObjectKey}`}
                  />
                  <div className="flex flex-wrap items-center gap-3 text-xs text-ink-300">
                    <span>{attempt.recordingOriginalName ?? "recording"}</span>
                    {attempt.recordingDurationMs ? <span>{formatDuration(attempt.recordingDurationMs)}</span> : null}
                    {attempt.recordingSize ? <span>{formatBytes(attempt.recordingSize)}</span> : null}
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink-300">{t.attemptStatus.recording}</p>
              )}

              {attempt.transcript ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-ink-300">
                    {attempt.transcriptOrigin === "manual" ? dict.coach.transcriptManual : dict.coach.transcriptFromStt}
                  </p>
                  <p className="whitespace-pre-line rounded-sm bg-paper-sunken p-3 text-sm text-ink-700">
                    {attempt.transcript}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-ink-400">
                    {t.noTranscript} — {t.noTranscriptBody}
                  </p>
                  {attempt.recordingObjectKey && attempt.status !== "recording" && (
                    <ManualTranscriptForm dict={dict} attemptId={attempt.id} />
                  )}
                </>
              )}

              {evaluation ? (
                <EvaluationView dict={dict} evaluation={evaluation} />
              ) : (
                attempt.transcript && (
                  <p className="text-xs text-ink-400">{dict.coach.noEvaluation}</p>
                )
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
