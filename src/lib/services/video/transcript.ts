/**
 * Transcript input parsing for video authoring. Pure: shared by the admin form
 * and tests, no React or server dependencies.
 */

const TIMED_LINE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/;

export type TranscriptInput =
  | { kind: "empty" }
  | { kind: "timed"; lines: { startSeconds: number; text: string }[] }
  | { kind: "plain"; text: string; paragraphs: number }
  | { kind: "mixed"; untimedLines: number[] };

/**
 * Classify the owner's transcript honestly: every non-empty line timed → timed
 * lines; no line timed → a plain transcript kept exactly as paragraphs; a mix →
 * refused with the offending line numbers, never silently dropped.
 */
export function parseTranscriptInput(text: string): TranscriptInput {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  const nonEmpty = rows.map((raw, index) => ({ line: raw.trim(), index })).filter((row) => row.line);
  if (nonEmpty.length === 0) return { kind: "empty" };
  const timed = nonEmpty.filter((row) => TIMED_LINE.test(row.line));
  if (timed.length === nonEmpty.length) return { kind: "timed", lines: parseTranscript(text) };
  if (timed.length === 0) {
    const normalized = text.replace(/\r\n?/g, "\n").trim().replace(/\n{3,}/g, "\n\n");
    return { kind: "plain", text: normalized, paragraphs: normalized.split(/\n\s*\n/).filter((part) => part.trim()).length };
  }
  return { kind: "mixed", untimedLines: nonEmpty.filter((row) => !TIMED_LINE.test(row.line)).map((row) => row.index + 1) };
}

export function parseTranscript(text: string): { startSeconds: number; text: string }[] {
  const lines: { startSeconds: number; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(TIMED_LINE);
    if (!match) continue;
    const [, a, b, c, body] = match;
    const seconds = c ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    lines.push({ startSeconds: seconds, text: body!.trim() });
  }
  return lines;
}

