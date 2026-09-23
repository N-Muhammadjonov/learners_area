"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { choiceSetFor } from "@/lib/reading-choices";
import type { Dictionary } from "@/lib/i18n/en";

type ExamQuestion = {
  id: string;
  order: number;
  type: "true_false_not_given" | "yes_no_not_given" | "multiple_choice" | "short_answer";
  questionText: string;
  options: string[] | null;
};

export function ReadingExam({
  dict,
  attemptId,
  passageTitle,
  passageBody,
  questions,
}: {
  dict: Dictionary;
  attemptId: string;
  passageTitle: string;
  passageBody: string;
  questions: ExamQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function onSubmit() {
    if (!confirm(dict.reading.submitConfirm)) return;
    setSubmitting(true);
    const res = await fetch(`/api/reading/attempts/${attemptId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? "" })),
      }),
    });
    setSubmitting(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card max-h-[70vh] overflow-y-auto">
        <h2 className="mb-2 font-display text-lg text-ink-900">{passageTitle}</h2>
        <div className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{passageBody}</div>
      </div>

      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        {questions.map((q) => (
          <div key={q.id} className="card">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-300">
              {q.order}. {q.type.replace(/_/g, " ")}
            </p>
            <p className="mb-3 text-sm text-ink-900">{q.questionText}</p>

            {(q.type === "true_false_not_given" || q.type === "yes_no_not_given") && (
              <div className="flex flex-wrap gap-2">
                {Object.values(choiceSetFor(q.type)).map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => setAnswer(q.id, choice.value)}
                    className={`badge border ${
                      answers[q.id] === choice.value
                        ? "border-signal-600 bg-signal-600 text-white"
                        : "border-ink-100 bg-paper-raised text-ink-700"
                    }`}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}

            {q.type === "multiple_choice" && q.options && (
              <div className="flex flex-col gap-1.5">
                {q.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-ink-700">
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === opt}
                      onChange={() => setAnswer(q.id, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}

            {q.type === "short_answer" && (
              <Input
                placeholder={dict.reading.yourAnswer}
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}

        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? dict.common.loading : dict.reading.submit}
        </Button>
      </div>
    </div>
  );
}
