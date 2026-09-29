/** Public offset metadata, never a second dictionary or a client authority. */
export type OccurrenceSpan = { id: string; startChar: number; endChar: number; surfaceForm: string };

/** Only offsets proven against the actual body may supply a contextual identity.
 * Old imports with unknown segment-relative offsets fail closed instead of
 * silently attaching a meaning to a different occurrence of the same spelling.
 */
export function occurrenceSpans(body: string, renderedText: string, rows: OccurrenceSpan[]): OccurrenceSpan[] {
  const base = body === renderedText ? 0 : body.indexOf(renderedText);
  if (base < 0 || (body !== renderedText && body.indexOf(renderedText, base + 1) >= 0)) return [];
  return rows.filter((row) => row.startChar >= base && row.endChar <= base + renderedText.length && row.endChar > row.startChar
    && body.slice(row.startChar, row.endChar).toLowerCase() === row.surfaceForm.toLowerCase())
    .map((row) => ({ ...row, startChar: row.startChar - base, endChar: row.endChar - base }));
}
