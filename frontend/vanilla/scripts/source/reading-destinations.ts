// Extracted verbatim from original main: src/lib/reading/destinations.ts (read-only reference for the Vanilla Reading navigation).
/** Four learner sections. Question-type practice belongs to General Reading. */
export const READING_DESTINATIONS = ["lessons", "academic", "general", "articles", "retention"] as const;
export function readingLegacyDestination(params: Record<string, string | undefined>): string | null {
  const aliases: Record<string, string> = { academic: "academic", practice: "academic", "general-reading": "general", types: "general", retention: "retention" };
  // The obsolete General Training tab was an empty, distinct product, not a General practice set.
  if (params.tab === "general") return "/app/reading";
  const destination = aliases[params.tab ?? ""] ?? (["q", "topic", "type", "status", "page"].some(key => params[key]) ? "general" : null);
  if (!destination) return null;
  const query = new URLSearchParams();
  for (const key of ["q", "topic", "type", "status", "page"]) if (params[key]) query.set(key, params[key]!);
  return `/app/reading/${destination}${query.size ? `?${query}` : ""}`;
}
