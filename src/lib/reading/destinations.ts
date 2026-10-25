/** Five learner products. History is a secondary record, never a sixth product. */
export const READING_DESTINATIONS = ["lessons", "academic", "general", "question-types", "retention"] as const;
export function readingLegacyDestination(params: Record<string, string | undefined>): string | null {
  const aliases: Record<string, string> = { academic: "academic", practice: "academic", "general-reading": "general", types: "question-types", retention: "retention" };
  // The obsolete General Training tab was an empty, distinct product, not a General practice set.
  if (params.tab === "general") return "/app/reading";
  const destination = aliases[params.tab ?? ""] ?? (["q", "topic", "type", "status", "page"].some(key => params[key]) ? "general" : null);
  if (!destination) return null;
  const query = new URLSearchParams();
  for (const key of ["q", "topic", "type", "status", "page"]) if (params[key]) query.set(key, params[key]!);
  return `/app/reading/${destination}${query.size ? `?${query}` : ""}`;
}
