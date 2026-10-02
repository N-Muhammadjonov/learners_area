/** Activation-specific level contract (§43). Translation keeps its own 6/7/8 bands. */
export const ACTIVATION_LEVELS = ["5.5", "6.0", "6.5", "7.0", "7.5+"] as const;
export type ActivationLevel = (typeof ACTIVATION_LEVELS)[number];
export type ActivationMode = "writing" | "speaking";
export type FeedbackMode = "instant" | "summary";
export const ACTIVATION_CRITERIA = ["meaning", "form", "collocation", "naturalness", "grammar"] as const;

export function isActivationLevel(v: unknown): v is ActivationLevel {
  return typeof v === "string" && (ACTIVATION_LEVELS as readonly string[]).includes(v);
}

const PLACEHOLDERS = new Set(["sb", "sth", "someone", "something", "somebody", "one's", "x", "y"]);
const OPTIONAL = new Set(["a", "an", "the"]);

/** Lowercase, NFKC, unify apostrophes; hyphen/dash variants and punctuation become word separators. */
export function activationTokens(s: string): string[] {
  return s.toLowerCase().normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/[\u2010-\u2015\u2212-]/g, " ")
    .match(/[\p{L}\p{N}']+/gu) ?? ([] as string[]);
}

/** Common irregular forms of light verbs that head many collocations (make a decision, take part in …). */
const IRREGULAR: Record<string, string[]> = {
  make: ["made"], take: ["took", "taken"], give: ["gave", "given"], do: ["did", "done", "does"], have: ["has", "had"],
  go: ["went", "gone", "goes"], get: ["got", "gotten"], bring: ["brought"], come: ["came"], keep: ["kept"], hold: ["held"],
  pay: ["paid"], run: ["ran"], see: ["saw", "seen"], set: ["set"], put: ["put"], draw: ["drew", "drawn"], meet: ["met"],
  catch: ["caught"], think: ["thought"], lead: ["led"], fall: ["fell", "fallen"], rise: ["rose", "risen"], grow: ["grew", "grown"],
  be: ["is", "are", "was", "were", "been", "being", "am"],
};

function sameWord(answerWord: string, target: string): boolean {
  if (answerWord === target) return true;
  if (IRREGULAR[target]?.includes(answerWord)) return true;
  if (target.endsWith("e") && answerWord === `${target.slice(0, -1)}ing`) return true;
  if (target.length <= 4) return answerWord === `${target}s` || answerWord === `${target}es` || answerWord === `${target}d` || answerWord === `${target}ed`;
  const stem = target.slice(0, Math.max(4, target.length - 3));
  return answerWord.startsWith(stem) && answerWord.length - target.length <= 4;
}

/**
 * Pre-check before any AI call: is the item clearly present?
 * - single word: regular inflection tolerated (mitigate → mitigated).
 * - multi-word expression: the content words must occur IN ORDER as one
 *   expression — at most 2 inserted words between neighbours (e.g. an
 *   adjective inside "make a decision"), up to 4 for an sb/sth slot. Articles
 *   in the item are optional. Scattered constituent words do not count.
 * Flexible syntax beyond this is the external AI's judgement, not a pass here.
 */
export function containsItem(answer: string, item: string): boolean {
  const a = activationTokens(answer);
  const raw = activationTokens(item);
  const target: { word: string; gapBefore: number }[] = [];
  let slot = false;
  for (const w of raw) {
    if (PLACEHOLDERS.has(w)) { slot = true; continue; }
    if (OPTIONAL.has(w) && raw.length > 1) continue;
    target.push({ word: w, gapBefore: target.length === 0 ? 0 : slot ? 4 : 2 });
    slot = false;
  }
  if (!target.length) return false;
  for (let start = 0; start < a.length; start++) {
    if (!sameWord(a[start]!, target[0]!.word)) continue;
    let pos = start;
    let ok = true;
    for (let k = 1; k < target.length; k++) {
      const { word, gapBefore } = target[k]!;
      let found = -1;
      for (let j = pos + 1; j <= Math.min(a.length - 1, pos + 1 + gapBefore); j++) if (sameWord(a[j]!, word)) { found = j; break; }
      if (found < 0) { ok = false; break; }
      pos = found;
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Deterministic activation score (0–100) from the five required criterion
 * bands. Incomplete criteria → null: no score is fabricated.
 */
export function activationScore(bands: Record<string, number | null | undefined> | null | undefined): number | null {
  if (!bands) return null;
  const vals = ACTIVATION_CRITERIA.map((k) => bands[k]);
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  const avg = (vals as number[]).reduce((s, v) => s + v, 0) / vals.length;
  return Math.max(0, Math.min(100, Math.round((avg / 9) * 100)));
}

/** Normalised identity used to match an own-list term to a saved Vocabulary item. */
export function activationMatchKey(s: string): string {
  return activationTokens(s).filter((w) => !OPTIONAL.has(w)).join(" ");
}

/** Never let a client-chosen string be a stored "custom item" if it is not a plausible word/expression. */
export function cleanCustomItem(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s.length < 2 || s.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{N}'\u2019 ,.\u2010-\u2015-]*$/u.test(s)) return null;
  return s;
}
