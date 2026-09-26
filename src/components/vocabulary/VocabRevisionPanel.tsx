"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { toDate, type VocabWord } from "./types";
import { formatDate } from "@/lib/time";

type ReviewResult = {
  mastery: string;
  srsStage: number;
  intervalDays: number;
  nextReviewAt: string;
  points: number;
};

/**
 * REVISION — the only place the official schedule moves.
 *
 * The card shows the word; the student recalls the meaning, reveals it, and
 * answers honestly. The server then applies the 1/3/7/16/35 ladder and writes a
 * single ledger entry. A missed word drops to the first interval rather than
 * erasing history — that is what makes the next date trustworthy.
 */
export function VocabRevisionPanel({
  dict,
  initialDue,
  onFinished,
}: {
  dict: Dictionary;
  initialDue: VocabWord[];
  onFinished: (remaining: number) => void;
}) {
  const t = dict.vocabulary;
  const [queue, setQueue] = useState<VocabWord[]>(initialDue);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    { term: string; outcome: "correct" | "incorrect"; result: ReviewResult }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const current = queue[index];
  const done = !current;

  async function submit(outcome: "correct" | "incorrect") {
    if (!current) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/vocabulary/${current.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    setBusy(false);

    if (!res.ok) {
      setError(dict.errors.unknown);
      return;
    }

    const payload = (await res.json()) as ReviewResult;
    setResults((rows) => [...rows, { term: current.term, outcome, result: payload }]);
    setRevealed(false);
    if (index + 1 >= queue.length) {
      setIndex(queue.length);
      onFinished(0);
    } else {
      setIndex(index + 1);
      onFinished(queue.length - index - 1);
    }
  }

  if (done) {
    const correct = results.filter((row) => row.outcome === "correct").length;
    const points = results.reduce((sum, row) => sum + row.result.points, 0);
    return (
      <div className="card flex flex-col gap-3 p-4" data-revision-summary>
        <h2 className="font-display text-xl text-ink-900">{t.revision.done}</h2>
        <p className="text-sm text-ink-700">
          {t.revision.summary}: {results.length} · {t.revision.correct}: {correct} · {t.board.points}: {points}
        </p>
        {results.length > 0 && (
          <ul className="divide-y divide-ink-100 text-sm">
            {results.map((row) => (
              <li key={`${row.term}-${row.result.srsStage}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink-900">{row.term}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={row.outcome === "correct" ? "text-band-good" : "text-band-bad"}>
                    {row.outcome === "correct" ? t.revision.correct : t.revision.incorrect}
                  </span>
                  <span className="badge bg-paper-sunken text-ink-500">
                    {t.revision.stage} {row.result.srsStage + 1}
                  </span>
                  <span className="text-ink-500">
                    {row.result.intervalDays === 1
                      ? t.revision.nextTomorrow
                      : t.revision.nextInDays.replace("{days}", String(row.result.intervalDays))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setQueue([]);
              setResults([]);
              setIndex(0);
            }}
          >
            {t.revision.start}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink-900">{t.revision.title}</h2>
          <span className="text-xs text-ink-500" data-revision-progress>
            {t.revision.progress} {index + 1} {t.revision.of} {queue.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-500">{t.revision.hint}</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken">
          <div
            className="h-full bg-signal-600 transition-all"
            style={{ width: `${Math.round((index / queue.length) * 100)}%` }}
          />
        </div>
      </div>

      <div className="card flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="badge bg-paper-sunken text-ink-500">
          {t.revision.stage} {current.srsStage + 1} · {current.intervalDays} {t.add.days}
        </span>
        <p className="font-display text-3xl text-ink-900" data-revision-term>
          {current.term}
        </p>
        {revealed ? (
          <div className="flex max-w-md flex-col gap-1">
            <p className="text-sm text-ink-700">{current.definitionEn}</p>
            {current.translationUz && <p className="text-sm font-medium text-signal-700">{current.translationUz}</p>}
            {current.exampleSentence && (
              <p className="mt-1 text-xs italic text-ink-500">{current.exampleSentence}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-500">{t.revision.recall}</p>
        )}
      </div>

      {error && <p className="text-xs text-band-bad">{error}</p>}

      {revealed ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="btn-primary"
            data-outcome="correct"
            disabled={busy}
            onClick={() => void submit("correct")}
          >
            {t.revision.recalled}
          </button>
          <button
            type="button"
            className="btn-secondary"
            data-outcome="incorrect"
            disabled={busy}
            onClick={() => void submit("incorrect")}
          >
            {t.revision.missed}
          </button>
        </div>
      ) : (
        <button type="button" className="btn-gold" data-reveal onClick={() => setRevealed(true)}>
          {t.revision.reveal}
        </button>
      )}

      <p className="text-center text-xs text-ink-300">
        {t.revision.nextTomorrow} · {formatDate(current.nextReviewAt)}
      </p>
    </div>
  );
}
