"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { choiceSetFor } from "@/lib/reading-choices";
import { ClickableText } from "@/components/vocabulary/ClickableText";
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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg text-ink-900">{passageTitle}</h2>
          <ReadAloud dict={dict} text={`${passageTitle}. ${passageBody}`} />
        </div>
        {/* Every word is a button: look it up, or save it to your own words. */}
        <ClickableText
          dict={dict}
          text={passageBody}
          sourceType="reading"
          sourceId={attemptId}
          className="text-sm leading-relaxed text-ink-700"
        />
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

/**
 * Read the passage aloud with the browser's own voice.
 *
 * This is a reading aid, not an assessment: it uses the local speech synthesiser,
 * so there is no pronunciation score attached to it and it works offline. If the
 * browser has no voice, the control says so instead of pretending.
 */
function ReadAloud({ dict, text }: { dict: Dictionary; text: string }) {
  const [state, setState] = useState<"idle" | "speaking" | "unsupported">("idle");

  if (state === "unsupported") {
    return <span className="text-xs text-ink-300">{dict.reading.readAloudUnsupported}</span>;
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      data-read-aloud
      onClick={() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          setState("unsupported");
          return;
        }
        if (state === "speaking") {
          window.speechSynthesis.cancel();
          setState("idle");
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-GB";
        utterance.onend = () => setState("idle");
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setState("speaking");
      }}
    >
      {state === "speaking" ? dict.reading.readAloudStop : dict.reading.readAloud}
    </button>
  );
}
