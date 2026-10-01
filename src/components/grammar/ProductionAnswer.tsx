"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";

type ProduceResult = {
  verdict: string | null;
  checkedBy: string;
  sampleAnswer: string;
  explanation: string;
  issues: string[];
};

/**
 * "Write your own correction" for a grammar item.
 *
 * Multiple-choice answers stay on exact grading; this path exists because a
 * correct rewrite may share no vocabulary with the sample answer, so string
 * equality would mark good answers wrong. GrammarEvaluationService judges the
 * produced sentence, and the label names the evaluator that did it.
 *
 * The sample answer is returned by the API only after a submission, so the key
 * never leaks into the page before the student has committed an answer.
 */
export function ProductionAnswer({ dict, exerciseId }: { dict: Dictionary; exerciseId: string }) {
  const t = dict.grammar;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProduceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/grammar/exercises/${exerciseId}/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: text.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(String(data.error ?? dict.speakingPractice.errors.unknown));
      return;
    }
    const data = await res.json();
    setResult({
      verdict: data.verdict ?? null,
      checkedBy: String(data.checkedBy ?? ""),
      sampleAnswer: String(data.sampleAnswer ?? ""),
      explanation: String(data.explanation ?? ""),
      issues: Array.isArray(data.issues) ? (data.issues as string[]) : [],
    });
  }

  const verdictLabel = result?.verdict
    ? (dict.coach.verdicts as Record<string, string>)[result.verdict] ?? result.verdict
    : "";

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-ink-100 pt-3">
      <label htmlFor={`produce-${exerciseId}`} className="text-sm font-medium text-ink-700">
        {t.writeYourOwn}
      </label>
      <textarea
        id={`produce-${exerciseId}`}
        className="input min-h-[70px]"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p className="text-xs text-band-bad">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={busy || text.trim().length < 3}
          onClick={() => void submit()}
        >
          {busy ? dict.common.saving : t.checkMine}
        </Button>
        {result && (
          <span className="text-xs text-ink-500" data-checked-by={result.checkedBy}>
            <span className={result.verdict === "correct" ? "text-band-good" : "text-ink-700"}>
              {verdictLabel}
            </span>
            {" · "}
            {dict.coach.checkedBy} {result.checkedBy}
          </span>
        )}
      </div>

      {result && (
        <div className="flex flex-col gap-1 rounded-sm bg-paper-sunken p-3">
          <p className="text-xs text-ink-300">
            {t.sampleAnswer}: {result.sampleAnswer}
          </p>
          <p className="academic-text text-xs text-ink-500">{result.explanation}</p>
          {result.issues.length > 0 && (
            <ul className="list-inside list-disc text-xs text-ink-500">
              {result.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
