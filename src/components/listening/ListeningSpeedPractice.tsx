"use client";
import type { Dictionary } from "@/lib/i18n/en";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/http/client-request";
import { useRouter } from "next/navigation";
import type { ListeningPackage } from "@/lib/listening/package";
export function ListeningSpeedPractice({
  id,
  audioUrl,
  questions,
  allowed,
  dict,
}: {
  dict: Dictionary;
  id: string;
  audioUrl: string | null;
  questions: ListeningPackage["questions"];
  allowed: number[];
}) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(allowed.at(-1) ?? 1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function check() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      controller.current = new AbortController();
      const res = await requestJson<{ score: number; total: number }>(
        `/api/listening/full/${id}/activity`,
        {
          signal: controller.current.signal,
          timeoutMs: 12000,
          body: { activity: 2, speedRate: rate, answers, complete: true },
        },
      );
      if (!res.ok) throw new Error("check_failed");
      const data = res.data;
      setResult(`${data.score} / ${data.total}`);
      router.refresh();
    } catch (e) {
      void e;
      setResult(dict.fullListeningHub.speed.failed);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="card space-y-3">
      <summary>{dict.fullListeningHub.speed.summary}</summary>
      <p>{dict.fullListeningHub.speed.ladder}</p>
      <audio
        ref={audio}
        src={audioUrl ?? undefined}
        controls
        preload="none"
        onError={() => setResult(dict.fullListeningHub.speed.audioUnavailable)}
      />
      <label>
        {dict.fullListeningHub.speed.speed}
        <select
          className="input"
          value={rate}
          onChange={(e) => {
            const next = Number(e.target.value);
            setRate(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
        >
          {[1, 1.25, 1.5, 1.75, 2].map((r) => (
            <option value={r} key={r} disabled={!allowed.includes(r)}>
              {r}×{allowed.includes(r) ? "" : ` · ${dict.fullListeningHub.speed.locked}`}
            </option>
          ))}
        </select>
      </label>
      {questions.map((q) => (
        <label key={q.number} className="block">
          Q{q.number}. {q.text}
          <input
            className="input"
            maxLength={500}
            value={answers[q.number] ?? ""}
            onChange={(e) =>
              setAnswers((old) => ({ ...old, [q.number]: e.target.value }))
            }
          />
        </label>
      ))}
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => void check()}
      >
        {dict.fullListeningHub.speed.check}
      </button>
      {result && <p role="status">{result}</p>}
    </details>
  );
}
