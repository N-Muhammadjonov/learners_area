/**
 * Grade My Work — the exact four IELTS Writing criteria (owner spec §42.3–42.4).
 * Pure: no I/O. The server, not the provider, decides labels, rounding and
 * the overall band.
 */
export type WritingTask = "task1" | "task2";
export type CriterionKey = "task_achievement" | "task_response" | "coherence_cohesion" | "lexical_resource" | "grammatical_range_accuracy";

export const WRITING_GRADE_PROMPT_VERSION = "writing-ielts-v2";
export const WRITING_GRADE_RUBRIC_VERSION = "ielts-writing-four-criteria-v1";

export function criteriaFor(task: WritingTask): readonly CriterionKey[] {
  return [task === "task1" ? "task_achievement" : "task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"];
}

export const CRITERION_LABEL: Record<CriterionKey, string> = {
  task_achievement: "Task Achievement",
  task_response: "Task Response",
  coherence_cohesion: "Coherence & Cohesion",
  lexical_resource: "Lexical Resource",
  grammatical_range_accuracy: "Grammatical Range & Accuracy",
};

/** Which canonical slot a provider key/label belongs to. */
export function slotOf(raw: string): "task" | "coherence_cohesion" | "lexical_resource" | "grammatical_range_accuracy" | null {
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (k.startsWith("task") || k === "ta" || k === "tr") return "task";
  if (k.startsWith("coherence") || k === "cc") return "coherence_cohesion";
  if (k.startsWith("lexical") || k === "lr") return "lexical_resource";
  if (k.startsWith("grammatical") || k.startsWith("grammar") || k === "gra") return "grammatical_range_accuracy";
  return null;
}

/** 0..9 in half bands. Values like 6.37 normalise to 6.5; non-numbers and out-of-range values are rejected. */
export function toHalfBand(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9) return null;
  return Math.round(value * 2) / 2;
}

/** IELTS-style overall: mean of the four criteria to the nearest half band (x.25 → x.5, x.75 → x+1). */
export function deriveOverall(bands: readonly number[]): number {
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  return Math.round(mean * 2) / 2;
}

export type NormalizedCriterion = { key: CriterionKey; label: string; band: number; note: string | null };

/**
 * Map provider criteria onto the exact four for the task. Returns null when
 * any criterion is missing, duplicated, limited or unscorable — such output is
 * not a grade and is never persisted.
 */
export function normalizeWritingCriteria(task: WritingTask, criteria: readonly { key: string; label: string; band: number | null; limited?: boolean; note?: string | null }[]):
  { criteria: NormalizedCriterion[]; overall: number } | null {
  const keys = criteriaFor(task);
  const bySlot = new Map<string, NormalizedCriterion>();
  for (const c of criteria) {
    const slot = slotOf(c.key) ?? slotOf(c.label);
    if (!slot) continue;
    if (bySlot.has(slot)) return null;
    const band = c.limited ? null : toHalfBand(c.band);
    if (band === null) return null;
    const key = slot === "task" ? keys[0]! : slot;
    bySlot.set(slot, { key, label: CRITERION_LABEL[key], band, note: c.note?.trim() ? c.note.trim().slice(0, 500) : null });
  }
  const ordered = ["task", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"].map((s) => bySlot.get(s));
  if (ordered.some((c) => !c)) return null;
  const list = ordered as NormalizedCriterion[];
  return { criteria: list, overall: deriveOverall(list.map((c) => c.band)) };
}

export function countEssayWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export const MIN_WORDS: Record<WritingTask, number> = { task1: 150, task2: 250 };

/** Below this there is nothing an examiner could grade; the provider is not called. */
export const MIN_GRADE_WORDS = 50;
