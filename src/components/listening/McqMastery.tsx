"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";
import type { McqField, McqStage } from "@/lib/services/listening/mcq-mastery";

type Payload = {
  session: {
    id: string;
    stage: McqStage;
    notes: string | null;
    ownAnswer: string | null;
    chosenAnswer: string | null;
    reasoning: string | null;
  };
  question: { id: string; order: number; questionText: string };
  options: string[] | null;
  correctAnswer: string | null;
  explanation: string | null;
  outcome: "correct" | "incorrect" | null;
  next: { to: McqStage; field: McqField | null; minLength: number } | null;
};

type Question = { id: string; order: number; questionText: string; stage: McqStage };

type ListeningKey = Exclude<keyof Dictionary["listening"], "type">;

const STAGE_LABEL: Record<McqStage, ListeningKey> = {
  listen: "mcqStageListen",
  notes: "mcqStageNotes",
  committed: "mcqStageCommitted",
  revealed: "mcqStageRevealed",
  chosen: "mcqStageChosen",
  reasoned: "mcqStageReasoned",
};

const FIELD_LABEL: Record<McqField, ListeningKey> = {
  notes: "mcqNotesLabel",
  ownAnswer: "mcqOwnAnswerLabel",
  chosenAnswer: "mcqChoose",
  reasoning: "mcqReasoningLabel",
};

/**
 * MCQ Mastery — options are never in this bundle.
 *
 * The questions handed to this component carry an id, an order and the question
 * text. The choices live in the database and are only sent by the API once the
 * session has reached `revealed`, so "hiding" the answers is a server decision
 * rather than a CSS class.
 */
export function McqMastery({
  dict,
  questions: initialQuestions,
}: {
  dict: Dictionary;
  questions: Question[];
}) {
  const requestResponse = useScopedResponse(25000);

  const [questions, setQuestions] = useState(initialQuestions);
  const [open, setOpen] = useState<string | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (questions.length === 0) {
    return (
      <Card>
        <h2 className="font-display text-lg text-ink-900">{dict.listening.mcqTitle}</h2>
        <p className="mt-1 text-sm text-ink-500">{dict.listening.mcqEmpty}</p>
      </Card>
    );
  }

  async function openDrill(questionId: string) {
    setBusy(true);
    setError(null);
    setText("");
    const res = await requestResponse("/api/listening/mcq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId }),
    });
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      setError(dict.common.error);
      return;
    }
    setPayload((await res.json()) as Payload);
    setOpen(questionId);
  }

  async function advance() {
    if (!payload) return;
    const step = payload.next;
    if (!step) return;
    setBusy(true);
    setError(null);
    const res = await requestResponse(`/api/listening/mcq/${payload.session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: step.to, text: step.field ? text : undefined }),
    });
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      setError(dict.common.error);
      return;
    }
    const next = (await res.json()) as Payload;
    setPayload(next);
    setText("");
    setQuestions((prev) =>
      prev.map((q) => (q.id === next.question.id ? { ...q, stage: next.session.stage } : q))
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink-900">{dict.listening.mcqTitle}</h2>
        <span className="text-xs text-ink-300">{dict.listening.mcqHint}</span>
      </div>

      <ul className="mt-3 flex flex-col divide-y divide-ink-100">
        {questions.map((q) => {
          const isOpen = open === q.id && payload;
          return (
            <li key={q.id} className="py-3" data-mcq-question={q.id} data-mcq-stage={q.stage}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-ink-900">
                    {q.order}. {q.questionText}
                  </p>
                  <p className="text-xs text-ink-300">{dict.listening[STAGE_LABEL[q.stage]]}</p>
                </div>
                {!isOpen && (
                  <Button
                    variant="secondary"
                    onClick={() => openDrill(q.id)}
                    disabled={busy}
                    data-mcq-open={q.id}
                  >
                    {q.stage === "listen" ? dict.listening.mcqStart : dict.listening.mcqResume}
                  </Button>
                )}
              </div>

              {isOpen && payload && payload.question.id === q.id && (
                <div className="mt-3 rounded-sm border border-ink-100 p-3">
                  {/* Before the reveal, the options are not in this page at all. */}
                  {!payload.options && (
                    <p className="mb-2 text-xs text-ink-300" data-mcq-options-hidden>
                      {dict.listening.mcqHiddenNote}
                    </p>
                  )}

                  {payload.next?.field && payload.next.field !== "chosenAnswer" && (
                    <>
                      <label className="mb-1 block text-xs font-medium text-ink-500" htmlFor={`mcq-${q.id}`}>
                        {dict.listening[FIELD_LABEL[payload.next.field]]}
                      </label>
                      <textarea
                        id={`mcq-${q.id}`}
                        className="input min-h-[70px] w-full"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        data-mcq-input
                      />
                    </>
                  )}

                  {payload.options && (
                    <div className="flex flex-col gap-1.5" data-mcq-options>
                      {payload.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          data-mcq-option={option}
                          disabled={payload.session.stage !== "revealed"}
                          className={`rounded-sm border px-3 py-1.5 text-left text-sm ${
                            payload.session.chosenAnswer === option
                              ? "border-signal-600 bg-signal-50 text-ink-900"
                              : "border-ink-100 text-ink-700"
                          }`}
                          onClick={() => setText(option)}
                        >
                          {option}
                        </button>
                      ))}
                      {payload.session.stage === "revealed" && payload.next?.field === "chosenAnswer" && (
                        <p className="mt-1 text-xs text-ink-300">{dict.listening.mcqChoose}</p>
                      )}
                    </div>
                  )}

                  {payload.outcome && (
                    <p
                      className={`mt-2 text-sm ${payload.outcome === "correct" ? "text-band-good" : "text-band-bad"}`}
                      data-mcq-outcome={payload.outcome}
                    >
                      {payload.outcome === "correct"
                        ? dict.listening.mcqOutcomeCorrect
                        : dict.listening.mcqOutcomeIncorrect}
                    </p>
                  )}

                  {payload.explanation && (
                    <p className="mt-1 text-sm text-ink-500" data-mcq-explanation>
                      {payload.explanation}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {payload.next ? (
                      <Button
                        onClick={advance}
                        disabled={
                          busy ||
                          (payload.next.field !== null && text.trim().length < payload.next.minLength)
                        }
                        data-mcq-advance={payload.next.to}
                      >
                        {payload.next.to === "revealed"
                          ? dict.listening.mcqReveal
                          : dict.listening.mcqContinue}
                      </Button>
                    ) : (
                      <span className="text-sm text-band-good" data-mcq-done>
                        {dict.listening.mcqDone}
                      </span>
                    )}
                    <span className="text-xs text-ink-300">{dict.listening.mcqPracticeOnly}</span>
                  </div>

                  {error && <p className="mt-2 text-sm text-band-bad">{error}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
