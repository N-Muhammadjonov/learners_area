export interface LineRange { start: number; end: number } // word indexes, end exclusive

/** tops[i] = offsetTop of word i in a measured, really-wrapped layout. */
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

/** Alias matching the uploaded ready-code naming. */
export const groupLines = groupTypingLines;

export type TypingRowRole = "out" | "clear" | "dim" | "buffer";

/**
 * Uploaded ready-code window:
 * a-1 is clipped above, a/a+1 are clear, a+2 is dim, a+3 is the lower buffer.
 * Only three rows are visible because the stack is translated up one line.
 */
export function windowRows(a: number): { row: number; role: TypingRowRole }[] {
  return [
    { row: a - 1, role: "out" },
    { row: a, role: "clear" },
    { row: a + 1, role: "clear" },
    { row: a + 2, role: "dim" },
    { row: a + 3, role: "buffer" },
  ];
}

export const VISIBLE_ROWS = 3;
