"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";
import { CHARS_PER_WORD, computeTypingMetrics } from "@/lib/services/writing/typing";

type Target = { id: string; label: string; text: string };

export function TypingTrainer({
  dict,
  targets,
  initialSummary,
}: {
  dict: Dictionary;
  targets: Target[];
  initialSummary: { count: number; bestWpm: number | null; bestAccuracy: number | null };
}) {
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState(initialSummary);
  const [verdict, setVerdict] = useState<{ wpm: number; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const target = targets.find((t) => t.id === targetId) ?? targets[0];

  function start() {
    setTyped("");
    setVerdict(null);
    setError(null);
    setStartedAt(Date.now());
    setElapsed(0);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setElapsed((prev) => prev + 1000);
    }, 1000);
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  /** A live preview from the browser clock; the server's number is the real one. */
  const preview =
    startedAt && typed.length > 0 && elapsed > 0 && target
      ? computeTypingMetrics(target.text, typed, elapsed)
      : null;

  async function submit() {
    if (!target || !startedAt) return;
    const durationMs = Date.now() - startedAt;
    stop();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/writing/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetText: target.text, typedText: typed, durationMs }),
    });
    setBusy(false);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error === "invalid_duration" ? dict.writing.typingTooShort : dict.common.error);
      return;
    }
    setVerdict({ wpm: body.run.wpm, accuracy: body.run.accuracy });
    setSummary({
      count: body.summary.count,
      bestWpm: body.summary.bestWpm,
      bestAccuracy: body.summary.bestAccuracy,
    });
    setStartedAt(null);
  }

  if (targets.length === 0) return null;

  return (
    <Card data-typing-trainer>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink-900">{dict.writing.typingTitle}</h2>
        <span className="text-xs text-ink-300" data-typing-best={summary.bestWpm ?? ""}>
          {dict.writing.typingBest}: {summary.bestWpm === null ? "—" : `${summary.bestWpm} WPM`}
          {summary.bestAccuracy !== null ? ` · ${summary.bestAccuracy}%` : ""}
          {` · ${summary.count} ${dict.writing.typingRuns}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-300">{dict.writing.typingHint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-ink-500" htmlFor="typing-target">
          {dict.writing.typingPickTarget}
        </label>
        <select
          id="typing-target"
          className="input"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          data-typing-target
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={start} data-typing-start>
          {startedAt ? dict.writing.typingRestart : dict.writing.typingStart}
        </Button>
      </div>

      {target && (
        <p className="mt-3 rounded-sm bg-paper-sunken p-3 text-sm text-ink-700" data-typing-text>
          {target.text}
        </p>
      )}

      <textarea
        className="input mt-3 min-h-[120px] w-full"
        placeholder={dict.writing.typingPlaceholder}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        disabled={!startedAt}
        data-typing-input
      />

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
        <span data-typing-elapsed>{Math.floor(elapsed / 1000)}s</span>
        {preview && startedAt && (
          <span data-typing-preview>
            {dict.writing.typingLive}: {preview.wpm} WPM · {preview.accuracy}%
          </span>
        )}
        {preview && startedAt && <span className="text-ink-300">{dict.writing.typingUnverified}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          onClick={submit}
          disabled={busy || !startedAt || typed.trim().length === 0}
          data-typing-submit
        >
          {busy ? dict.common.loading : dict.writing.typingSubmit}
        </Button>
        {verdict && (
          <span className="text-sm text-band-good" data-typing-verdict>
            {dict.writing.typingVerified}: {verdict.wpm} WPM · {verdict.accuracy}%
          </span>
        )}
        {error && (
          <span className="text-sm text-band-bad" data-typing-error>
            {error}
          </span>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-300">
        {dict.writing.typingNote.replace("{chars}", String(CHARS_PER_WORD))}
      </p>
    </Card>
  );
}
