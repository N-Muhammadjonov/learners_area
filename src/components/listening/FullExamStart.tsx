"use client";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/http/client-request";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
export function FullExamStart({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const flight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function start() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      controller.current = new AbortController();
      const result = await requestJson<{ id: string }>(
        `/api/listening/full/${id}/start`,
        { signal: controller.current.signal, timeoutMs: 12000 },
      );
      if (!result.ok) throw new Error(result.error ?? "Start failed");
      const data = result.data;
      router.push(`/listening/attempts/${data.id}`);
    } catch {
      setError("Start failed. Retry to resume the same attempt.");
      flight.current = false;
      setBusy(false);
    }
  }
  function soundCheck() {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  }
  return (
    <div className="card mx-auto max-w-3xl space-y-5">
      <Link className="btn-secondary" href={`/listening/tests/${id}`}>
        ← Test hub
      </Link>
      <h1 className="font-display text-2xl">{title} · Full Exam</h1>
      <p>
        The recording plays once at 1×. No pause, rewind, speed changes,
        transcript or answers during the exam. Your answers are saved. A refresh
        resumes the same attempt.
      </p>
      <button type="button" className="btn-secondary" onClick={soundCheck}>
        Audio Test — check sound
      </button>
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => void start()}
      >
        Start Exam
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
