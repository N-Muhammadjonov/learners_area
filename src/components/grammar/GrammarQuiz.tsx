"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProductionAnswer } from "./ProductionAnswer";
import type { Dictionary } from "@/lib/i18n/en";

type Exercise = {
  id: string;
  order: number;
  promptText: string;
  options: string[];
  fromEssay: boolean;
};

type Result = { exerciseId: string; isCorrect: boolean; correctOption: string; explanation: string };

export function GrammarQuiz({
  dict,
  topicId,
  exercises,
}: {
  dict: Dictionary;
  topicId: string;
  exercises: Exercise[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setSubmitting(true);
    const res = await fetch(`/api/grammar/topics/${topicId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: exercises.map((e) => ({ exerciseId: e.id, selectedOption: answers[e.id] ?? "" })),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      const map: Record<string, Result> = {};
      for (const r of data.results as Result[]) map[r.exerciseId] = r;
      setResults(map);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {exercises.map((ex) => {
        const result = results?.[ex.id];
        return (
          <Card key={ex.id} className={result ? (result.isCorrect ? "border-band-good/40" : "border-band-bad/40") : ""}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-300">
                {ex.order}. {dict.grammar.pickCorrect}
              </p>
              {ex.fromEssay && <span className="badge bg-signal-100 text-signal-700">{dict.grammar.fromYourEssay}</span>}
            </div>
            <p className="mb-3 text-sm italic text-ink-500">{ex.promptText}</p>
            <div className="flex flex-col gap-1.5">
              {ex.options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="radio"
                    name={ex.id}
                    disabled={!!results}
                    checked={answers[ex.id] === opt}
                    onChange={() => setAnswers((prev) => ({ ...prev, [ex.id]: opt }))}
                  />
                  <span className={result && opt === result.correctOption ? "font-medium text-band-good" : ""}>
                    {opt}
                  </span>
                </label>
              ))}
            </div>
            {result && (
              <p className="mt-2 text-xs text-ink-500">
                <span className={result.isCorrect ? "font-medium text-band-good" : "font-medium text-band-bad"}>
                  {result.isCorrect ? dict.grammar.correct : dict.grammar.incorrect}
                </span>
                {" — "}
                {result.explanation}
              </p>
            )}
            <ProductionAnswer dict={dict} exerciseId={ex.id} />
          </Card>
        );
      })}
      {!results && (
        <Button onClick={onSubmit} disabled={submitting || Object.keys(answers).length < exercises.length}>
          {submitting ? dict.common.loading : dict.grammar.submit}
        </Button>
      )}
    </div>
  );
}
