import { getDictionary, getLocale } from "@/lib/i18n";
import { getSession } from "@/lib/auth/session";
import { listAttempts } from "@/lib/data/speaking-practice";
import { formatBytes } from "@/lib/uploads/format";
import { formatDuration } from "@/lib/audio/recorder";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function SpeakingHistoryPage() {
  const session = await getSession();
  if (!session) return null;

  const dict = getDictionary(getLocale());
  const t = dict.speakingPractice;
  const attempts = await listAttempts({ userId: session.sub });

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
        {attempts.map((attempt) => (
          <Card key={attempt.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-900">
                {t.part[attempt.part]}
                {attempt.prompt ? ` · ${attempt.prompt.promptText.slice(0, 60)}…` : ""}
              </p>
              <span className="badge">{t.attemptStatus[attempt.status]}</span>
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

            {!attempt.transcript && attempt.recordingObjectKey && (
              <p className="text-xs text-ink-400">
                {t.noTranscript} — {t.noTranscriptBody}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
