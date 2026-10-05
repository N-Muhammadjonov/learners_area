"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export type MicrophoneCheckState = "idle" | "requesting" | "checking" | "passed" | "denied" | "unsupported" | "error";

/** A local-only audio-energy preflight. No sample or metric leaves the browser. */
export function MicrophoneCheck({ dict, onContinue }: { dict: Dictionary; onContinue: () => void }) {
  const t = dict.speakingAi;
  const [state, setState] = useState<MicrophoneCheckState>("idle");
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peakRef = useRef(0);

  const release = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    frameRef.current = null;
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, []);
  useEffect(() => release, [release]);

  const test = useCallback(async () => {
    release();
    peakRef.current = 0;
    setLevel(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
      setState("unsupported");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      setState("checking");
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) { const normalized = (sample - 128) / 128; sum += normalized * normalized; }
        const energy = Math.min(1, Math.sqrt(sum / samples.length) * 5);
        peakRef.current = Math.max(peakRef.current, energy);
        setLevel(energy);
        frameRef.current = requestAnimationFrame(measure);
      };
      measure();
      timeoutRef.current = setTimeout(() => {
        const heard = peakRef.current >= 0.02;
        release();
        setLevel(heard ? 1 : 0);
        setState(heard ? "passed" : "error");
      }, 2500);
    } catch (error) {
      release();
      setState(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "error");
    }
  }, [release]);

  return <Card className="flex flex-col gap-5 p-5" data-microphone-check={state}>
    <div>
      <h2 className="font-display text-xl text-ink-900">{t.microphoneCheck}</h2>
      <p className="mt-1 text-sm text-ink-500">{t.microphoneCheckBody}</p>
    </div>
    <div>
      <div className="h-3 overflow-hidden rounded-full bg-ink-100" role="meter" aria-label={t.inputLevel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
        <div className="h-full bg-signal-500 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(2, level * 100)}%` }} />
      </div>
      <p className="mt-2 text-sm text-ink-700" role="status" aria-live="polite">
        {state === "passed" ? t.microphoneWorking
          : state === "denied" ? t.microphoneDenied
          : state === "unsupported" ? t.microphoneUnsupported
          : state === "checking" ? t.speakNow
          : state === "requesting" ? dict.common.loading
          : state === "error" ? t.microphoneNoSignal
          : t.microphoneIdle}
      </p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant={state === "passed" ? "secondary" : "primary"} disabled={state === "checking" || state === "requesting"} onClick={() => void test()}>
        {state === "idle" ? t.testMicrophone : t.testAgain}
      </Button>
      {state === "passed" && <Button onClick={onContinue}>{t.continue}</Button>}
    </div>
  </Card>;
}
