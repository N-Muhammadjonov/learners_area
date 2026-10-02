export const ACTIVATION_LEVELS = ["6", "7", "8"] as const;
export type ActivationLevel = (typeof ACTIVATION_LEVELS)[number];
export type ActivationMode = "writing" | "speaking";
export type FeedbackMode = "instant" | "summary";

/**
 * Does the answer actually contain the target item? Each word of the item must
 * appear as a word in the answer, allowing regular inflection (a shared stem of
 * at least 4 letters, or the exact short word). No AI call is spent on an
 * answer that does not use the item at all.
 */
export function containsItem(answer: string, item: string): boolean {
  const words = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[\u2018\u2019]/g, "'").match(/[\p{L}\p{N}'-]+/gu) ?? ([] as string[]);
  const a = words(answer);
  const placeholders = new Set(["sb", "sth", "someone", "something", "x", "y"]);
  const target = words(item).filter((w) => !placeholders.has(w));
  if (!target.length) return false;
  return target.every((t) => {
    if (t.length <= 4) return a.includes(t);
    const stem = t.slice(0, Math.max(4, t.length - 3));
    return a.some((w) => w === t || w.startsWith(stem));
  });
}

/** Never let a client-chosen string be a stored "custom item" if it is not a plausible word/expression. */
export function cleanCustomItem(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s.length < 2 || s.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{N}' ,.-]*$/u.test(s)) return null;
  return s;
}
