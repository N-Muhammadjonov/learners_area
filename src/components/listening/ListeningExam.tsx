"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MaterialPlayer } from "@/components/speaking/MaterialPlayer";
import type { Dictionary } from "@/lib/i18n/en";

type ExamQuestion = {
  id: string;
  order: number;
  type: "multiple_choice" | "short_answer";
  questionText: string;
  options: string[] | null;
};

export function ListeningExam({
  dict,
  attemptId,
  testTitle,
  audioUrl,
  audioType,
  questions,
}: {
  dict: Dictionary;
  attemptId: string;
  testTitle: string;
  /** Null when the centre has not uploaded the audio yet. */
  audioUrl: string | null;
  audioType: "video" | "audio" | "file" | "link";
  questions: ExamQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function onSubmit() {
    if (!confirm(dict.listening.submitConfirm)) return;
    setSubmitting(true);
    const res = await fetch(`/api/listening/attempts/${attemptId}/submit`, {
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
    <div className="flex flex-col gap-4">
      <div className="card">
        <h2 className="mb-3 font-display text-lg text-ink-900">{testTitle}</h2>
        <MaterialPlayer
          url={audioUrl}
          type={audioType}
          openLabel="Open audio"
          emptyLabel={dict.listening.noAudioYet}
        />
      </div>

      <div className="flex flex-col gap-4">
        {questions.map((q) => (
          <div key={q.id} className="card">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-300">
              {q.order}. {q.type.replace(/_/g, " ")}
            </p>
            <p className="mb-3 text-sm text-ink-900">{q.questionText}</p>

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
                placeholder={dict.listening.yourAnswer}
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}

        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? dict.common.loading : dict.listening.submit}
        </Button>
      </div>
    </div>
  );
}
