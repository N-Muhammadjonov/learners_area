"use client";
import type { Dictionary } from "@/lib/i18n/en";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRecorder, formatDuration, type Recorder } from "@/lib/audio/recorder";

/** A practice recording is a session Blob, never a server attempt or upload. */
export function LocalAnswerRecorder({ dict, id, part, lockedBy, onBusyChange }: { dict: Dictionary; id: string; part: string; lockedBy: string | null; onBusyChange: (id: string, busy: boolean) => void }) {
  const t = dict.speakingStudy;
  const [phase, setPhase] = useState<"idle" | "preparing" | "starting" | "recording" | "stopping">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [playback, setPlayback] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const acquiring = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const limit = part === "part2" ? 120 : part === "part3" ? 45 : 30;
  const busy = phase !== "idle";
  useEffect(() => { onBusyChange(id, busy); }, [id, busy, onBusyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); recorder.current?.cancel(); if (url.current) URL.revokeObjectURL(url.current); }; }, []);
  const stop = useCallback(async () => {
    const current = recorder.current;
    if (!current) return;
    recorder.current = null;
    setPhase("stopping");
    const result = await current.stop();
    if (!mounted.current) return;
    if (url.current) URL.revokeObjectURL(url.current);
    if (result?.size) { url.current = URL.createObjectURL(result.blob); setPlayback(url.current); }
    else { url.current = null; setPlayback(null); setError(t.noAudio); }
    setPhase("idle");
  }, [t.noAudio]);
  const record = useCallback(async () => {
    if (acquiring.current || recorder.current || !mounted.current) return;
    acquiring.current = true;
    audio.current?.pause();
    setPhase("starting"); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch("/api/live-partner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "practice_started" }), signal: controller.signal });
        if (res.status === 409) { setError(dict.speakingPractice.errors.liveCallActive); setPhase("idle"); return; }
      } finally { clearTimeout(deadline); }
      const next = await createRecorder({ signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) { next.cancel(); return; }
      recorder.current = next;
      await next.start();
      if (!mounted.current || controller.signal.aborted) { next.cancel(); recorder.current = null; return; }
      setElapsed(0); setPhase("recording");
    } catch { recorder.current?.cancel(); recorder.current = null; if (mounted.current) { setError(t.micError); setPhase("idle"); } }
    finally { acquiring.current = false; }
  }, [t.micError, dict.speakingPractice.errors.liveCallActive]);
  useEffect(() => {
    if (phase !== "recording" && phase !== "preparing") return;
    const start = Date.now();
    const timer = setInterval(() => {
      const seconds = (Date.now() - start) / 1000;
      setElapsed(Math.floor(seconds));
      if (phase === "preparing" && seconds >= 60) { clearInterval(timer); void record(); }
      if (phase === "recording" && seconds >= limit) { clearInterval(timer); void stop(); }
    }, 200);
    return () => clearInterval(timer);
  }, [phase, limit, record, stop]);
  return <div className="mt-3 space-y-3" data-local-recorder={id}>
    <div className="flex flex-wrap gap-2">
      {phase === "idle" && <button type="button" className="btn-secondary min-h-11" disabled={!!lockedBy && lockedBy !== id} onClick={() => { if (part === "part2") { setElapsed(0); setPhase("preparing"); } else void record(); }}>● {playback ? t.recordAgain : t.record}</button>}
      {phase === "preparing" && <><span role="status">{t.prepare} {formatDuration((60 - elapsed) * 1000)}</span><button type="button" className="btn-primary" onClick={() => void record()}>{t.talk} 2:00</button><button type="button" className="btn-secondary" onClick={() => setPhase("idle")}>{t.cancel}</button></>}
      {phase === "recording" && <><span role="status">{formatDuration(elapsed * 1000)} / {formatDuration(limit * 1000)}</span><button type="button" className="btn-primary" onClick={() => void stop()}>■ {t.stop}</button></>}
      {(phase === "starting" || phase === "stopping") && <span role="status">{phase === "starting" ? t.openingMic : t.preparingRecording}</span>}
    </div>
    {playback && phase === "idle" && <audio ref={audio} controls preload="metadata" src={playback} className="max-w-full" aria-label={t.playback} />}
    {error && <p role="alert" className="text-band-bad">{error}</p>}
  </div>;
}
