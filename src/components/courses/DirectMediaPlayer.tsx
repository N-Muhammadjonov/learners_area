"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";

/**
 * Custom player for owner-authorised direct media (TED / PODCAST, N13).
 * Native <video> element, our own controls, a WebVTT caption track, keyboard
 * shortcuts and reported position. It is only used for media the centre is
 * licensed to host on AUTHORIZED_MEDIA_ORIGIN; YouTube items keep YouTube's own
 * player and branding (no overlays, no hidden provider UI).
 */
export type DirectMediaControls = { seekTo: (seconds: number) => void };
const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function DirectMediaPlayer({ src, captions, title, labels, onTime, controlsRef }: {
  src: string;
  captions: string | null;
  title: string;
  labels: { play: string; pause: string; captionsOn: string; captionsOff: string; speed: string; seek: string; error: string };
  onTime?: (seconds: number) => void;
  controlsRef?: MutableRefObject<DirectMediaControls | null>;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cc, setCc] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = { seekTo: (s) => { const v = video.current; if (v) { v.currentTime = Math.max(0, s); void v.play().catch(() => {}); } } };
    return () => { controlsRef.current = null; };
  }, [controlsRef]);

  useEffect(() => {
    const track = video.current?.textTracks?.[0];
    if (track) track.mode = cc ? "showing" : "hidden";
  }, [cc]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed]);

  function toggle() {
    const v = video.current; if (!v) return;
    if (v.paused) void v.play().catch(() => setFailed(true)); else v.pause();
  }
  function onKey(e: React.KeyboardEvent) {
    const v = video.current; if (!v) return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    else if (e.key === "c") { e.preventDefault(); setCc((x) => !x); }
  }

  return (
    <div className="flex flex-col bg-ink-950 text-white" data-direct-player onKeyDown={onKey}>
      <div className="relative aspect-video w-full">
        <video
          ref={video}
          src={src}
          title={title}
          className="absolute inset-0 h-full w-full"
          preload="metadata"
          playsInline
          crossOrigin="anonymous"
          controlsList="nodownload"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => { const s = e.currentTarget.currentTime; setTime(s); onTime?.(s); }}
          onError={() => setFailed(true)}
        >
          {captions ? <track kind="captions" src={captions} srcLang="en" label="English" default /> : null}
        </video>
      </div>
      {failed ? <p role="alert" className="bg-warn-50 px-3 py-2 text-sm text-warn-800">{labels.error}</p> : null}
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button type="button" className="btn-ghost btn-sm" onClick={toggle} aria-label={playing ? labels.pause : labels.play}>{playing ? "❚❚" : "▶"}</button>
        <span className="font-mono text-xs tabular-nums">{clock(time)} / {clock(duration)}</span>
        <input type="range" aria-label={labels.seek} min={0} max={Math.max(1, Math.floor(duration))} step={1} value={Math.floor(time)}
          onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value); }} className="flex-1" />
        {captions ? <button type="button" className="btn-ghost btn-sm" aria-pressed={cc} onClick={() => setCc((x) => !x)}>{cc ? labels.captionsOn : labels.captionsOff}</button> : null}
        <label className="flex items-center gap-1 text-xs"><span>{labels.speed}</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])} className="rounded bg-ink-900 px-1 text-white">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
