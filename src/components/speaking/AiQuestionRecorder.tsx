"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createRecorder, extensionForMime, formatDuration, isRecordingSupported, type Recorder } from "@/lib/audio/recorder";
import { preflight, startUpload, type UploadHandle } from "@/lib/uploads/client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useBrowserSpeechRecognition } from "./useBrowserSpeechRecognition";

type Prompt = typeof speakingPrompts.$inferSelect;
type Evaluation = {
  id: string; checkedBy: string; fallbackUsed: boolean; overallEstimate: number | null;
  criteria: Array<{ key: string; label: string; band: number | null; limited?: boolean; note?: string | null }>;
  strengths: string[]; weaknesses: string[];
  issues: Array<{ message: string; excerpt?: string | null; suggestion?: string | null }>;
  nextActions: string[];
};
type Recording = { blob: Blob; mimeType: string; durationMs: number; size: number };
type Phase = "idle" | "preparing" | "starting" | "recording" | "stopping" | "review" | "uploading" | "evaluating" | "feedback";

export function AiQuestionRecorder({ dict, prompt, sessionId, itemId, index, retryOfAttemptId, onEvaluated, onNext }: {
  dict: Dictionary; prompt: Prompt; sessionId: string; itemId: string; index: number;
  retryOfAttemptId?: string | null;
  onEvaluated: (attemptId: string) => void; onNext: () => void;
}) {
  const t = dict.speakingAi;
  const practice = dict.speakingPractice;
  const request = useScopedRequest();
  const stt = useBrowserSpeechRecognition("en-US");
  const resetStt = stt.reset;
  const [phase, setPhase] = useState<Phase>("idle");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [rawTranscript, setRawTranscript] = useState("");
  const [transcript, setTranscript] = useState("");
  const [edited, setEdited] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [prepLeft, setPrepLeft] = useState(60);
  const [error, setError] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [submissionAttempted, setSubmissionAttempted] = useState(false);
  const recorderRef = useRef<Recorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadRef = useRef<UploadHandle | null>(null);
  const submittingRef = useRef(false);
  const recordingAttachedRef = useRef(false);
  const retryParentRef = useRef<string | null>(retryOfAttemptId ?? null);
  const alive = useRef(true);
  const generationRef = useRef(0);
  const acquiringRef = useRef(false);
  const stoppingRef = useRef(false);
  const microphoneRequest = useRef<AbortController | null>(null);
  const answerLimit = prompt.part === "part2" ? 120 : prompt.answerSeconds;

  const stopTimer = useCallback(() => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; }, []);
  const cleanup = useCallback(() => {
    generationRef.current++; acquiringRef.current = false; stoppingRef.current = false;
    microphoneRequest.current?.abort(); microphoneRequest.current = null;
    stopTimer(); uploadRef.current?.cancel(); uploadRef.current = null;
    recorderRef.current?.cancel(); recorderRef.current = null; resetStt();
  }, [stopTimer, resetStt]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cleanup(); }; }, [cleanup]);
  useEffect(() => { if (!playbackUrl) return; return () => URL.revokeObjectURL(playbackUrl); }, [playbackUrl]);
  useEffect(() => {
    if (phase === "recording") setTranscript(stt.liveTranscript);
  }, [phase, stt.liveTranscript]);

  async function acquireAndRecord() {
    if (acquiringRef.current || recorderRef.current || phase === "stopping") return;
    acquiringRef.current = true;
    const generation = generationRef.current;
    const current = () => alive.current && generationRef.current === generation;
    stopTimer(); setPhase("starting"); setError(""); setElapsed(0);
    try {
      try {
        const presence = await fetch("/api/live-partner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "practice_started" }), signal: AbortSignal.timeout(5000) });
        if (!current()) return;
        if (presence.status === 409) { setError(practice.errors.liveCallActive); setPhase("idle"); return; }
      } catch { /* best-effort presence update; active calls still return 409 when reachable */ }

      if (!current()) return;
      let id = attemptId;
      if (!id) {
        const created = await request<{ attempt: { id: string } }>("/api/speaking/attempts", { body: {
          promptId: prompt.id, part: prompt.part, sessionId, sessionItemId: itemId, ...(retryParentRef.current ? { retryOfAttemptId: retryParentRef.current } : {}),
        }});
        if (!current()) return;
        if (!created) { setError(practice.errors.unknown); setPhase("idle"); return; }
        if (!created.ok) { setError(apiErrorMessage(created.error, created.status, dict)); setPhase("idle"); return; }
        if (!created.data?.attempt.id) { setError(practice.errors.unknown); setPhase("idle"); return; }
        id = created.data.attempt.id; setAttemptId(id);
      }
      try {
        const acquisition = new AbortController();
        microphoneRequest.current = acquisition;
        const recorder = await createRecorder({ signal: acquisition.signal });
        if (microphoneRequest.current === acquisition) microphoneRequest.current = null;
        if (!current()) { recorder.cancel(); return; }
        recorderRef.current = recorder;
        await recorder.start();
        if (!current()) { recorder.cancel(); return; }
        stt.reset();
        stt.start(); // Optional: recording remains valid if recognition is unsupported/fails.
        const startedAt = Date.now();
        setPhase("recording");
        timerRef.current = setInterval(() => {
          const ms = Date.now() - startedAt;
          setElapsed(ms);
          if (ms >= answerLimit * 1000) void stopRecording();
        }, 200);
      } catch {
        if (!current()) return;
        microphoneRequest.current = null;
        stt.reset(); recorderRef.current?.cancel(); recorderRef.current = null;
        setError(practice.errors.unknown); setPhase("idle");
      }
    } finally { if (current()) acquiringRef.current = false; }
  }

  function begin() {
    if (timerRef.current || acquiringRef.current || recorderRef.current) return;
    if (prompt.part !== "part2") { void acquireAndRecord(); return; }
    setPhase("preparing"); setPrepLeft(60);
    const ends = Date.now() + 60_000;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      setPrepLeft(left);
      if (left === 0) void acquireAndRecord();
    }, 250);
  }

  async function stopRecording() {
    stopTimer();
    const recorder = recorderRef.current;
    if (!recorder || stoppingRef.current) return;
    stoppingRef.current = true;
    setPhase("stopping");
    const generation = generationRef.current;
    const transcriptReady = stt.stop();
    try {
      const [result, raw] = await Promise.all([recorder.stop(), transcriptReady]);
      if (!alive.current || generationRef.current !== generation) return;
      if (!result) { stt.reset(); setError(practice.errors.unknown); setPhase("idle"); return; }
      setRecording(result);
      setPlaybackUrl(URL.createObjectURL(result.blob));
      setRawTranscript(raw);
      setTranscript(raw);
      setEdited(false);
      setPhase("review"); // Deliberately no upload and no submit here.
    } catch { recorder.cancel(); if (alive.current && generationRef.current === generation) { stt.reset(); setError(practice.errors.unknown); setPhase("idle"); } }
    finally {
      if (generationRef.current === generation) {
        if (recorderRef.current === recorder) recorderRef.current = null;
        stoppingRef.current = false;
      }
    }
  }

  async function clear(deleteAttempt = true) {
    cleanup(); recordingAttachedRef.current = false; setSubmissionAttempted(false); setRecording(null); setPlaybackUrl(null); setRawTranscript(""); setTranscript(""); setEdited(false); setEvaluation(null); setElapsed(0); setPhase("idle");
    if (deleteAttempt && attemptId) {
      await fetch(`/api/speaking/attempts/${attemptId}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => {});
    } else if (!deleteAttempt && attemptId) {
      retryParentRef.current = attemptId;
    }
    setAttemptId(null);
  }

  async function send() {
    if (!recording || !attemptId || submittingRef.current) return;
    const reviewed = transcript.trim();
    // Server STT may be used only when no reviewed text exists; manual/browser text is explicit otherwise.
    if (reviewed.length < 10) { setError(t.transcriptRequired); return; }
    submittingRef.current = true; setError("");
    try {
      if (!recordingAttachedRef.current) {
        const file = new File([recording.blob], `speaking-${Date.now()}.${extensionForMime(recording.mimeType)}`, { type: recording.mimeType });
        const check = preflight(file, "audio");
        if (!check.ok) { setError(practice.unsupported); return; }
        setPhase("uploading");
        const handle = startUpload(file, { purpose: "speaking_recording", speakingAttemptId: attemptId });
        uploadRef.current = handle;
        const outcome = await handle.promise;
        uploadRef.current = null;
        if (!outcome.ok) { setError(practice.uploadFailed); setPhase("review"); return; }
        const attach = await request(`/api/speaking/attempts/${attemptId}`, { method: "PATCH", body: { uploadId: outcome.uploadId, durationMs: recording.durationMs } });
        if (!attach?.ok) { setError(attach ? apiErrorMessage(attach.error, attach.status, dict) : practice.errors.unknown); setPhase("review"); return; }
        recordingAttachedRef.current = true;
      }
      setPhase("evaluating");
      setSubmissionAttempted(true);
      const body = rawTranscript
        ? { durationMs: recording.durationMs, browserTranscript: reviewed, browserTranscriptRaw: rawTranscript, browserTranscriptEdited: edited }
        : { durationMs: recording.durationMs, manualTranscript: reviewed };
      const result = await request<{ evaluation: Evaluation | null }>(`/api/speaking/attempts/${attemptId}/submit`, { body, timeoutMs: 60_000 });
      if (!result?.ok) { setError(result ? apiErrorMessage(result.error, result.status, dict) : practice.errors.unknown); setPhase("review"); return; }
      setEvaluation(result.data?.evaluation ?? null);
      setPhase("feedback"); onEvaluated(attemptId);
    } catch { setError(practice.errors.unknown); setPhase("review"); }
    finally { submittingRef.current = false; }
  }

  if (!isRecordingSupported()) return <Card><p className="text-sm text-band-bad">{practice.unsupportedBody}</p></Card>;

  return <Card className="flex flex-col gap-4" data-ai-answer-phase={phase}>
    <div>
      <p className="text-xs text-ink-500">{t.questionNumber.replace("{n}", String(index))}</p>
      <p className="mt-2 whitespace-pre-line text-lg text-ink-900">{prompt.promptText}</p>
      {prompt.cueCard && <div className="mt-3 rounded-md bg-paper-sunken p-3 whitespace-pre-line text-sm text-ink-700">{prompt.cueCard}</div>}
    </div>

    {!stt.supported && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30">{t.sttUnsupported}</p>}
    {phase === "idle" && <Button className="min-h-11 self-center" onClick={begin}>{t.startAnswer}</Button>}
    {phase === "preparing" && <div className="flex flex-wrap items-center gap-3"><span role="status">{t.preparing.replace("{n}", String(prepLeft))}</span><Button onClick={() => void acquireAndRecord()}>{t.startEarly}</Button></div>}
    {(phase === "starting" || phase === "stopping") && <p role="status">{dict.common.loading}</p>}
    {phase === "recording" && <>
      <p role="status" aria-live="polite" className="text-sm font-medium text-band-bad">● {t.recording} {formatDuration(elapsed)} / {formatDuration(answerLimit * 1000)}</p>
      <div className="min-h-36 rounded-md border border-ink-100 bg-paper-sunken p-4" aria-live="polite">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t.liveTranscript}</p>
        <p className="whitespace-pre-wrap text-sm text-ink-800">{transcript || t.liveTranscriptPlaceholder}</p>
      </div>
      {stt.state.kind === "error" && <p className="text-xs text-band-bad">{t.sttFailed}</p>}
      <Button variant="secondary" className="min-h-11 self-center" onClick={() => void stopRecording()}>{t.stop}</Button>
    </>}

    {phase === "review" && recording && <>
      {playbackUrl && <audio controls aria-label={t.yourRecording} src={playbackUrl} className="w-full" preload="metadata" />}
      <label className="flex flex-col gap-2 text-sm font-medium text-ink-900">
        {t.transcript}
        <textarea value={transcript} onChange={(event) => { setTranscript(event.target.value); setEdited(event.target.value !== rawTranscript); }} rows={7} className="input min-h-36 resize-y" placeholder={stt.supported ? t.transcriptPlaceholder : t.manualTranscriptPlaceholder} />
      </label>
      <div className="text-xs text-ink-500">
        <p>{t.transcriptSource}: {rawTranscript ? t.browserSpeechRecognition : t.manualTranscript}</p>
        <p>{t.editedByYou}: {edited ? t.yes : t.no}</p>
        <p className="mt-1 font-medium">{t.notSubmittedYet}</p>
      </div>
      {submissionAttempted && <p className="text-sm text-ink-500">{t.submissionRetryOnly}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!submissionAttempted && <Button variant="ghost" className="min-h-11" onClick={() => void clear()}>{t.clear}</Button>}
        {!submissionAttempted && <Button variant="secondary" className="min-h-11" onClick={() => void clear()}>{t.recordAgain}</Button>}
        <Button className="min-h-11 sm:ml-auto" disabled={transcript.trim().length < 10} onClick={() => void send()}>{submissionAttempted ? t.retrySend : t.sendToRiwi}</Button>
      </div>
    </>}
    {phase === "uploading" && <p role="status" aria-live="polite">{t.uploading}</p>}
    {phase === "evaluating" && <div className="py-8 text-center" role="status" aria-live="polite"><p className="font-display text-xl text-ink-900">{t.evaluating}</p><p className="mt-2 text-sm text-ink-500">{t.evaluatingBody}</p><p className="mt-1 text-xs text-ink-400">{t.pronunciationNotAssessed}</p></div>}
    {phase === "feedback" && <Feedback dict={dict} evaluation={evaluation} onTryAgain={() => void clear(false)} onNext={onNext} />}
    {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
  </Card>;
}

function Feedback({ dict, evaluation, onTryAgain, onNext }: { dict: Dictionary; evaluation: Evaluation | null; onTryAgain: () => void; onNext: () => void }) {
  const t = dict.speakingAi;
  return <div className="flex flex-col gap-4" data-ai-feedback>
    <p className="font-semibold text-signal-700">{t.checkedByRiwi}</p>
    {!evaluation ? <p className="text-sm text-ink-500">{t.feedbackUnavailable}</p> : <>
      {evaluation.strengths.length > 0 && <section><h3 className="text-sm font-semibold text-ink-900">{t.strengths}</h3><ul className="mt-1 list-inside list-disc text-sm text-ink-700">{evaluation.strengths.map((value) => <li key={value}>{value}</li>)}</ul></section>}
      {evaluation.weaknesses.length > 0 && <section><h3 className="text-sm font-semibold text-ink-900">{t.improveNext}</h3><ul className="mt-1 list-inside list-disc text-sm text-ink-700">{evaluation.weaknesses.map((value) => <li key={value}>{value}</li>)}</ul></section>}
      {evaluation.issues.map((issue, index) => <div key={index} className="rounded-md bg-paper-sunken p-3 text-sm"><p>{issue.message}</p>{issue.excerpt && <blockquote className="mt-1 font-mono text-xs">“{issue.excerpt}”</blockquote>}{issue.suggestion && <p className="mt-1 text-ink-500">{issue.suggestion}</p>}</div>)}
      <p className="text-sm"><strong>{t.pronunciation}:</strong> {t.notAssessed}</p>
    </>}
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><Button variant="secondary" className="min-h-11" onClick={onTryAgain}>{t.tryAgain}</Button><Button className="min-h-11" onClick={onNext}>{t.next}</Button></div>
  </div>;
}
