"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRecorder, formatDuration, RecorderError, type Recorder } from "@/lib/audio/recorder";
import type { Dictionary } from "@/lib/i18n/en";

/** A memory-only reflection, bounded to three minutes. Not an assessment or a saved response. */
export const REFLECTION_LIMIT_MS = 180_000;
export function LocalReflectionRecorder({ dict, active }: { dict: Dictionary; active: boolean }) {
  const t = dict.videoLesson.voiceSummary;
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "stopping">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [playback, setPlayback] = useState<string | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(false), generation = useRef(0), busy = useRef(false);
  const recorder = useRef<Recorder | null>(null), request = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null), audio = useRef<HTMLAudioElement | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopping = useRef(false);
  const clearTimers = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    if (deadline.current) clearTimeout(deadline.current);
    tick.current = null; deadline.current = null;
  }, []);
  const discardPlayback = useCallback(() => {
    audio.current?.pause();
    audio.current?.removeAttribute("src");
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  const destroy = useCallback(() => {
    generation.current++;
    request.current?.abort(); request.current = null;
    recorder.current?.cancel(); recorder.current = null;
    clearTimers(); discardPlayback();
    busy.current = false; stopping.current = false;
  }, [clearTimers, discardPlayback]);
  useEffect(() => {
    alive.current = true;
    const leave = () => { destroy(); if (alive.current) { setPlayback(null); setElapsed(0); setPhase("idle"); } };
    window.addEventListener("pagehide", leave); // Also destroys audio before a page enters bfcache.
    return () => { alive.current = false; window.removeEventListener("pagehide", leave); destroy(); audio.current = null; };
  }, [destroy]);
  const stop = useCallback(async () => {
    const current = recorder.current;
    if (!current || stopping.current) return;
    stopping.current = true; clearTimers(); setPhase("stopping");
    const token = generation.current;
    try {
      const result = await current.stop();
      if (!alive.current || token !== generation.current) return;
      discardPlayback();
      if (result?.size) { url.current = URL.createObjectURL(result.blob); setPlayback(url.current); }
      else { setPlayback(null); setError(t.noAudio); }
    } catch { if (alive.current && token === generation.current) setError(t.failed); }
    finally {
      current.cancel();
      if (token === generation.current) { recorder.current = null; stopping.current = false; busy.current = false; if (alive.current) setPhase("idle"); }
    }
  }, [clearTimers, discardPlayback, t.noAudio, t.failed]);
  const record = async () => {
    if (busy.current || !active || !alive.current) return;
    busy.current = true; discardPlayback(); setPlayback(null); setError(""); setElapsed(0); setPhase("requesting");
    const token = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    const failed = (cause: unknown) => {
      if (!alive.current || token !== generation.current) return;
      destroy(); setPlayback(null); setPhase("idle");
      setError(cause instanceof RecorderError && cause.code === "permission_denied" ? t.permissionDenied : cause instanceof RecorderError && ["unsupported", "no_microphone"].includes(cause.code) ? t.unavailable : t.failed);
    };
    try {
      const current = await createRecorder({signal: controller.signal, permissionTimeoutMs: 15_000, onError: failed});
      if (!alive.current || token !== generation.current || controller.signal.aborted) { current.cancel(); return; }
      recorder.current = current;
      await current.start();
      if (!alive.current || token !== generation.current) { current.cancel(); return; }
      setPhase("recording");
      tick.current = setInterval(() => setElapsed(Math.min(current.elapsedMs(), REFLECTION_LIMIT_MS)), 200);
      deadline.current = setTimeout(() => void stop(), REFLECTION_LIMIT_MS);
    } catch (cause) { failed(cause); }
  };
  useEffect(() => {
    const hide = () => {
      audio.current?.pause();
      if (recorder.current) void stop();
      else if (busy.current) { generation.current++; request.current?.abort(); busy.current = false; setPhase("idle"); }
    };
    if (!active) hide(); // Keep the URL, but never leave a hidden microphone or player running.
    const visibility = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [active, stop]);
  return <div hidden={!active} className={active ? "space-y-3 rounded-xl border border-ink-100 p-4" : "hidden"} data-local-reflection>
    <p className="text-sm font-medium">{t.temporary}</p>
    <p className="text-xs text-ink-500">{t.notSaved} {t.limit}</p>
    {phase === "idle" && <button className="btn-secondary min-h-11" type="button" onClick={() => void record()}>{playback ? t.again : t.record}</button>}
    {phase === "requesting" && <p role="status">{t.requesting}</p>}
    {phase === "recording" && <div className="flex flex-wrap items-center gap-3"><span role="status">{t.recording} {formatDuration(elapsed)}</span><button className="btn-primary min-h-11" type="button" onClick={() => void stop()}>{t.stop}</button></div>}
    {phase === "stopping" && <p role="status">{t.preparing}</p>}
    {playback && <button type="button" className="btn-secondary" onClick={()=>{discardPlayback();setPlayback(null);setElapsed(0);}}>{dict.common.delete}</button>}
    {playback && <audio ref={node => { if (node) audio.current = node; }} src={playback} controls preload="metadata" aria-label={t.listen} className="w-full max-w-full" />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
