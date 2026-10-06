export const PRESETS = [0, 30, 60, 120, 180] as const; // 0 = Full (untimed)
export type Preset = (typeof PRESETS)[number];

export interface Metrics {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number | null;
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
  typedChars: number;
  seconds: number;
}

export function splitWords(body: string): string[] {
  return body.trim().split(/\s+/).filter(Boolean);
}

export function computeMetrics(target: string[], typedWords: string[], seconds: number, samples: number[]): Metrics {
  const committed = typedWords.slice(0, -1);
  const partial = typedWords[typedWords.length - 1] ?? "";
  let correct = 0, incorrect = 0, extra = 0, missed = 0, goodChars = 0, spaces = 0;

  const cmp = (w: string, t: string, isCommitted: boolean) => {
    const n = Math.min(w.length, t.length);
    for (let k = 0; k < n; k++) (w[k] === t[k] ? correct++ : incorrect++);
    extra += Math.max(0, w.length - t.length);
    if (isCommitted) missed += Math.max(0, t.length - w.length);
  };

  committed.forEach((w, i) => {
    const t = target[i] ?? "";
    cmp(w, t, true);
    if (w === t) { goodChars += t.length; spaces++; }
  });
  const pi = committed.length;
  const pt = target[pi] ?? "";
  cmp(partial, pt, false);
  const finishedLastWord = pi === target.length - 1 && partial === pt && pt.length > 0;
  if (finishedLastWord) goodChars += pt.length;

  const typedChars = committed.reduce((a, w) => a + w.length + 1, 0) + partial.length;
  const s = Math.max(1, seconds);
  const wpm = ((goodChars + spaces) / 5) * (60 / s);
  const rawWpm = (typedChars / 5) * (60 / s);
  const den = correct + incorrect + extra + missed;
  const accuracy = den ? (correct / den) * 100 : 0;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    wpm: r1(wpm), rawWpm: r1(rawWpm), accuracy: r1(accuracy),
    consistency: consistencyFromSamples(samples), correct, incorrect, extra, missed, typedChars, seconds: s,
  };
}

export function consistencyFromSamples(samples: number[]): number | null {
  if (samples.length < 4) return null;
  const rates: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const current = samples[i]!;
    const previous = samples[i - 1] ?? 0;
    rates.push((current - previous) * 12);
  }
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return null;
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
  const cov = sd / mean;
  const v = 100 * (1 - Math.tanh(cov + cov ** 3 / 3 + cov ** 5 / 5));
  return Math.round(v * 10) / 10;
}

export function validateSubmission(target: string[], typedWords: string[], seconds: number): string | null {
  if (!Array.isArray(typedWords) || typedWords.length < 1 || typedWords.length > target.length + 1) return "bad_words";
  if (typedWords.some((w) => typeof w !== "string" || w.length > 80 || w.includes(" "))) return "bad_words";
  const typedChars = countTyped(typedWords);
  if (typedChars / Math.max(1, seconds) > 25) return "implausible_speed";
  return null;
}

export function countTyped(typedWords: string[]): number {
  return typedWords.slice(0, -1).reduce((a, w) => a + w.length + 1, 0) + (typedWords[typedWords.length - 1]?.length ?? 0);
}

export function sanitizeSamples(s: unknown, typedChars: number, seconds: number): number[] {
  if (!Array.isArray(s) || s.length > Math.ceil(seconds) + 2) return [];
  const out: number[] = [];
  let prev = 0;
  for (const v of s) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return [];
    const c = Math.min(Math.max(Math.floor(v), prev), typedChars);
    if (c - prev > 40) return [];
    out.push(c);
    prev = c;
  }
  return out;
}

export function activeElapsedMs(startedAt: number, now: number, pausedMs: number, pausedAt: number | null): number {
  const end = pausedAt ?? now;
  return Math.max(0, end - startedAt - pausedMs);
}

export const PAUSE_LIMITS = { single: 180_000, total: 600_000, count: 5 } as const;
