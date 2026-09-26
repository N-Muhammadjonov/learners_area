"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { preflight, startUpload, type UploadState } from "@/lib/uploads/client";
import { formatBytes } from "@/lib/uploads/format";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";

type Prompt = typeof speakingPrompts.$inferSelect;

type Phase =
  | { kind: "idle" }
  | { kind: "prepping"; endsAt: number }
  | { kind: "recording"; startedAt: number; limitSeconds: number }
  | { kind: "reviewing" }
  | { kind: "uploading"; progress: number; state: UploadState }
  | { kind: "submitting" }
  | { kind: "done"; attemptId: string };

/**
 * The Speaking practice vertical slice: pick a prompt → prepare → record →
 * upload the recording straight to R2 → submit → it appears in history.
 *
 * Honesty rules held here:
 *  - the microphone indicator is released the moment recording stops
 *  - elapsed time and byte size are measured, never estimated
 *  - there is no transcript and no band score shown, because no
 *    SpeechToTextService or evaluation provider is configured — the UI says so
 *    rather than inventing analysis
 */
export function PracticeStudio({
  dict,
  prompts,
}: {
  dict: Dictionary;
  prompts: Prompt[];
}) {
  const router = useRouter();
  const t = dict.speakingPractice;

  const [prompt, setPrompt] = useState<Prompt | null>(prompts[0] ?? null);
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

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  // Revoke the local playback URL when it is replaced or the component unmounts.
  useEffect(() => {
    if (!playbackUrl) return;
    return () => URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  async function beginAttempt() {
    setError("");
    setRecording(null);
    setPlaybackUrl(null);
    setElapsed(0);

    const res = await fetch("/api/speaking/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptId: prompt?.id ?? null, part: prompt?.part ?? "general" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(data.error ?? "could_not_start"));
      return;
    }
    const createdAttemptId: string = data.attempt.id;
    setAttemptId(createdAttemptId);

    const prepMs = (prompt?.prepSeconds ?? 0) * 1000;
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
    setError("");
    try {
      const recorder = await createRecorder();
      recorderRef.current = recorder;
      await recorder.start();
      const startedAt = Date.now();
      const limitSeconds = prompt?.answerSeconds ?? 120;
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
      if (err instanceof RecorderError) setError(t.errors[err.code]);
      else setError(t.errors.unknown);
      setPhase({ kind: "idle" });
    }
  }

  async function finishRecording() {
    stopTimer();
    const recorder = recorderRef.current;
    if (!recorder) return;
    const result = await recorder.stop();
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
    stopTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(null);
    setPlaybackUrl(null);
    setPhase({ kind: "idle" });
    if (attemptId) {
      void fetch(`/api/speaking/attempts/${attemptId}`, { method: "DELETE" });
      setAttemptId(null);
    }
  }

  async function submit() {
    if (!recording || !attemptId) return;
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
      onProgress: (progress) => setPhase({ kind: "uploading", progress, state: "uploading" }),
    });
    // The attempt id scopes the upload; pass it through the intent request.
    const outcome = await handle.promise;
    if (!outcome.ok) {
      setPhase({ kind: "reviewing" });
      setError(t.uploadFailed);
      return;
    }

    setPhase({ kind: "uploading", progress: 100, state: "finalizing" });

    const attach = await fetch(`/api/speaking/attempts/${attemptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: outcome.uploadId, durationMs: recording.durationMs }),
    });
    if (!attach.ok) {
      setPhase({ kind: "reviewing" });
      const data = await attach.json().catch(() => ({}));
      setError(String(data.error ?? t.uploadFailed));
      return;
    }

    setPhase({ kind: "submitting" });
    const submitRes = await fetch(`/api/speaking/attempts/${attemptId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: recording.durationMs }),
    });
    if (!submitRes.ok) {
      setPhase({ kind: "reviewing" });
      const data = await submitRes.json().catch(() => ({}));
      setError(String(data.error ?? t.uploadFailed));
      return;
    }

    setPhase({ kind: "done", attemptId });
    router.refresh();
  }

  if (!supported) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink-900">{t.unsupportedTitle}</p>
        <p className="text-sm text-ink-500">{t.unsupportedBody}</p>
      </Card>
    );
  }

  const isBusy = phase.kind === "prepping" || phase.kind === "recording" || phase.kind === "uploading" || phase.kind === "submitting";

  return (
    <div className="flex flex-col gap-4">
      {/* Prompt picker */}
      <div className="flex flex-col gap-2">
        <label htmlFor="practice-prompt" className="text-sm font-medium text-ink-700">
          {t.promptLabel}
        </label>
        <select
          id="practice-prompt"
          className="input"
          value={prompt?.id ?? ""}
          disabled={isBusy}
          onChange={(e) => setPrompt(prompts.find((p) => p.id === e.target.value) ?? null)}
        >
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {t.part[p.part]} · {p.promptText.slice(0, 70)}
              {p.promptText.length > 70 ? "…" : ""}
            </option>
          ))}
        </select>
      </div>

      {prompt && (
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
            <span className="badge">{t.part[prompt.part]}</span>
            <span>
              {t.prep} {prompt.prepSeconds}s · {t.answer} {prompt.answerSeconds}s
            </span>
          </div>
          <p className="whitespace-pre-line text-sm text-ink-900">{prompt.promptText}</p>
          {prompt.cueCard && (
            <div className="rounded-sm bg-paper-sunken p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-300">{t.cueCard}</p>
              <p className="whitespace-pre-line text-sm text-ink-700">{prompt.cueCard}</p>
            </div>
          )}
        </Card>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {phase.kind === "idle" && (
          <Button data-speak-start onClick={() => void beginAttempt()}>{t.start}</Button>
        )}

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
            <Button variant="ghost" onClick={() => router.push("/speaking/history")}>
              {t.viewHistory}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
