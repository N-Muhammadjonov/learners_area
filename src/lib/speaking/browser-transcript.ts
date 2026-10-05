/**
 * The learner-reviewed browser transcript, resolved on the SERVER (spec §13–§18).
 *
 * The review step is the whole point of the browser-STT design: the learner reads
 * what their own browser recognized, fixes what it got wrong, and only then
 * presses "Send to RIWI". Two strings therefore cross the boundary — what the
 * browser produced, and what the learner chose to send — and this module is the
 * single place that turns them into stored, honestly-labelled provenance.
 *
 * Why `edited` is derived here rather than accepted from the client: a boolean
 * claiming "unedited" is provenance, and provenance asserted by a client is not
 * evidence. Comparing the two strings is. The result is also the truth the owner
 * needs, because an edited transcript is weaker evidence of spontaneous speech
 * than a raw one, and the evaluator is told so.
 *
 * Nothing here contacts the network, reads the database or judges the language;
 * it is a pure decision about what the request actually proves.
 */

/** Mirrors the column width used by the existing manual-transcript path. */
export const MAX_TRANSCRIPT_LENGTH = 8000;

export type BrowserTranscriptInput = {
  /** Exactly what the browser's SpeechRecognition produced, before review. */
  raw?: unknown;
  /** What the learner reviewed and deliberately sent. */
  final?: unknown;
};

export type ResolvedBrowserTranscript = {
  /** The text to evaluate and store as `transcript`. */
  transcript: string;
  /** The unedited recognition output, stored as `transcript_raw` for audit. */
  raw: string;
  /** True when the learner changed the wording before sending (§14). */
  edited: boolean;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TRANSCRIPT_LENGTH) : "";
}

/**
 * Comparison key for "did the learner change the wording?".
 *
 * Only whitespace is normalized. Correcting punctuation, capitalisation or a
 * misheard word is a real edit and must be reported as one, so nothing here
 * strips or "fixes" the learner's text — collapsing spaces merely stops a
 * trailing space from being recorded as an edit.
 */
export function transcriptComparisonKey(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Resolves the browser transcript pair, or null when there is nothing to send.
 *
 * Returns null (rather than an empty transcript) whenever the learner's final
 * text has no content, so the caller can fall through to a real server STT
 * provider instead of evaluating an empty string.
 *
 * Note the threshold deliberately differs from the manual-transcript path's 10
 * characters: that path guards against junk typed into an optional field, while
 * this one is text the learner explicitly reviewed and chose to send. A genuine
 * Part 1 answer can be four characters long ("Yes."), and rejecting it would
 * silently throw away a real answer.
 */
export function resolveBrowserTranscript(input: BrowserTranscriptInput): ResolvedBrowserTranscript | null {
  const raw = asText(input.raw);
  const transcript = asText(input.final).trim();
  if (transcript.length === 0) return null;

  return {
    transcript,
    raw: raw.trim(),
    edited: transcriptComparisonKey(raw) !== transcriptComparisonKey(transcript),
  };
}
