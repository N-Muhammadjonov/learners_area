"use client";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { NativeListeningExam, type ListeningExamQuestion, type ListeningTextSurfaceProps } from "./NativeListeningExam";
import type { MapDiagram } from "@/lib/listening/map-diagram";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * A GENERAL LISTENING SECTION — the owner's one activity for one section.
 *
 * Why this wrapper exists at all: the exam screen (`NativeListeningExam`) is shared with the
 * graded Academic full test, which must reveal nothing — no word lookup, no meaning — and a
 * protection test enforces that the exam file carries no lexical code whatsoever. So the
 * learning surface is composed HERE, by the section, and handed to the exam as an injected
 * text surface. The exam keeps its single responsibility (timing, questions, saving,
 * submitting) and the section gets the canonical Dictionary surface without a second text
 * architecture and without weakening the exam's guarantee.
 *
 * The lookup's identity is the canonical one — source type `listening`, source id THE TEST —
 * so a word saved from a section lands in the learner's Listening vocabulary against the same
 * source a full test would record, and no third source type is invented.
 *
 * `lexicalAssistance` comes from the canonical policy (`lexicalAssistanceAllowed` with the
 * mode the source's own product implies), so the decision of whether a learner may look a word
 * up is made in exactly one place — the same place the lexical API routes ask.
 */
export function SectionListeningActivity({
  lexicalAssistance,
  ...exam
}: {
  dict: Dictionary;
  attemptId: string;
  testId: string;
  title: string;
  audioUrl: string;
  imageUrl: string | null;
  mapDiagram?: MapDiagram;
  questions: ListeningExamQuestion[];
  initial: Record<string, string>;
  audioPosition: number;
  audioStartedAt: string | null;
  duration?: number;
  /** May this learner look a word up and highlight it, from the shared lexical policy? */
  lexicalAssistance: boolean;
}) {
  const surface = lexicalAssistance
    ? ({ text, textKey, className, highlights, onHighlightRange, onRemoveHighlight }: ListeningTextSurfaceProps) => (
        <ClickableText
          dict={exam.dict}
          text={text}
          inline
          className={className}
          sourceType="listening"
          sourceId={exam.testId}
          highlights={highlights}
          onHighlightRange={onHighlightRange}
          onRemoveHighlight={onRemoveHighlight}
        />
      )
    : undefined;
  return <NativeListeningExam {...exam} sectionMode textSurface={surface} />;
}
