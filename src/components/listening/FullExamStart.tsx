"use client";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/http/client-request";
import { BackLink } from "@/components/ui/BackLink";
import type { Dictionary } from "@/lib/i18n/en";
import { useEffect, useRef, useState } from "react";
export function FullExamStart({ id, title, dict }: { id: string; title: string; dict: Dictionary }) {
  const t = dict.fullListeningHub.examStart;
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
      if (!result.ok) throw new Error("start_failed");
      const data = result.data;
      router.push(`/listening/attempts/${data.id}`);
    } catch {
      setError(t.failed);
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
    <div className="listening-workspace card mx-auto max-w-3xl space-y-5">
      <BackLink fallbackHref={`/listening/tests/${id}`} label={t.back} />
      <h1 className="font-display text-2xl">{t.title.replace("{title}", title)}</h1>
      <p>{t.rules}</p>
      <button type="button" className="btn-secondary" onClick={soundCheck}>
        {t.soundCheck}
      </button>
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => void start()}
      >
        {t.start}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
