"use client";

import { uploadErrorMessage } from "@/lib/uploads/errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
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
import { preflight, startUpload, type UploadState, type UploadHandle } from "@/lib/uploads/client";
import { formatBytes } from "@/lib/uploads/format";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { apiErrorMessage } from "@/lib/api-error-message";

type Prompt = typeof speakingPrompts.$inferSelect;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "prepping"; endsAt: number }
  | { kind: "recording"; startedAt: number; limitSeconds: number }
  | { kind: "reviewing" }
  | { kind: "uploading"; progress: number; state: UploadState }
  | { kind: "submitting" }
  | { kind: "done"; attemptId: string };

/**
 * One question's own recorder: prepare → record → play back / re-record →
 * upload straight to R2 → submit. Every question on a topic renders its own
 * instance, so recordings and drafts never leak between questions.
 *
 * Honesty rules held here:
 *  - the microphone is released the moment recording stops, and on unmount
 *  - elapsed time and byte size are measured, never estimated
 *  - no transcript or band is shown here; the server-side submit pipeline
 *    transcribes/evaluates only when a real provider is configured
 */
export function QuestionRecorder({
  dict,
  prompt,
  index,
  lockedBy,
  onBusyChange,
  onSubmitted,
}: {
  dict: Dictionary;
  prompt: Prompt;
  /** 1-based position in the topic, shown as the question number. */
  index: number;
  /** Id of another question whose recorder currently holds the microphone. */
  lockedBy: string | null;
  onBusyChange: (promptId: string, busy: boolean) => void;
  /** Called once the attempt is stored and submitted (AI examiner moves on). */
  onSubmitted?: (attemptId: string) => void;
}) {
  const router = useRouter();
  const { navigate } = useInstantInteraction();
  const t = dict.speakingPractice;
  const request = useScopedRequest();
  const starting = useRef(false);
  const submitting = useRef(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const invalidate = useCallback(() => {epoch.current++;}, []);
  const upload = useRef<UploadHandle | null>(null);
  const microphoneRequest = useRef<AbortController | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const prepSeconds = prompt.part === "part2" ? 60 : prompt.prepSeconds;
  const answerSeconds = prompt.part === "part2" ? 120 : prompt.answerSeconds;

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState<{ blob: Blob; mimeType: string; durationMs: number; size: number } | null>(
    null
  );
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  const recorderRef = useRef<Recorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supported = isRecordingSupported();

  // Only one question may hold the microphone at a time; the parent learns
  // when this recorder starts or stops needing it.
  const busy = phase.kind === "starting" || phase.kind === "prepping" || phase.kind === "recording" || phase.kind === "uploading" || phase.kind === "submitting";
  useEffect(() => { onBusyChange(prompt.id, busy); }, [busy, onBusyChange, prompt.id]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Leaving the topic (unmount) releases the microphone and the timer.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; invalidate(); upload.current?.cancel(); upload.current = null;
      microphoneRequest.current?.abort(); microphoneRequest.current = null;
      stopTimer(); recorderRef.current?.cancel(); recorderRef.current = null;
      busyCallback.current(prompt.id, false);
    };
  }, [prompt.id, stopTimer, invalidate]);

  // Revoke the local playback URL when it is replaced or the component unmounts.
  useEffect(() => {
    if (!playbackUrl) return;
    return () => URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  async function beginAttempt() {
    if (starting.current || (lockedBy !== null && lockedBy !== prompt.id)) return;
    starting.current = true;
    setPhase({kind: "starting"});
    setError("");
    setRecording(null);
    setPlaybackUrl(null);
    setElapsed(0);

    const res = await request<{attempt: {id: string}}>("/api/speaking/attempts", {body: {promptId: prompt.id, part: prompt.part}});
    starting.current = false;
    if (!res) return;
    if (!res.ok) {setError(apiErrorMessage(res.error, res.status, dict)); setPhase({kind: "idle"}); return;}
    if (!res.data?.attempt?.id) {setError(t.errors.unknown); setPhase({kind: "idle"}); return;}
    const createdAttemptId = res.data.attempt.id;
    setAttemptId(createdAttemptId);

    const prepMs = prepSeconds * 1000;
    if (prepMs > 0) {
      const endsAt = Date.now() + prepMs;
      setPhase({ kind: "prepping", endsAt });
      timerRef.current = setInterval(() => {
        if (Date.now() >= endsAt) {
          stopTimer();
          void startRecording(createdAttemptId);
        }
      }, 200);
    } else {
      await startRecording(createdAttemptId);
    }
  }

  /**
   * `id` arrives as an argument rather than being read from state.
   *
   * A component that has just called `setState` still sees the *previous* value
   * inside the same handler, so a prompt with no preparation time — every Part 1
   * question — used to create an attempt on the server and then return here on a
   * null id: the student pressed "start" and the screen never changed. The
   * argument makes the recording path independent of React's render timing.
   */
  async function startRecording(id: string | null = attemptId) {
    if (!id) return;
    const generation = epoch.current;
    setError("");
    // Account-level rule: starting Practice takes Live Partner presence OFFLINE
    // (all tabs) and cancels invites; it never ends a live call — the server
    // refuses with 409 in_call and the recording does not start.
    try {
      const presence = await fetch("/api/live-partner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "practice_started" }), signal: AbortSignal.timeout(5_000) });
      if (presence.status === 409) { if (alive.current && generation === epoch.current) {setError(t.errors.liveCallActive); setPhase({kind: "idle"});} return; }
    } catch { /* presence is best-effort; the server sweep removes stale AVAILABLE rows */ }
    try {
      if (!alive.current || generation !== epoch.current) return;
      const acquisition = new AbortController();
      microphoneRequest.current = acquisition;
      const recorder = await createRecorder({signal: acquisition.signal});
      if (microphoneRequest.current === acquisition) microphoneRequest.current = null;
      if (!alive.current || generation !== epoch.current) {recorder.cancel(); return;}
      recorderRef.current = recorder;
      await recorder.start();
      if (!alive.current || generation !== epoch.current) {recorder.cancel(); return;}
      const startedAt = Date.now();
      const limitSeconds = answerSeconds;
      setPhase({ kind: "recording", startedAt, limitSeconds });
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAt;
        setElapsed(ms);
        if (ms >= limitSeconds * 1000) {
          stopTimer();
          void finishRecording();
        }
      }, 200);
    } catch (err) {
      if (!alive.current || generation !== epoch.current) return;
      recorderRef.current?.cancel(); recorderRef.current = null;
      if (err instanceof RecorderError) setError(t.errors[err.code]);
      else setError(t.errors.unknown);
      setPhase({ kind: "idle" });
    }
  }

  async function finishRecording() {
    stopTimer();
    const recorder = recorderRef.current;
    if (!recorder) return;
    const generation = epoch.current;
    let result;
    try {result = await recorder.stop();} catch {recorder.cancel(); if (alive.current && generation === epoch.current) {setError(t.errors.unknown); setPhase({kind: "idle"});} return;}
    if (!alive.current || generation !== epoch.current) return;
    recorderRef.current = null;
    if (!result) {
      setError(t.errors.unknown);
      setPhase({ kind: "idle" });
      return;
    }
    setRecording(result);
    setPlaybackUrl(URL.createObjectURL(result.blob));
    setPhase({ kind: "reviewing" });
  }

  function discard() {
    invalidate(); upload.current?.cancel(); upload.current = null;
    microphoneRequest.current?.abort(); microphoneRequest.current = null;
    stopTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(null);
    setPlaybackUrl(null);
    setPhase({ kind: "idle" });
    if (attemptId) {
      void fetch(`/api/speaking/attempts/${attemptId}`, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
      setAttemptId(null);
    }
  }

  async function submit() {
    if (!recording || !attemptId || submitting.current) return;
    submitting.current = true;
    const generation = epoch.current;
    try {
    setError("");

    // A Blob has no name, so give it one before validating — the extension is
    // what the upload policy keys off.
    const file = new File(
      [recording.blob],
      `speaking-${Date.now()}.${extensionForMime(recording.mimeType)}`,
      { type: recording.mimeType }
    );

    const pre = preflight(file, "audio");
    if (!pre.ok) {
      setError(
        pre.error.startsWith("file_too_large:")
          ? t.tooLarge.replace("{max}", pre.error.split(":")[1]!)
          : t.unsupported
      );
      return;
    }

    setPhase({ kind: "uploading", progress: 0, state: "queued" });

    const handle = startUpload(file, {
      purpose: "speaking_recording",
      speakingAttemptId: attemptId,
      onProgress: (progress) => {if (alive.current && generation === epoch.current) setPhase({ kind: "uploading", progress, state: "uploading" });},
    });
    // The attempt id scopes the upload; pass it through the intent request.
    upload.current = handle;
    const outcome = await handle.promise;
    upload.current = null;
    if (!alive.current || generation !== epoch.current) return;
    if (!outcome.ok) {
      setPhase({ kind: "reviewing" });
      setError(outcome.error === "cancelled" ? t.uploadFailed : uploadErrorMessage(outcome.failure, dict.uploadErrors));
      return;
    }

    setPhase({ kind: "uploading", progress: 100, state: "finalizing" });

    const attach = await request(`/api/speaking/attempts/${attemptId}`, {method: "PATCH", body: {uploadId: outcome.uploadId, durationMs: recording.durationMs}});
    if (!attach) return;
    if (!attach.ok) {setPhase({kind: "reviewing"}); setError(apiErrorMessage(attach.error, attach.status, dict)); return;}
    setPhase({kind: "submitting"});
    const result = await request(`/api/speaking/attempts/${attemptId}/submit`, {body: {durationMs: recording.durationMs}, timeoutMs: 60_000});
    if (!result) return;
    if (!result.ok) {setPhase({kind: "reviewing"}); setError(apiErrorMessage(result.error, result.status, dict)); return;}
    setPhase({ kind: "done", attemptId });
    onSubmitted?.(attemptId);
    router.refresh();
    } catch {
      if (alive.current && generation === epoch.current) {setError(t.errors.unknown); setPhase({kind: "reviewing"});}
    } finally {submitting.current = false;}
  }

  if (!supported) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink-900">{t.unsupportedTitle}</p>
        <p className="text-sm text-ink-500">{t.unsupportedBody}</p>
      </Card>
    );
  }


  return (
    <Card className="flex flex-col gap-4" data-question-recorder={prompt.id} data-question-phase={phase.kind}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <span className="badge">{t.questionNumber.replace("{n}", String(index))}</span>
          <span>
            {prepSeconds > 0 ? `${t.prep} ${prepSeconds}s · ` : ""}{t.answer} {answerSeconds}s
          </span>
        </div>
        <p className="whitespace-pre-line text-base text-ink-900">{prompt.promptText}</p>
        {prompt.cueCard && (
          <div className="rounded-sm bg-paper-sunken p-3" data-speak-cue-card>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t.cueCard}</p>
            <p className="whitespace-pre-line text-sm text-ink-700">{prompt.cueCard}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {phase.kind === "idle" && (
          <Button data-speak-start disabled={lockedBy !== null && lockedBy !== prompt.id} onClick={() => void beginAttempt()}>{t.recordAnswer}</Button>
        )}

        {phase.kind === "starting" && <span role="status">{dict.common.loading}</span>}
        {phase.kind === "prepping" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-700">
              {t.preparing} {formatDuration(Math.max(0, phase.endsAt - Date.now()))}
            </span>
            <Button variant="ghost" onClick={discard}>
              {dict.common.cancel}
            </Button>
          </div>
        )}

        {phase.kind === "recording" && (
          <div className="flex flex-wrap items-center gap-3">
            <span data-speak-recording className="flex items-center gap-2 text-sm font-medium text-band-bad">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-band-bad" />
              {t.recording} {formatDuration(elapsed)} / {formatDuration(phase.limitSeconds * 1000)}
            </span>
            <Button data-speak-stop variant="secondary" onClick={() => void finishRecording()}>
              {t.stop}
            </Button>
            <Button variant="ghost" onClick={discard}>
              {dict.common.cancel}
            </Button>
          </div>
        )}

        {phase.kind === "reviewing" && recording && (
          <>
            {playbackUrl && <audio controls src={playbackUrl} className="w-full" preload="metadata" />}
            <div
              data-speak-review
              data-speak-size={recording.size}
              data-speak-duration-ms={recording.durationMs}
              className="flex flex-wrap items-center gap-3 text-xs text-ink-300"
            >
              <span>{formatBytes(recording.size)}</span>
              <span>{formatDuration(recording.durationMs)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button data-speak-submit onClick={() => void submit()}>{t.submit}</Button>
              <Button variant="ghost" onClick={discard}>
                {t.recordAgain}
              </Button>
            </div>
          </>
        )}

        {phase.kind === "uploading" && (
          <div className="flex w-full max-w-md items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100"
              role="progressbar"
              aria-valuenow={phase.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t.uploading}
            >
              <div className="h-full bg-signal-500" style={{ width: `${phase.progress}%` }} />
            </div>
            <span className="w-40 shrink-0 text-xs text-ink-300">
              {phase.state === "finalizing" ? t.finalizing : t.uploading} {phase.progress}%
            </span>
          </div>
        )}

        {phase.kind === "submitting" && <span className="text-sm text-ink-500">{t.submitting}</span>}
      </div>

      {error && <p className="text-sm text-band-bad">{error}</p>}

      {phase.kind === "done" && (
        <Card data-speak-done className="flex flex-col gap-2">
          <p className="text-sm font-medium text-band-good">{t.saved}</p>
          <p className="text-sm text-ink-500">{t.savedBody}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setPhase({ kind: "idle" }); setAttemptId(null); }}>
              {t.practiceAgain}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/speaking/history")}>
              {t.viewHistory}
            </Button>
          </div>
        </Card>
      )}
    </Card>
  );
}
