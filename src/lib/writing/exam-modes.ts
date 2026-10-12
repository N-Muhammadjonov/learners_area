import type { WritingTask } from "@/lib/writing/grade-criteria";

export type ExamMode = "task1" | "task2" | "full";

/** Real Exam paper shapes (§13). Durations mirror the 0032 CHECK constraint. */
export const EXAM_MODES: Record<ExamMode, { durationSeconds: number; tasks: readonly WritingTask[] }> = {
  task1: { durationSeconds: 1200, tasks: ["task1"] },
  task2: { durationSeconds: 2400, tasks: ["task2"] },
  full: { durationSeconds: 3600, tasks: ["task1", "task2"] },
};

export const EXAM_MIN_WORDS: Record<WritingTask, number> = { task1: 150, task2: 250 };

/** Seconds after the deadline during which only the final in-flight flush is accepted. */
export const EXAM_SAVE_GRACE_SECONDS = 15;

/** Client autosave debounce (ms). Never one request per keystroke. */
export const EXAM_AUTOSAVE_DEBOUNCE_MS = 1500;

export function isExamMode(value: unknown): value is ExamMode {
  return value === "task1" || value === "task2" || value === "full";
}

/**
 * Full Writing combined band: Task 2 carries double weight, (T1 + 2·T2) / 3,
 * rounded to the nearest half band (ties up), as IELTS reports it.
 */
export function fullPaperBand(task1: number, task2: number): number {
  return Math.round(((task1 + 2 * task2) / 3) * 2) / 2;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
