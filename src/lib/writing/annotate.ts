export type EssaySegment = { text: string; mark: number | null };

/**
 * Split an essay into plain and marked segments for the annotated view. Each
 * corrected sentence is located by its exact quoted text (the provider is told
 * to quote verbatim); a quote that is not in the essay is simply not marked —
 * nothing is highlighted that the learner did not write.
 */
export function annotateEssay(essay: string, items: { index: number; original: string }[]): EssaySegment[] {
  const spans: { start: number; end: number; mark: number }[] = [];
  for (const item of items) {
    const quote = item.original.trim();
    if (quote.length < 3) continue;
    let from = 0;
    let found = -1;
    while ((found = essay.indexOf(quote, from)) !== -1) {
      const end = found + quote.length;
      if (!spans.some((s) => found < s.end && end > s.start)) { spans.push({ start: found, end, mark: item.index }); break; }
      from = found + 1;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const out: EssaySegment[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) out.push({ text: essay.slice(cursor, s.start), mark: null });
    out.push({ text: essay.slice(s.start, s.end), mark: s.mark });
    cursor = s.end;
  }
  if (cursor < essay.length) out.push({ text: essay.slice(cursor), mark: null });
  return out;
}
