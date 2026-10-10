/** Shared input rules; scores are replayed against the signed text on the server. */
export type TypingInput = { committed: string[]; buffer: string };
export const BACKSPACE = "\b";
export const DELETE_WORD = "\x17";

/** null means no scored character was inserted; deletions never count as attempts. */
export function applyTypingKeystroke(target: string[], state: TypingInput, key: string): boolean | null {
  if (key === BACKSPACE || key === DELETE_WORD) {
    if (state.buffer) {
      state.buffer = key === BACKSPACE ? state.buffer.slice(0, -1) : "";
    } else if (state.committed.length && state.committed.at(-1) !== target[state.committed.length - 1]) {
      const previous = state.committed.pop()!;
      state.buffer = key === BACKSPACE ? previous : "";
    }
    return null;
  }
  if (state.committed.length >= target.length || key.length !== 1 || /[\x00-\x1f\x7f]/.test(key)) return null;
  const expected = target[state.committed.length] ?? "";
  if (key === " ") {
    if (!state.buffer) return null;
    const correct = state.buffer === expected;
    state.committed.push(state.buffer);
    state.buffer = "";
    return correct;
  }
  if (state.buffer.length >= Math.min(80, expected.length + 20)) return null;
  const correct = key === expected[state.buffer.length];
  state.buffer += key;
  return correct;
}

/** Keep historical mistakes, including those later corrected, out of the numerator. */
export function replayTypingAccuracy(target: string[], typedWords: string[], keys: string[], missed: number) {
  if (keys.length > 50_000) return null;
  const state: TypingInput = { committed: [], buffer: "" };
  let attempts = 0;
  let correct = 0;
  for (const key of keys) {
    if (typeof key !== "string" || key.length !== 1 || (/[\x00-\x1f\x7f]/.test(key) && key !== BACKSPACE && key !== DELETE_WORD)) return null;
    const scored = applyTypingKeystroke(target, state, key);
    if (scored !== null) {
      attempts++;
      if (scored) correct++;
    }
  }
  const replayed = [...state.committed, state.buffer];
  if (replayed.length !== typedWords.length || replayed.some((word, index) => word !== typedWords[index])) return null;
  const denominator = attempts + missed;
  return {
    accuracy: denominator ? Math.round(correct / denominator * 1000) / 10 : 0,
    mistakes: attempts - correct + missed,
  };
}
