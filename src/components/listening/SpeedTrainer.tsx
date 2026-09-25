"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import { SPEED_RATES, type SpeedTrainingStatus } from "@/lib/services/listening/speed-training";

/**
 * Speed Training: the same recording, faster, on purpose.
 *
 * The rate buttons only exist when the source is a file we can play ourselves —
 * for an embedded player there is no playback-rate handle, and offering buttons
 * that silently do nothing would be a lie dressed as a feature.
 */
export function SpeedTrainer({
  dict,
  audioUrl,
  rateControlSupported,
  status,
  transcript,
}: {
  dict: Dictionary;
  audioUrl: string;
  rateControlSupported: boolean;
  status: SpeedTrainingStatus;
  transcript: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [rate, setRate] = useState<number>(1);
  const [showTranscript, setShowTranscript] = useState(false);
  const [failed, setFailed] = useState(false);

  function applyRate(next: number) {
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  if (!rateControlSupported) {
    return (
      <Card data-speed-unsupported>
        <h2 className="font-display text-lg text-ink-900">{dict.listening.speedTitle}</h2>
        <p className="mt-1 text-sm text-ink-500">{dict.listening.speedUnsupported}</p>
      </Card>
    );
  }

  if (!status.unlocked) {
    return (
      <Card data-speed-locked data-speed-percent={status.percent}>
        <h2 className="font-display text-lg text-ink-900">{dict.listening.speedTitle}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {(status.notAttemptedYet ? dict.listening.speedNoAttempt : dict.listening.speedLocked)
            .replace("{percent}", String(status.thresholdPercent))
            .replace("{current}", String(status.percent))}
        </p>
      </Card>
    );
  }

  return (
    <Card data-speed-unlocked>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink-900">{dict.listening.speedTitle}</h2>
        <span className="text-xs text-ink-300">
          {dict.listening.speedHint}
        </span>
      </div>

      <audio
        ref={audioRef}
        controls
        preload="none"
        src={audioUrl}
        className="mt-3 w-full"
        onError={() => setFailed(true)}
        data-speed-audio
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-300">
          {dict.listening.speedRate}
        </span>
        {SPEED_RATES.map((value) => (
          <button
            key={value}
            type="button"
            data-speed-rate={value}
            aria-pressed={rate === value}
            className={`badge ${rate === value ? "bg-signal-600 text-paper" : "bg-paper-sunken text-ink-500"}`}
            onClick={() => applyRate(value)}
          >
            {value.toFixed(2).replace(/0$/, "")}×
          </button>
        ))}
        {transcript && (
          <button
            type="button"
            data-speed-transcript
            className="badge bg-paper-sunken text-ink-500"
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript ? dict.listening.speedHideTranscript : dict.listening.speedTranscript}
          </button>
        )}
      </div>

      {failed && (
        <p className="mt-2 text-sm text-band-bad" data-speed-error>
          {dict.listening.speedAudioError}
        </p>
      )}

      {transcript && showTranscript && (
        <p className="mt-3 whitespace-pre-line rounded-sm bg-paper-sunken p-3 text-sm text-ink-700">
          {transcript}
        </p>
      )}
    </Card>
  );
}
