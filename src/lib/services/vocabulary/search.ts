import { normalizeLexical } from "@/lib/text/lexical-normalize";
/**
 * The long, student-scoped word search.
 *
 * Students search for a word they half-remember, in English or in Uzbek, and the
 * list has to answer while they type: matching is plain substring work over an
 * already-loaded library, so it is fast, predictable and never leaves the
 * student's own data.
 *
 * Ranking, in order: exact term → term starts with the query → any word in the
 * term starts with it → English meaning contains it → Uzbek translation contains
 * it. Ties break alphabetically so the list does not shuffle between keystrokes.
 *
 * Pure module — the database loader feeds it rows, unit tests feed it fixtures.
 */

export type SearchableRow = {
  id: string;
  term: string;
  definitionEn?: string | null;
  translationUz?: string | null;
  mastery?: string | null;
  topicPack?: string | null;
};

export type SearchHit<T extends SearchableRow> = {
  row: T;
  match: "term_exact" | "term_prefix" | "word_prefix" | "definition" | "translation";
  score: number;
};

const normal = (value: string): string => normalizeLexical(value);

function words(term: string): string[] {
  return normal(term).split(/[\s\-/]+/).filter(Boolean);
}

export function matchRow<T extends SearchableRow>(row: T, rawQuery: string): SearchHit<T> | null {
  const query = normal(rawQuery);
  if (!query) return null;

  const term = normal(row.term);
  if (term === query) return { row, match: "term_exact", score: 100 };
  if (term.startsWith(query)) return { row, match: "term_prefix", score: 80 };
  if (words(row.term).some((word) => word.startsWith(query))) {
    return { row, match: "word_prefix", score: 60 };
  }
  if (row.definitionEn && normal(row.definitionEn).includes(query)) {
    return { row, match: "definition", score: 40 };
  }
  if (row.translationUz && normal(row.translationUz).includes(query)) {
    return { row, match: "translation", score: 30 };
  }
  // A query that appears anywhere inside a longer term ("ern" in "pattern") is
  // the last resort: still useful, clearly weaker than a prefix match.
  if (term.includes(query)) return { row, match: "word_prefix", score: 20 };
  return null;
}

export const SEARCH_LIMIT = 12;

export function searchRows<T extends SearchableRow>(rows: T[], query: string, limit = SEARCH_LIMIT) {
  const hits: SearchHit<T>[] = [];
  for (const row of rows) {
    const hit = matchRow(row, query);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.row.term.localeCompare(b.row.term);
  });
  return hits.slice(0, limit);
}
