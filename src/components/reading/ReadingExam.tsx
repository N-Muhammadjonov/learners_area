"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { choiceSetFor } from "@/lib/reading-choices";
import { occurrenceSpans, type OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { IconBack, IconCheck, IconTarget } from "@/components/ui/icons";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import {
  buildSharedStimulus,
  isSharedStimulusRow,
  parseStimulus,
  type SharedStimulus,
} from "@/lib/reading/stimulus";
import type { ResourceBlockView } from "@/lib/data/resources";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The reading practice workspace.
 *
 * This used to be two plain columns: the passage on the left, every question in
 * one flat list on the right. That made a real IELTS passage unusable, for three
 * reasons that all came from the same gap in the data layer:
 *
 *   * a group's instructions were never loaded, so "Choose TWO letters, A–E" —
 *     which is the actual task — was missing and several questions rendered as a
 *     bare number;
 *   * the paragraph letters (A, B, C …) that matching questions refer to were
 *     never loaded either;
 *   * an open attempt lived only in the tab: reload and every answer was gone.
 *
 * So: the passage keeps its paragraphs and their letters, the questions are
 * grouped under their own instruction blocks, a blank in a question prompt is a
 * real input in the sentence, and answers are saved to the server while the
 * student works. Nothing here decides whether an answer is right — that happens
 * once, on the server, when the attempt is submitted.
 */

type QuestionType =
  | "true_false_not_given"
  | "yes_no_not_given"
  | "multiple_choice"
  | "short_answer";

export type ExamQuestion = {
  id: string;
  order: number;
  questionNo: number | null;
  type: QuestionType;
  typeCode: string | null;
  groupId: string | null;
  /** "question_row" or "shared_stimulus_slot" — decides how the prompt is drawn. */
  renderMode: string | null;
  questionText: string;
  options: string[] | null;
  acceptedAnswers: string[];
  answerConstraint: Record<string, unknown> | null;
};

export type ExamGroup = {
  id: string;
  position: number;
  typeCode: string;
  displayTitle: string | null;
  instructionsText: string | null;
  fromQuestionNo: number | null;
  toQuestionNo: number | null;
  sharedChoices: string[];
};

export type ExamParagraph = {
  id: string;
  position: number;
  label: string | null;
  text: string;
  isFootnote: boolean;
};

const SAVE_DEBOUNCE_MS = 900;
/** "A — Paragraph A" is an option with a letter in front; plain text is not. */
const LABELLED_OPTION = /^([A-Z])\s*[—–-]\s*(\S.*)$/;

function optionLetter(choice: string, index: number): { letter: string; text: string } {
  const match = LABELLED_OPTION.exec(choice);
  if (match) return { letter: match[1]!, text: match[2]! };
  return { letter: String.fromCharCode(65 + index), text: choice };
}

function lettersOnly(choices: string[]): boolean {
  return choices.length > 0 && choices.every((choice) => LABELLED_OPTION.test(choice));
}

type Constraint = {
  max_words?: number;
  number_allowed?: boolean;
  selection_count?: number;
  allowed_values?: string[];
};

function constraintOf(question: ExamQuestion): Constraint {
  return (question.answerConstraint ?? {}) as Constraint;
}

/**
 * The choices a question is answered with, in the order a student sees them:
 * the source's own allowed values when it names them, otherwise the three
 * standard answers for the type.
 */
function ternaryChoices(question: ExamQuestion): { value: string; label: string }[] {
  const allowed = constraintOf(question).allowed_values;
  if (allowed && allowed.length > 0) {
    return allowed.map((value) => ({
      value: value.toLowerCase().trim().replace(/\s+/g, "_"),
      label: value,
    }));
  }
  return Object.values(choiceSetFor(question.type as "true_false_not_given" | "yes_no_not_given")).map(
    (choice) => ({ value: choice.value, label: choice.label })
  );
}

function constraintLabel(constraint: Constraint, dict: Dictionary): string | null {
  const t = dict.readingPractice;
  const parts: string[] = [];
  if (typeof constraint.selection_count === "number") parts.push(t.constraintSelect.replace("{n}", String(constraint.selection_count)));
  if (typeof constraint.max_words === "number") {
    parts.push(constraint.max_words === 1 ? t.constraintOneWord : t.constraintWords.replace("{n}", String(constraint.max_words)));
  }
  if (constraint.number_allowed) parts.push(t.constraintNumber);
  return parts.length ? parts.join(" · ") : null;
}

/** mm:ss for the first hour, h:mm:ss after that — a 20-minute task rarely needs it. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function ReadingExam({
  dict,
  attemptId,
  passageTitle,
  passageBody,
  passageMeta,
  questions,
  groups,
  paragraphs,
  savedAnswers,
  startedAt,
  materials = [],
  occurrences = [],
}: {
  dict: Dictionary;
  attemptId: string;
  passageTitle: string;
  passageBody: string;
  /** "Test 2, Passage 3" — null when the passage did not come from an imported test. */
  passageMeta: string | null;
  questions: ExamQuestion[];
  groups: ExamGroup[];
  paragraphs: ExamParagraph[];
  /** Whatever the student had already typed, restored from the server. */
  savedAnswers: Record<string, string>;
  /** ISO timestamp of when the attempt started (UTC from the database). */
  startedAt: string;
  /** Blocks an administrator attached to this passage; empty means no section. */
  materials?: ResourceBlockView[];
  occurrences?: OccurrenceSpan[];
}) {
  const t = dict.readingPractice;
  const router = useRouter();

  const [answers, setAnswers] = useState<Record<string, string>>(savedAnswers);
  const [pane, setPane] = useState<"passage" | "questions">("passage");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "locked">(
    Object.keys(savedAnswers).length > 0 ? "saved" : "idle"
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // The two refs that make autosave honest: one request at a time, and never a
  // lost keystroke — a change made while a save is in flight is saved right after.
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const locked = useRef(false);
  const answersRef = useRef(answers);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  answersRef.current = answers;

  /** Send every answer of this attempt; the server replaces the attempt's drafts. */
  const save = useCallback(async () => {
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    if (!dirty.current) return;
    inFlight.current = true;
    dirty.current = false;
    setSaveState("saving");
    try {
      const entries = Object.entries(answersRef.current).map(([questionId, answer]) => ({
        questionId,
        answer,
      }));
      const res = await fetch(`/api/reading/attempts/${attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: entries }),
      });
      if (res.status === 409) {
        // Submitted elsewhere: stop pretending this is still a draft.
        locked.current = true;
        setSaveState("locked");
        return;
      }
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setSaveState("saved");
      setSavedAt(
        new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      );
    } catch {
      // The answers stay on screen and the button offers a retry — the failure is
      // never allowed to look like success.
      dirty.current = true;
      setSaveState("error");
    } finally {
      inFlight.current = false;
      if (dirty.current && !locked.current) {
        // A change arrived while saving; schedule the follow-up.
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
      }
    }
  }, [attemptId]);

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  }

  // Leaving the tab, switching apps on a phone, or closing the laptop: the
  // browser gives us one last turn, and the write is sent synchronously as a
  // keepalive request so a half-written answer is not lost.
  useEffect(() => {
    function flush() {
      if (!dirty.current) return;
      dirty.current = false;
      try {
        void fetch(`/api/reading/attempts/${attemptId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: Object.entries(answersRef.current).map(([questionId, answer]) => ({
              questionId,
              answer,
            })),
          }),
          keepalive: true,
        });
      } catch {
        // Nothing useful can be shown while the page is going away.
      }
    }
    function onHidden() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attemptId]);

  // The timer is derived from the attempt's own start time, so a reload does not
  // restart it. Rendered only after mount to keep the server and client HTML equal.
  useEffect(() => {
    const started = new Date(startedAt).getTime();
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const answered = useMemo(() => questions.filter((q) => (answers[q.id] ?? "").trim() !== "").length, [questions, answers]);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  /**
   * Questions in the order the paper presents them: by their group's position
   * first, and by their own order inside it. Questions without a group keep the
   * flat order they were stored in.
   */
  const orderedGroups = useMemo(() => {
    const sorted = [...groups].sort((a, b) => a.position - b.position);
    const byGroup = new Map<string, ExamQuestion[]>();
    const orphan: ExamQuestion[] = [];
    for (const question of questions) {
      if (question.groupId && groupById.has(question.groupId)) {
        const list = byGroup.get(question.groupId) ?? [];
        list.push(question);
        byGroup.set(question.groupId, list);
      } else {
        orphan.push(question);
      }
    }
    return {
      blocks: sorted.map((group) => ({
        group,
        questions: (byGroup.get(group.id) ?? []).sort((a, b) => a.order - b.order),
      })),
      orphan: orphan.sort((a, b) => a.order - b.order),
    };
  }, [groups, questions, groupById]);

  async function onSubmit() {
    if (!confirm(dict.reading.submitConfirm)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reading/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? "" })),
        }),
      });
      if (res.status === 409) {
        setSaveState("locked");
        setError(dict.readingPractice.saveSubmitted);
        return;
      }
      if (!res.ok) throw new Error(`submit failed: ${res.status}`);
      dirty.current = false;
      router.refresh();
    } catch {
      setError(t.submitError);
    } finally {
      // A submit that fails must hand the screen back, every time.
      setSubmitting(false);
    }
  }

  const questionCount = questions.length;

  return (
    <div className="flex flex-col gap-4" data-reading-practice data-attempt={attemptId}>
      {/*
        One workspace header on every viewport: the timer and the save state are
        the two things a student checks mid-task, so they stay together and stay
        visible — including in Focus mode, which only hides the shell.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-ink-100 bg-paper-raised px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg text-ink-900">{passageTitle}</h1>
          <p className="text-xs text-ink-300">
            {passageMeta ? `${passageMeta} · ` : ""}
            {dict.reading.questions}: {questionCount}
          </p>
        </div>
        <span className="flex items-center gap-2 text-sm text-ink-700" data-practice-timer>
          <span className="text-ink-300">{t.timerLabel}</span>
          <span className="font-mono tabular-nums">{now === null ? "--:--" : formatDuration(now - new Date(startedAt).getTime())}</span>
        </span>
        <SaveBadge dict={dict} state={saveState} savedAt={savedAt} onRetry={() => void save()} />
        <a href="/reading" className="flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 text-sm text-ink-500 hover:text-ink-900" data-practice-exit>
          <IconBack className="text-[18px]" />
          {t.exit}
        </a>
      </div>

      {/* Mobile keeps one pane at a time; the tabs are real buttons, 44px tall. */}
      <div className="flex gap-2 lg:hidden" role="tablist" aria-label={dict.reading.practiceTitle}>
        {(
          [
            { key: "passage", label: t.passageTab },
            { key: "questions", label: t.questionsTab },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={pane === tab.key}
            data-practice-tab={tab.key}
            onClick={() => setPane(tab.key)}
            className={
              pane === tab.key
                ? "min-h-[44px] flex-1 rounded-sm border border-signal-600 bg-signal-600 px-3 text-sm font-medium text-white"
                : "min-h-[44px] flex-1 rounded-sm border border-ink-100 bg-paper-raised px-3 text-sm text-ink-700"
            }
          >
            {tab.label}
            {tab.key === "questions" && (
              <span className="ml-2 text-xs opacity-80">{t.answered.replace("{answered}", String(answered)).replace("{total}", String(questionCount))}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[58fr_42fr]">
        <section
          className={`card flex-col gap-3 p-5 lg:flex ${pane === "passage" ? "flex" : "hidden"}`}
          aria-label={t.passageTab}
          data-practice-pane="passage"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-3">
            <h2 className="font-display text-base text-ink-900">{passageTitle}</h2>
            <ReadAloud dict={dict} text={`${passageTitle}. ${passageBody}`} />
          </div>
          <p className="text-xs text-ink-300">{t.wordSaveHint}</p>

          <div className="flex flex-col gap-4 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-2" data-passage-body>
            {paragraphs.length > 0 ? (
              paragraphs.map((paragraph) => (
                <div key={paragraph.id} className="flex gap-3" data-paragraph={paragraph.label ?? "none"}>
                  {/* A letter only when the passage really labels that paragraph —
                      numbering an unlabelled paragraph would invent a reference the
                      questions cannot use. */}
                  {paragraph.label ? (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-xs font-semibold text-ink-700">
                      {paragraph.label}
                    </span>
                  ) : (
                    <span className="w-7 shrink-0" aria-hidden />
                  )}
                  <ClickableText
                    dict={dict}
                    text={paragraph.text}
                    occurrences={occurrenceSpans(passageBody, paragraph.text, occurrences)}
                    sourceType="reading"
                    sourceId={attemptId}
                    className={`text-sm leading-relaxed text-ink-700 ${paragraph.isFootnote ? "italic" : ""}`}
                  />
                </div>
              ))
            ) : (
              // A passage that was stored as one block of text still renders.
              <ClickableText
                dict={dict}
                text={passageBody}
                occurrences={occurrenceSpans(passageBody, passageBody, occurrences)}
                sourceType="reading"
                sourceId={attemptId}
                className="text-sm leading-relaxed text-ink-700"
              />
            )}
          </div>

          <ResourceBlocks dict={dict} blocks={materials} />
        </section>

        <section
          className={`flex-col gap-4 lg:flex ${pane === "questions" ? "flex" : "hidden"}`}
          aria-label={t.questionsTab}
          data-practice-pane="questions"
        >
          <div className="flex items-center justify-between gap-2 lg:hidden">
            <span className="text-xs text-ink-500">
              {t.answered.replace("{answered}", String(answered)).replace("{total}", String(questionCount))}
            </span>
            <button
              type="button"
              className="flex min-h-[44px] items-center gap-1.5 text-sm text-ink-700"
              onClick={() => setPane("passage")}
            >
              <IconTarget className="text-[18px]" />
              {t.passageTab}
            </button>
          </div>

          <div className="flex flex-col gap-3 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-2">
            {orderedGroups.blocks.map(({ group, questions: groupQuestions }) => (
              <div key={group.id} className="flex flex-col gap-3" data-question-group={group.position}>
                <GroupHeading dict={dict} group={group} />
                <GroupQuestions
                  dict={dict}
                  group={group}
                  questions={groupQuestions}
                  answers={answers}
                  onChange={setAnswer}
                />
              </div>
            ))}

            {orderedGroups.orphan.length > 0 && (
              <div className="flex flex-col gap-3" data-question-group="ungrouped">
                {orderedGroups.orphan.map((question) => (
                  <QuestionCard
                    key={question.id}
                    dict={dict}
                    question={question}
                    group={null}
                    value={answers[question.id] ?? ""}
                    onChange={(value) => setAnswer(question.id, value)}
                    inputId={`answer-${question.id}`}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-[16px] border border-ink-100 bg-paper-raised p-4">
            <div className="flex items-center justify-between text-sm text-ink-700">
              <span>{t.answered.replace("{answered}", String(answered)).replace("{total}", String(questionCount))}</span>
              {saveState === "error" && <span className="text-band-bad">{t.unsavedWarning}</span>}
            </div>
            <p className="text-xs text-ink-300">{t.submitHint}</p>
            {error && (
              <p className="text-sm text-band-bad" role="alert">
                {error}
              </p>
            )}
            <Button onClick={() => void onSubmit()} disabled={submitting || saveState === "locked"} data-submit-attempt>
              {submitting ? dict.common.loading : dict.reading.submit}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** "Saved 14:32" / "Saving…" / a retry when the write failed. */
function SaveBadge({
  dict,
  state,
  savedAt,
  onRetry,
}: {
  dict: Dictionary;
  state: "idle" | "saving" | "saved" | "error" | "locked";
  savedAt: string | null;
  onRetry: () => void;
}) {
  const t = dict.readingPractice;
  if (state === "error") {
    return (
      <span className="flex items-center gap-2 text-sm text-band-bad" data-save-state="error">
        {t.saveError}
        <button type="button" onClick={onRetry} className="underline" data-save-retry>
          {t.saveRetry}
        </button>
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className="text-sm text-ink-500" data-save-state="locked">
        {t.saveSubmitted}
      </span>
    );
  }
  const label =
    state === "saving"
      ? t.saveSaving
      : state === "saved" && savedAt
        ? t.saveSaved.replace("{time}", savedAt)
        : state === "saved"
          ? t.saveSaved.replace("{time}", "--:--")
          : t.saveIdle;
  return (
    <span className="flex items-center gap-1.5 text-sm text-ink-500" data-save-state={state}>
      {state === "saved" && <IconCheck className="text-[16px] text-band-good" />}
      {label}
    </span>
  );
}

/** The instruction block a group of questions belongs to. */
function GroupHeading({ dict, group }: { dict: Dictionary; group: ExamGroup }) {
  const range = group.displayTitle
    ? null
    : group.fromQuestionNo && group.toQuestionNo
      ? dict.readingPractice.groupQuestions
          .replace("{from}", String(group.fromQuestionNo))
          .replace("{to}", String(group.toQuestionNo))
      : null;
  return (
    <div className="rounded-[16px] border border-ink-100 bg-paper-sunken p-4" data-group-instructions={group.typeCode}>
      {(group.displayTitle || range) && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {group.displayTitle ?? range}
        </p>
      )}
      {group.instructionsText && (
        <p className="whitespace-pre-line text-sm text-ink-700">{group.instructionsText}</p>
      )}
      {group.sharedChoices.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2" data-group-choices>
          {group.sharedChoices.map((choice, index) => {
            const { letter, text } = optionLetter(choice, index);
            return (
              <li key={choice} className="text-sm text-ink-700">
                <span className="mr-1.5 font-semibold text-ink-900">{letter}</span>
                {text}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One group's questions.
 *
 * Notes, summaries and flow-charts ask several questions inside one piece of
 * text, which arrives as overlapping windows around each blank (see
 * `@/lib/reading/stimulus`). Those rows are rebuilt into a single stimulus with
 * an input on every blank; the rows that are questions in their own right — and
 * any shared row whose blank the reconstruction could not find — stay as normal
 * cards, so nothing is ever shown twice and nothing is dropped.
 */
function GroupQuestions({
  dict,
  group,
  questions,
  answers,
  onChange,
}: {
  dict: Dictionary;
  group: ExamGroup;
  questions: ExamQuestion[];
  answers: Record<string, string>;
  onChange: (questionId: string, value: string) => void;
}) {
  const shared = useMemo(() => questions.filter((question) => isSharedStimulusRow(question)), [questions]);
  const stimulus = useMemo(() => (shared.length > 0 ? buildSharedStimulus(shared) : null), [shared]);
  const byNumber = useMemo(() => {
    const map = new Map<number, ExamQuestion>();
    for (const question of questions) if (question.questionNo !== null) map.set(question.questionNo, question);
    return map;
  }, [questions]);

  const covered = new Set(stimulus?.numbers ?? []);
  const cards = questions.filter(
    (question) => !isSharedStimulusRow(question) || question.questionNo === null || !covered.has(question.questionNo)
  );

  return (
    <>
      {stimulus && stimulus.numbers.length > 0 && (
        <StimulusCard
          dict={dict}
          group={group}
          stimulus={stimulus}
          byNumber={byNumber}
          answers={answers}
          onChange={onChange}
        />
      )}
      {cards.map((question) => (
        <QuestionCard
          key={question.id}
          dict={dict}
          question={question}
          group={group}
          value={answers[question.id] ?? ""}
          onChange={(value) => onChange(question.id, value)}
          inputId={`answer-${question.id}`}
        />
      ))}
    </>
  );
}

/** The rebuilt notes / summary / flow-chart, with an input on every blank. */
function StimulusCard({
  dict,
  group,
  stimulus,
  byNumber,
  answers,
  onChange,
}: {
  dict: Dictionary;
  group: ExamGroup;
  stimulus: SharedStimulus;
  byNumber: Map<number, ExamQuestion>;
  answers: Record<string, string>;
  onChange: (questionId: string, value: string) => void;
}) {
  const paragraphs = stimulus.text.split(/\n{2,}/);
  return (
    <div className="card flex flex-col p-4" data-stimulus={group.position} data-stimulus-type={group.typeCode}>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p
          key={paragraphIndex}
          className={`whitespace-pre-line text-sm leading-relaxed text-ink-900 ${paragraphIndex > 0 ? "mt-3" : ""}`}
        >
          {parseStimulus(paragraph).map((segment, index) => {
            if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
            const question = byNumber.get(segment.questionNo);
            if (!question) {
              // The number belongs to a question this group does not contain:
              // show the printed number, never an input that writes nowhere.
              return (
                <span key={index} className="mx-1 rounded-sm bg-paper-sunken px-1.5 text-xs text-ink-500">
                  {segment.questionNo}
                </span>
              );
            }
            const value = answers[question.id] ?? "";
            return (
              <span
                key={index}
                className="whitespace-nowrap"
                data-answer-slot={segment.questionNo}
                data-answered={value.trim() ? "true" : "false"}
              >
                <span
                  className="mr-1 align-baseline text-xs font-semibold text-ink-500"
                  data-stimulus-number={segment.questionNo}
                >
                  {segment.questionNo}
                </span>
                <input
                  id={`answer-${question.id}`}
                  value={value}
                  onChange={(event) => onChange(question.id, event.target.value.slice(0, 200))}
                  placeholder={dict.reading.yourAnswer}
                  aria-label={`${dict.reading.yourAnswer} ${segment.questionNo}`}
                  autoComplete="off"
                  spellCheck={false}
                  data-answer-input={question.id}
                  className={`input mx-1 inline-block w-auto min-w-[7ch] max-w-[16rem] px-2 py-1 align-baseline ${
                    value.trim() ? "border-signal-600/40" : ""
                  }`}
                  style={{ width: `${Math.min(24, Math.max(8, value.length + 3))}ch` }}
                />
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function QuestionCard({
  dict,
  question,
  group,
  value,
  onChange,
  inputId,
}: {
  dict: Dictionary;
  question: ExamQuestion;
  group: ExamGroup | null;
  value: string;
  onChange: (value: string) => void;
  inputId: string;
}) {
  const t = dict.readingPractice;
  const constraint = constraintOf(question);
  const isTernary = question.type === "true_false_not_given" || question.type === "yes_no_not_given";
  const isText = question.type === "short_answer" && !isTernary;
  const choices = question.options && question.options.length > 0 ? question.options : (group?.sharedChoices ?? []);
  const showFullChoices = !isTernary && choices.length > 0 && !lettersOnly(choices);
  const showLetterChips = !isTernary && choices.length > 0 && lettersOnly(choices);
  const hint = constraintLabel(constraint, dict);
  const number = question.questionNo ?? question.order;

  /**
   * A blank in the middle of the sentence is where the answer goes, so the text
   * is split around it and the input is rendered in place — the student reads a
   * sentence, not a sentence and a detached field.
   */
  const parts = isText ? question.questionText.split(/_{3,}/) : [question.questionText];
  const inline = isText && parts.length > 1;

  return (
    <div
      className={`card p-4 ${value.trim() ? "border-signal-600/40" : ""}`}
      data-question={question.id}
      data-question-no={number}
      data-answered={value.trim() ? "true" : "false"}
    >
      <div className="mb-2 flex items-start gap-3">
        <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paper-sunken px-1.5 text-xs font-semibold text-ink-700">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          {question.questionText.trim() === "" ? (
            <p className="text-sm text-ink-500">{t.chooseLetter}</p>
          ) : inline ? (
            <p className="text-sm leading-relaxed text-ink-900">
              {parts.map((part, index) => (
                <span key={index}>
                  {part}
                  {index < parts.length - 1 && (
                    <input
                      id={index === 0 ? inputId : `${inputId}-${index}`}
                      value={value}
                      onChange={(event) => onChange(event.target.value.slice(0, 200))}
                      placeholder={dict.reading.yourAnswer}
                      aria-label={`${dict.reading.yourAnswer} ${number}`}
                      autoComplete="off"
                      spellCheck={false}
                      data-answer-input={question.id}
                      className="input mx-1 inline-block w-auto min-w-[7ch] max-w-[16rem] px-2 py-1 align-baseline"
                      style={{ width: `${Math.min(24, Math.max(8, value.length + 3))}ch` }}
                    />
                  )}
                </span>
              ))}
            </p>
          ) : (
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-900">{question.questionText}</p>
          )}
          {hint && <p className="mt-1 text-xs text-ink-300">{hint}</p>}
        </div>
      </div>

      {isTernary && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${dict.reading.yourAnswer} ${number}`}>
          {ternaryChoices(question).map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={value === choice.value}
              data-answer-option={choice.value}
              onClick={() => onChange(value === choice.value ? "" : choice.value)}
              className={`min-h-[44px] rounded-sm border px-3 text-sm ${
                value === choice.value
                  ? "border-signal-600 bg-signal-600 font-medium text-white"
                  : "border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {showLetterChips && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${dict.reading.yourAnswer} ${number}`}>
          {choices.map((choice, index) => {
            const { letter, text } = optionLetter(choice, index);
            const selected = value === choice;
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${letter}: ${text}`}
                title={text}
                data-answer-option={letter}
                onClick={() => onChange(selected ? "" : choice)}
                className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border px-3 text-sm font-semibold ${
                  selected
                    ? "border-signal-600 bg-signal-600 text-white"
                    : "border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken"
                }`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}

      {showFullChoices && (
        <ul className="flex flex-col gap-1.5" data-full-choices>
          {choices.map((choice, index) => {
            const { letter, text } = optionLetter(choice, index);
            const id = `${inputId}-${index}`;
            return (
              <li key={choice}>
                <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-ink-700">
                  <input
                    id={id}
                    type="radio"
                    name={inputId}
                    checked={value === choice}
                    onChange={() => onChange(choice)}
                  />
                  <span>
                    <span className="mr-1.5 font-semibold text-ink-900">{letter}</span>
                    {text}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {isText && !inline && (
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 200))}
          placeholder={t.yourAnswerPlaceholder}
          aria-label={`${dict.reading.yourAnswer} ${number}`}
          autoComplete="off"
          spellCheck={false}
          data-answer-input={question.id}
          className="input"
        />
      )}
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
      className="btn-ghost min-h-[44px] text-xs"
      data-read-aloud
      title={dict.readingPractice.readAloudHint}
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
