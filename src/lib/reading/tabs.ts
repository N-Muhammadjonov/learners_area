/**
 * Reading hub tabs — the single mapping between tab key, URL and workspace.
 *
 * Owner decision (2026-10-02): the passage LIBRARY (search, topic, question
 * type, status, pages) is General Reading; the guided reading sets that used
 * to sit under "General Reading" are Academic Reading. The swap is semantic:
 * the tab key in the URL, the query that runs, the rendered region and the
 * subtitle all move together. `?tab=practice` (the old key of the guided sets)
 * keeps working as an alias of `academic`, and any library filter in the URL
 * (q, topic, type, status, page) opens General Reading, so old filter links
 * still land on the library.
 */
export const READING_TABS = ["academic", "general-reading", "general", "types", "retention"] as const;
export type ReadingTab = (typeof READING_TABS)[number];
const TAB_ALIASES: Record<string, ReadingTab> = { practice: "academic" };
const LIBRARY_PARAMS = ["q", "topic", "type", "status", "page"] as const;

export function resolveReadingTab(params: Record<string, string | undefined>): ReadingTab {
  const requested = params.tab ?? "";
  if ((READING_TABS as readonly string[]).includes(requested)) return requested as ReadingTab;
  if (TAB_ALIASES[requested]) return TAB_ALIASES[requested]!;
  if (LIBRARY_PARAMS.some((key) => params[key])) return "general-reading";
  return "academic";
}
