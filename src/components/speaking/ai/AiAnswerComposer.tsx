"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  createRecorder,
  extensionForMime,
  formatDuration,
  isRecordingSupported,
  RecorderError,
  type Recorder,
} from "@/lib/audio/recorder";
import { preflight, startUpload, type UploadHandle, type UploadState } from "@/lib/uploads/client";
import { uploadErrorMessage } from "@/lib/uploads/errors";
import { formatBytes } from "@/lib/uploads/format";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import type { Dictionary } from "@/lib/i18n/en";
import type { AiSessionItemView } from "@/lib/data/speaking-ai-sessions";
import type { LearnerEvaluation } from "@/lib/services/coach/public-evaluation";
import { useBrowserTranscript } from "./useBrowserTranscript";

type Recording = { blob: Blob; mimeType: string; durationMs: number };

type Phase =
  | { kind: "idle" }
  | { kind: "prepping"; endsAt: number }
  | { kind: "starting" }
  | { kind: "recording"; startedAt: number; limitSeconds: number }
  | { kind: "reviewing" }
  | { kind: "uploading"; progress: number; state: UploadState }
  | { kind: "sending" }
  | { kind: "error" };

/** Part 2 gives preparation time with the microphone OFF (§10). */
const PART2_PREP_SECONDS = 60;
const PART2_ANSWER_SECONDS = 120;

/**
 * One question of an AI session: prepare → record (+ live browser transcript) →
 * STOP → review the transcript → explicitly send.
 *
 * The rules this component is built around, all of which are the ones a learner
 * would be right to be angry about if they were broken:
 *
 *  - STOPPING NEVER SENDS ANYTHING (§5/§18). Stop produces a local blob for
 *    review; the transcript is frozen but not committed. Sending is a separate,
 *    deliberate press of "Send to RIWI".
 *  - THE MICROPHONE IS RELEASED THE MOMENT RECORDING STOPS, and on unmount.
 *  - THE AUDIO DOES NOT LEAVE THE BROWSER UNTIL SEND. No upload starts while the
 *    learner is reviewing, re-recording or discarding, so a discarded take is
 *    never uploaded anywhere.
 *  - RE-RECORD AND CLEAR THROW THE TAKE AWAY, transcript included. Nothing from
 *    the abandoned take can reach the server later.
 *  - THE TRANSCRIPT IS THE LEARNER'S. It is editable before sending, and the
 *    server derives whether it was edited by comparing it with what the browser
 *    actually recognized.
 *  - THE LIVE TRANSCRIPT IS LABELLED AS BROWSER RECOGNITION. It is never
 *    described as server transcription (it is not) nor as pronunciation
 *    assessment (it is not that either).
 */
export function AiAnswerComposer({
  dict,
  sessionId,
  item,
  busy,
  retryOfAttemptId,
  onBusyChange,
  onSent,
}: {
  dict: Dictionary;
  sessionId: string;
  item: AiSessionItemView;
  /** True while another question's recorder holds the microphone. */
  busy: boolean;
  /**
   * Set when this is a "Try again": the attempt being replaced. The new attempt
   * records its lineage in `retry_of_attempt_id`, which is what lets the server
   * accept the rebind and refuse any attempt that is not a genuine retry (§30).
   */
  retryOfAttemptId: string | null;
  onBusyChange: (busy: boolean) => void;
  /**
   * Called once the answer is stored, evaluated and bound to this question.
   * `transcriptEdited`/`transcriptSent` are passed along because the parent
   * re-renders the feedback later on a revisit: if it re-derived them from an
   * empty local draft it would tell the learner their edited transcript was
   * untouched, which is exactly the provenance lie this feature must not tell.
   */
  onSent: (
    attemptId: string,
    evaluation: LearnerEvaluation | null,
    meta: { transcriptEdited: boolean; transcriptSent: boolean },
  ) => void;
}) {
  const t = dict.speakingAi;
  const tPractice = dict.speakingPractice;
  const request = useScopedRequest();
  const transcript = useBrowserTranscript();

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [supported] = useState(() => isRecordingSupported());
  const [recording, setRecording] = useState<Recording | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Frozen at Stop: what the browser recognized, before any learner edits. */
  const [rawTranscript, setRawTranscript] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [prepRemaining, setPrepRemaining] = useState(PART2_PREP_SECONDS);
  const [error, setError] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);

  const epoch = useRef(0);
  const alive = useRef(true);
  const recorderRef = useRef<Recorder | null>(null);
  const microphoneRequest = useRef<AbortController | null>(null);
  const upload = useRef<UploadHandle | null>(null);
  const submitting = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prepRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const prompt = item.prompt;
  const isCueCard = item.isCueCard || item.part === "part2";
  const prepSeconds = isCueCard ? PART2_PREP_SECONDS : Math.max(0, prompt?.prepSeconds ?? 0);
  const answerSeconds = isCueCard ? PART2_ANSWER_SECONDS : Math.max(30, prompt?.answerSeconds ?? 90);

  const stopTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (prepRef.current) { clearInterval(prepRef.current); prepRef.current = null; }
  }, []);

  /** Invalidates in-flight async work so a stale completion cannot move the UI. */
  const invalidate = useCallback(() => { epoch.current += 1; }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      invalidate();
      stopTimers();
      upload.current?.cancel(); upload.current = null;
      microphoneRequest.current?.abort(); microphoneRequest.current = null;
      recorderRef.current?.cancel(); recorderRef.current = null;
      transcript.abort();
    };
    // transcript.abort is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidate, stopTimers]);

  useEffect(() => () => { if (playbackUrl) URL.revokeObjectURL(playbackUrl); }, [playbackUrl]);

  // ---- recording ---------------------------------------------------------

  const finishRecording = useCallback(async () => {
    stopTimers();
    const recorder = recorderRef.current;
    if (!recorder) return;
    const generation = epoch.current;

    // Stop the recognizer FIRST so the transcript and the audio end together.
    // The transcript is frozen here and not committed to the server — that is
    // what makes the review step real.
    const finalized = transcript.stop();
    setRawTranscript(finalized);

    let result: Awaited<ReturnType<Recorder["stop"]>>;
    try {
      result = await recorder.stop();
    } catch {
      recorder.cancel();
      recorderRef.current = null;
      if (alive.current && generation === epoch.current) { setError(tPractice.errors.unknown); setPhase({ kind: "idle" }); }
      return;
    }
    // The recorder is spent either way: it must not be reused for the next take.
    recorderRef.current = null;
    if (!alive.current || generation !== epoch.current) return;
    if (!result) { setError(tPractice.errors.unknown); setPhase({ kind: "idle" }); return; }

    setRecording(result);
    setPlaybackUrl(URL.createObjectURL(result.blob));
    // The learner reviews and may edit before anything is sent.
    setDraft(finalized);
    setPhase({ kind: "reviewing" });
    onBusyChange(false);
  }, [onBusyChange, stopTimers, tPractice.errors.unknown, transcript]);

  const startRecording = useCallback(async () => {
    if (!supported || busy) return;
    const generation = epoch.current;
    setError("");
    setPhase({ kind: "starting" });

    // Account-level rule preserved from Practice on Your Own (§34): starting
    // Practice takes Live Partner presence offline; a live call wins and the
    // server refuses with 409 in_call. Mic exclusivity is a server decision.
    try {
      const presence = await fetch("/api/live-partner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "practice_started" }),
        signal: AbortSignal.timeout(5_000),
      });
      if (presence.status === 409) {
        if (alive.current && generation === epoch.current) { setError(tPractice.errors.liveCallActive); setPhase({ kind: "idle" }); }
        return;
      }
    } catch { /* presence is best-effort; the server sweep removes stale rows */ }

    try {
      if (!alive.current || generation !== epoch.current) return;
      const acquisition = new AbortController();
      microphoneRequest.current = acquisition;
      const recorder = await createRecorder({ signal: acquisition.signal });
      if (microphoneRequest.current === acquisition) microphoneRequest.current = null;
      if (!alive.current || generation !== epoch.current) { recorder.cancel(); return; }
      recorderRef.current = recorder;
      await recorder.start();
      if (!alive.current || generation !== epoch.current) { recorder.cancel(); return; }

      // Recognition starts alongside the recording, so the live transcript
      // covers the same audio the learner is producing.
      transcript.start();

      const startedAt = Date.now();
      setElapsed(0);
      setPhase({ kind: "recording", startedAt, limitSeconds: answerSeconds });
      onBusyChange(true);
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAt;
        setElapsed(ms);
        if (ms >= answerSeconds * 1000) {
          stopTimers();
          void finishRecording();
        }
      }, 200);
    } catch (err) {
      if (!alive.current || generation !== epoch.current) return;
      recorderRef.current?.cancel(); recorderRef.current = null;
      setError(err instanceof RecorderError ? tPractice.errors[err.code] : tPractice.errors.unknown);
      setPhase({ kind: "idle" });
      onBusyChange(false);
    }
  }, [answerSeconds, busy, finishRecording, onBusyChange, stopTimers, supported, tPractice.errors, transcript]);

  const beginPreparation = useCallback(() => {
    if (prepSeconds <= 0) { void startRecording(); return; }
    const endsAt = Date.now() + prepSeconds * 1000;
    setPrepRemaining(prepSeconds);
    setPhase({ kind: "prepping", endsAt });
    prepRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setPrepRemaining(remaining);
      if (remaining <= 0) {
        if (prepRef.current) { clearInterval(prepRef.current); prepRef.current = null; }
        // Preparation ends and the learner starts the long turn — the microphone
        // never opens during preparation, on their behalf or otherwise.
        setPhase({ kind: "idle" });
      }
    }, 250);
  }, [prepSeconds, startRecording]);

  /** Discards everything from this take. Neither the audio nor the text is sent. */
  const discardTake = useCallback((next: "idle" | "prepping") => {
    invalidate();
    stopTimers();
    upload.current?.cancel(); upload.current = null;
    microphoneRequest.current?.abort(); microphoneRequest.current = null;
    recorderRef.current?.cancel(); recorderRef.current = null;
    // Discarding releases the recognizer entirely: nothing from this take can be
    // recovered and sent later.
    transcript.discard();
    setRecording(null);
    setPlaybackUrl(null);
    setDraft("");
    setRawTranscript("");
    setElapsed(0);
    setError("");
    setAttemptId(null);
    onBusyChange(false);
    if (next === "prepping") beginPreparation();
    else setPhase({ kind: "idle" });
  }, [beginPreparation, invalidate, onBusyChange, stopTimers, transcript]);

  // ---- sending -----------------------------------------------------------

  const send = useCallback(async () => {
    if (submitting.current || !recording || !prompt) return;
    const bodyText = draft.trim();
    submitting.current = true;
    const generation = epoch.current;
    setError("");
    try {
      // The learner may have cleared the transcript; sending audio alone is still
      // a valid answer, it simply gets no language feedback.
      const file = new File(
        [recording.blob],
        `speaking-${Date.now()}.${extensionForMime(recording.mimeType)}`,
        { type: recording.mimeType },
      );

      const pre = preflight(file, "audio");
      if (!pre.ok) {
        setError(pre.error.startsWith("file_too_large:") ? tPractice.tooLarge.replace("{max}", pre.error.split(":")[1]!) : tPractice.unsupported);
        return;
      }

      // The attempt is created only now, at the moment of sending. A take that is
      // discarded never leaves a stray `recording` row behind.
      const created = await request<{ attempt: { id: string } }>("/api/speaking/attempts", {
        body: {
          promptId: item.promptId,
          part: item.part,
          // Server-verified lineage: the route only accepts a retry of the
          // learner's own submitted attempt.
          ...(retryOfAttemptId ? { retryOfAttemptId } : {}),
        },
      });
      if (!created) return;
      if (!created.ok) { setError(apiErrorMessage(created.error, created.status, dict)); return; }
      const newAttemptId = created.data.attempt.id;
      setAttemptId(newAttemptId);

      setPhase({ kind: "uploading", progress: 0, state: "queued" });
      const handle = startUpload(file, {
        purpose: "speaking_recording",
        speakingAttemptId: newAttemptId,
        onProgress: (progress) => {
          if (alive.current && generation === epoch.current) setPhase({ kind: "uploading", progress, state: "uploading" });
        },
      });
      upload.current = handle;
      const outcome = await handle.promise;
      upload.current = null;
      if (!alive.current || generation !== epoch.current) return;
      if (!outcome.ok) {
        setPhase({ kind: "reviewing" });
        setError(outcome.error === "cancelled" ? tPractice.uploadFailed : uploadErrorMessage(outcome.failure, dict.uploadErrors));
        return;
      }

      setPhase({ kind: "uploading", progress: 100, state: "finalizing" });
      const attach = await request(`/api/speaking/attempts/${newAttemptId}`, {
        method: "PATCH",
        body: { uploadId: outcome.uploadId, durationMs: recording.durationMs },
      });
      if (!attach) return;
      if (!attach.ok) { setPhase({ kind: "reviewing" }); setError(apiErrorMessage(attach.error, attach.status, dict)); return; }

      setPhase({ kind: "sending" });
      const result = await request<{
        transcriptOrigin: string | null;
        transcriptEdited: boolean;
        evaluated: boolean;
        evaluation: LearnerEvaluation | null;
      }>(`/api/speaking/attempts/${newAttemptId}/submit`, {
        body: {
          durationMs: recording.durationMs,
          // Both strings: the server derives `edited` by comparing them, so a
          // client cannot assert its own provenance.
          browserTranscript: bodyText,
          browserTranscriptRaw: rawTranscript,
        },
        timeoutMs: 90_000,
      });
      if (!result) return;
      if (!result.ok) { setPhase({ kind: "reviewing" }); setError(apiErrorMessage(result.error, result.status, dict)); return; }

      // Bind the answer to its question. The cursor is the server's, so the
      // learner's position can never be advanced by a client.
      const bound = await request(`/api/speaking/ai/sessions/${sessionId}/items/${item.id}/complete`, {
        body: { attemptId: newAttemptId },
      });
      if (!bound) return;
      if (!bound.ok) {
        // The answer is safely stored even when binding fails; say so plainly
        // rather than implying the work was lost.
        setError(apiErrorMessage(bound.error, bound.status, dict));
      }

      onSent(newAttemptId, result.data.evaluation, {
        // Prefer the server's derivation; fall back to the local comparison only
        // if an older payload omits it.
        transcriptEdited: typeof result.data.transcriptEdited === "boolean" ? result.data.transcriptEdited : rawTranscript.trim() !== bodyText,
        transcriptSent: bodyText.length > 0,
      });
    } catch {
      if (alive.current && generation === epoch.current) { setError(tPractice.errors.unknown); setPhase({ kind: "reviewing" }); }
    } finally {
      submitting.current = false;
    }
  }, [dict, draft, item.id, item.part, item.promptId, onSent, prompt, rawTranscript, recording, request, retryOfAttemptId, sessionId, tPractice.errors.unknown, tPractice.tooLarge, tPractice.unsupported, tPractice.uploadFailed]);

  // ---- render ------------------------------------------------------------

  if (!supported) {
    return (
      <Card className="flex flex-col gap-2" data-ai-composer="unsupported">
        <p className="text-sm font-medium text-ink-900">{tPractice.unsupportedTitle}</p>
        <p className="text-sm text-ink-500">{tPractice.unsupportedBody}</p>
      </Card>
    );
  }

  const stt = transcript.state;
  const liveFinal = stt.kind === "listening" ? stt.final : "";
  const liveInterim = stt.kind === "listening" ? stt.interim : "";
  const sttErrorCode = stt.kind === "error" ? stt.code : null;
  const sttUnsupported = transcript.mounted && !transcript.supported;

  return (
    <Card className="flex flex-col gap-4" data-ai-composer={phase.kind} data-ai-item={item.id}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span className="badge" data-ai-question-position>
          {t.questionOf.replace("{n}", String(item.questionPosition)).replace("{total}", String(item.clusterSize))}
        </span>
        <span>{answerSeconds}s</span>
        {isCueCard && <span>{t.prepSeconds.replace("{n}", String(prepSeconds))}</span>}
      </div>

      {prompt ? (
        <div className="flex flex-col gap-2">
          <p className="whitespace-pre-line text-base text-ink-900">{prompt.promptText}</p>
          {isCueCard && prompt.cueCard && (
            <div className="rounded-md border border-ink-100 bg-paper-sunken p-3" data-ai-cue-card>
              <p className="text-xs font-medium text-ink-500">{tPractice.cueCard}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{prompt.cueCard}</p>
            </div>
          )}
        </div>
      ) : (
        // The prompt row was deleted after the plan was written. The plan stands
        // and the question is reported as unavailable — never replaced with
        // invented text.
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30" data-ai-prompt-missing>
          {t.promptUnavailable}
        </p>
      )}

      {phase.kind === "prepping" && (
        <div className="flex flex-col gap-2" data-ai-prep>
          <p className="text-sm font-medium text-ink-900">{t.preparing.replace("{n}", String(prepRemaining))}</p>
          <p className="text-xs text-ink-500">{t.micOffDuringPrep}</p>
        </div>
      )}

      {phase.kind === "recording" && (
        <div className="flex flex-col gap-3" data-ai-recording>
          <p className="font-mono text-2xl text-ink-900" data-ai-elapsed>{formatDuration(elapsed)}</p>
          {/* Live transcript, clearly attributed. This is the browser's own
              recognition: not a server transcription, and not pronunciation
              assessment. */}
          <div className="flex flex-col gap-1" data-ai-live-transcript>
            <p className="text-xs font-medium text-ink-500">{t.liveTranscriptLabel}</p>
            {sttUnsupported ? (
              <p className="text-xs text-ink-500" data-ai-stt="unsupported">{t.liveTranscriptUnsupported}</p>
            ) : (
              <p className="min-h-12 rounded-md border border-ink-100 bg-paper-sunken p-3 text-sm text-ink-700" aria-live="polite">
                {liveFinal}
                {liveInterim && <span className="text-ink-300"> {liveInterim}</span>}
                {!liveFinal && !liveInterim && <span className="text-ink-300">{t.liveTranscriptWaiting}</span>}
              </p>
            )}
            {sttErrorCode && (
              <p className="text-xs text-band-warn" data-ai-stt-error={sttErrorCode}>
                {t.sttErrors[sttErrorCode]}
              </p>
            )}
          </div>
        </div>
      )}

      {phase.kind === "reviewing" && recording && (
        <div className="flex flex-col gap-3" data-ai-review>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-ink-500">{t.yourRecording}</p>
            {playbackUrl && <audio className="w-full" controls src={playbackUrl} data-ai-playback preload="metadata" />}
            <p className="text-xs text-ink-300">{formatDuration(recording.durationMs)} · {formatBytes(recording.blob.size)}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-500" htmlFor={`transcript-${item.id}`}>
              {t.transcriptLabel}
            </label>
            <textarea
              id={`transcript-${item.id}`}
              className="min-h-32 w-full rounded-md border border-ink-200 bg-paper p-3 text-sm text-ink-900"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t.transcriptPlaceholder}
              data-ai-transcript-input
            />
            <p className="text-xs text-ink-300">
              {sttUnsupported ? t.transcriptNoBrowserStt : t.transcriptHint}
            </p>
          </div>

          <p className="rounded-md border border-ink-100 bg-paper-sunken p-3 text-xs text-ink-500" data-ai-not-sent>
            {t.notSentYet}
          </p>
        </div>
      )}

      {(phase.kind === "uploading" || phase.kind === "sending") && (
        <div className="flex flex-col gap-2" role="status" data-ai-sending={phase.kind}>
          <p className="text-sm font-medium text-ink-900">{phase.kind === "sending" ? t.evaluating : t.sending}</p>
          {phase.kind === "uploading" && (
            <p className="text-xs text-ink-500">
              {phase.state === "finalizing" ? tPractice.finalizing : `${tPractice.uploading} ${phase.progress}%`}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-band-warn" role="alert" data-ai-error>{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {phase.kind === "idle" && (
          <Button onClick={beginPreparation} disabled={busy || !prompt} data-ai-start-answer>{t.startAnswer}</Button>
        )}
        {phase.kind === "prepping" && (
          <Button onClick={() => { stopTimers(); setPhase({ kind: "idle" }); void startRecording(); }} data-ai-start-now>
            {t.startAnswer}
          </Button>
        )}
        {phase.kind === "starting" && <Button disabled>{tPractice.preparing}</Button>}
        {phase.kind === "recording" && (
          <Button onClick={() => void finishRecording()} data-ai-stop>{tPractice.stop}</Button>
        )}
        {phase.kind === "reviewing" && (
          <>
            <Button onClick={() => void send()} disabled={submitting.current} data-ai-send>{t.sendToRiwi}</Button>
            <Button variant="secondary" onClick={() => { discardTake("idle"); void startRecording(); }} data-ai-rerecord>
              {t.reRecord}
            </Button>
            <Button variant="ghost" onClick={() => discardTake("idle")} data-ai-clear>{t.clear}</Button>
          </>
        )}
        {phase.kind === "error" && (
          <Button onClick={() => setPhase({ kind: "idle" })}>{tPractice.practiceAgain}</Button>
        )}
      </div>
    </Card>
  );
}
