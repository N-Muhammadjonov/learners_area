/** Authored keys and learner choices share one option identity. No type inference from pools. */
export function mcqKeyOptions(key: string, options: readonly string[], multi: boolean): string[] | null {
  let keys: unknown = multi ? key.split(/\s*[,;|]\s*/) : [key];
  if (multi && key.trim().startsWith("[")) { try { keys = JSON.parse(key); } catch { return null; } }
  if (!Array.isArray(keys) || keys.some(k => typeof k !== "string") || (multi && keys.length < 2)) return null;
  const result: string[] = [];
  for (const key of keys as string[]) {
    const matches = options.filter(o => o === key.trim() || o.replace(/^[A-Z][).\s]+/, "") === key.trim() || /^([A-Z])[).\s]/.exec(o)?.[1] === key.trim());
    if (matches.length !== 1 || result.includes(matches[0]!)) return null;
    result.push(matches[0]!);
  }
  return result.length ? result : null;
}
export function mcqSelectedOptions(text: string, options: readonly string[], multi: boolean): string[] | null {
  let selected: unknown = [text];
  if (multi) { try { selected = JSON.parse(text); } catch { return null; } }
  if (!Array.isArray(selected) || !selected.length || selected.some(o => typeof o !== "string" || !options.includes(o)) || new Set(selected).size !== selected.length) return null;
  return selected as string[];
}
export function mcqChoiceCorrect(text: string, key: string, options: readonly string[], multi: boolean) {
  const expected = mcqKeyOptions(key, options, multi);
  // Historical single-choice sessions may store the letter, not the full displayed option.
  // This is read-time grading compatibility; advance() still validates new option submissions.
  const selected = mcqSelectedOptions(text, options, multi) ?? (!multi ? mcqKeyOptions(text, options, false) : null);
  return !!expected && !!selected && expected.length === selected.length && expected.every(o => selected.includes(o));
}
