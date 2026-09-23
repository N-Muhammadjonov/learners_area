"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * Active use of a word, evaluated by VocabularyFeedbackService.
 *
 * This is a different signal from the review queue: recognising a word when you
 * see it and producing it in your own sentence are separate skills, so this
 * component never touches the spaced-repetition counters.
 */
export function UseInSentence({
  dict,
  entryId,
  term,
}: {
  dict: Dictionary;
  entryId: string;
  term: string;
}) {
  const t = dict.vocabulary;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ verdict: string | null; checkedBy: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/vocabulary/${entryId}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: text.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(String(data.error ?? dict.speakingPractice.errors.unknown));
      return;
    }
    const data = await res.json();
    setResult({ verdict: data.verdict ?? null, checkedBy: String(data.checkedBy ?? "") });
  }

  const verdictLabel = result?.verdict
    ? (dict.coach.verdicts as Record<string, string>)[result.verdict] ?? result.verdict
    : "";

  return (
    <div className="mt-3 flex w-full max-w-md flex-col gap-2 border-t border-ink-100 pt-3 text-left">
      <label htmlFor={`use-${entryId}`} className="text-sm font-medium text-ink-700">
        {t.useIt} — {term}
      </label>
      <textarea
        id={`use-${entryId}`}
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
          {busy ? dict.common.saving : t.checkSentence}
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
    </div>
  );
}
