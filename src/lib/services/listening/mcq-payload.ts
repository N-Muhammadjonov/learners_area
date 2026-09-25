import type { listeningQuestions, listeningMcqSessions } from "@/db/schema";
import {
  nextStep,
  optionsVisible,
  outcomeVisible,
  type McqField,
  type McqStage,
} from "@/lib/services/listening/mcq-mastery";

type Session = typeof listeningMcqSessions.$inferSelect;
type Question = typeof listeningQuestions.$inferSelect;

export type McqPayload = {
  session: {
    id: string;
    stage: McqStage;
    notes: string | null;
    ownAnswer: string | null;
    chosenAnswer: string | null;
    reasoning: string | null;
  };
  question: { id: string; order: number; questionText: string };
  /**
   * Withheld (`null`) until the session reaches `revealed` — the server, not the
   * browser, decides when the student may see the menu.
   */
  options: string[] | null;
  correctAnswer: string | null;
  explanation: string | null;
  outcome: "correct" | "incorrect" | null;
  next: { to: McqStage; field: McqField | null; minLength: number } | null;
};

export function buildMcqPayload(session: Session, question: Question): McqPayload {
  const stage = session.stage as McqStage;
  const visible = optionsVisible(stage);
  const step = nextStep(stage);

  return {
    session: {
      id: session.id,
      stage,
      notes: session.notes,
      ownAnswer: session.ownAnswer,
      chosenAnswer: session.chosenAnswer,
      reasoning: session.reasoning,
    },
    question: { id: question.id, order: question.order, questionText: question.questionText },
    options: visible ? question.options ?? null : null,
    correctAnswer: visible ? question.correctAnswer : null,
    explanation: visible ? question.explanation : null,
    outcome: outcomeVisible(stage)
      ? session.chosenAnswer === question.correctAnswer
        ? "correct"
        : "incorrect"
      : null,
    next: step ? { to: step.to, field: step.field, minLength: step.minLength } : null,
  };
}
