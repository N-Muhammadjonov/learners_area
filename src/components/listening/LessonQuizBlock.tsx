"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

/**
 * One lesson quiz block, answered through the canonical endpoint.
 *
 * The server owns the verdict: `POST /api/lessons/blocks/:blockId/answer` grades by
 * the shared question-type registry and returns the key ONLY when the answer was
 * correct. The browser therefore never receives the answer before the learner has
 * answered — the options block hands over no key at all, and a wrong answer is told
 * it is wrong without being shown the answer it should have given.
 */
export function LessonQuizBlock({
  dict,
  blockId,
  prompt,
  options,
  response,
}: {
  dict: Dictionary;
  blockId: string;
  prompt: string;
  options: string[] | null;
  response: { answer: unknown; correct: boolean | null } | null;
}) {
  const request = useScopedRequest();
  const t = dict.listening.lessons;
  const initial = response ? (typeof (response.answer as { value?: unknown })?.value === "string" ? String((response.answer as { value: string }).value) : "") : "";
  const [value, setValue] = useState(initial);
  const [verdict, setVerdict] = useState<{ correct: boolean; correctAnswer: string | null } | null>(
    response && response.correct !== null ? { correct: response.correct, correctAnswer: null } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(answer: string) {
    if (busy || !answer.trim()) return;
    setBusy(true);
    setError("");
    const result = await request<{ ok?: boolean; correct?: boolean; correctAnswer?: string | null }>(
      `/api/lessons/blocks/${blockId}/answer`,
      { method: "POST", body: { answer } },
    );
    setBusy(false);
    if (!result) return;
    if (!result.ok) {
      setError(t.answerFailed);
      return;
    }
    setVerdict({ correct: Boolean(result.data?.correct), correctAnswer: result.data?.correctAnswer ?? null });
  }

  return (
    <div className="rounded-xl border border-ink-100 p-4" data-lesson-quiz-block={blockId}>
      <p className="text-sm font-medium text-ink-900">{prompt}</p>
      {options ? (
        <div className="mt-3 flex flex-col gap-2">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="radio"
                name={`lesson-quiz-${blockId}`}
                value={option}
                checked={value === option}
                onChange={() => setValue(option)}
                disabled={busy}
              />
              {option}
            </label>
          ))}
        </div>
      ) : (
        <Input className="mt-3" value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} />
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" disabled={busy || !value.trim()} onClick={() => void submit(value)} data-lesson-quiz-submit>
          {busy ? dict.common.saving : t.checkAnswer}
        </Button>
        {verdict && (
          <span
            className={verdict.correct ? "text-sm text-band-good" : "text-sm text-band-bad"}
            data-lesson-quiz-verdict={verdict.correct ? "correct" : "incorrect"}
          >
            {verdict.correct ? t.answerCorrect : t.answerIncorrect}
            {verdict.correctAnswer ? ` ${verdict.correctAnswer}` : ""}
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-band-bad">{error}</p>}
    </div>
  );
}
