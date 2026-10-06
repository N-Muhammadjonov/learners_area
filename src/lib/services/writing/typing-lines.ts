export interface LineRange { start: number; end: number }

/**
 * Group already-rendered word spans by their real visual line.
 * The caller passes offsetTop for every word; no character-count guessing.
 */
export function groupTypingLines(tops: number[]): LineRange[] {
  const lines: LineRange[] = [];
  if (tops.length === 0) return lines;
  let start = 0;
  for (let i = 1; i <= tops.length; i += 1) {
    if (i === tops.length || Math.abs((tops[i] ?? 0) - (tops[start] ?? 0)) > 2) {
      if (i > start) lines.push({ start, end: i });
      start = i;
    }
  }
  return lines;
}
