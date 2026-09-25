"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  createRecorder,
  formatDuration,
  isRecordingSupported,
  RecorderError,
  type Recorder,
} from "@/lib/audio/recorder";
import type { Dictionary } from "@/lib/i18n/en";

type Track = { id: string; title: string; url: string; category: string };

/**
 * Shadowing — say it again, right after the recording, and listen to both.
 *
 * There is no score here and there is no fake one: judging pronunciation needs
 * acoustic analysis this centre does not have, and showing a number invented
 * from a transcript would teach the student to trust a lie. What the drill
 * offers instead is the thing shadowing actually is — the original, your voice
 * straight after it, and your own ears.
 *
 * The take stays in this tab (an object URL, never uploaded): shadowing is a
 * warm-up, and there is no reason to keep a private voice recording to prove it
 * happened. That also means the screen says so plainly.
 */
export function ShadowingStudio({ dict, tracks }: { dict: Dictionary; tracks: Track[] }) {
  const t = dict.speakingShadowing;
  const [selected, setSelected] = useState<Track | null>(tracks[0] ?? null);
  const [phase, setPhase] = useState<"idle" | "recording" | "recorded">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<{ url: string; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [originalFailed, setOriginalFailed] = useState(false);

  const recorderRef = useRef<Recorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const takeUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(isRecordingSupported());
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      void recorderRef.current?.cancel();
    },
    []
  );

  async function start() {
    setError(null);
    try {
      const recorder = await createRecorder();
      recorderRef.current = recorder;
      await recorder.start();
      setPhase("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((value) => value + 1000), 1000);
    } catch (cause) {
      setError(
        cause instanceof RecorderError && cause.code === "permission_denied"
          ? t.permissionDenied
          : t.recordFailed
      );
    }
  }

  async function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (!recorder) return;
    const result = await recorder.stop();
    if (!result) return;
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    const url = URL.createObjectURL(result.blob);
    takeUrlRef.current = url;
    setTake({ url, durationMs: result.durationMs });
    setPhase("recorded");
  }

  if (tracks.length === 0) {
    return (
      <Card data-shadowing-empty>
        <h2 className="font-display text-lg text-ink-900">{t.title}</h2>
        <p className="mt-1 text-sm text-ink-500">{t.empty}</p>
      </Card>
    );
  }

  return (
    <Card data-shadowing-studio>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink-900">{t.title}</h2>
        <span className="text-xs text-ink-300" data-shadowing-note>
          {t.noScore}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-300">{t.hint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-ink-500" htmlFor="shadowing-track">
          {t.pickRecording}
        </label>
        <select
          id="shadowing-track"
          className="input"
          data-shadowing-picker
          value={selected?.id ?? ""}
          onChange={(e) => {
            setSelected(tracks.find((track) => track.id === e.target.value) ?? null);
            setTake(null);
            setPhase("idle");
            setOriginalFailed(false);
          }}
        >
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.title}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="rounded-sm bg-paper-sunken p-3">
            <p className="mb-1 text-xs font-medium text-ink-500">{t.original}</p>
            <audio
              controls
              preload="none"
              src={selected.url}
              className="w-full"
              data-shadowing-original
              onError={() => setOriginalFailed(true)}
            />
            {originalFailed && (
              <p className="mt-1 text-xs text-band-bad" data-shadowing-original-error>
                {t.originalFailed}
              </p>
            )}
          </div>

          <div className="rounded-sm border border-ink-100 p-3">
            <p className="mb-2 text-xs font-medium text-ink-500" data-shadowing-record>
              {t.yourTurn}
            </p>

            {!supported ? (
              <p className="text-sm text-ink-500" data-shadowing-unsupported>
                {t.unsupported}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {phase === "recording" ? (
                  <Button onClick={() => void stop()} data-shadowing-stop>
                    {t.stop} · {formatDuration(elapsed)}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => void start()} data-shadowing-start>
                    {phase === "recorded" ? t.again : t.record}
                  </Button>
                )}
                {take && (
                  <>
                    <audio controls src={take.url} className="w-full max-w-xs" data-shadowing-mine />
                    <span className="text-xs text-ink-300">
                      {t.takeLength}: {formatDuration(take.durationMs)}
                    </span>
                  </>
                )}
              </div>
            )}

            {error && <p className="mt-2 text-sm text-band-bad">{error}</p>}
          </div>

          <p className="text-xs text-ink-300" data-shadowing-privacy>
            {t.privacy}
          </p>
        </div>
      )}
    </Card>
  );
}
