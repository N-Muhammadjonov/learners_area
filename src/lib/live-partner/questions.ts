export type QuestionRow = { id: string; part: string; topic: string | null; promptText: string; cueCard: string | null };
/** Search-as-you-type across topic, question and cue text (case/diacritic-insensitive). */
const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function filterQuestions(rows: QuestionRow[], query: string): Record<"part1" | "part2" | "part3", QuestionRow[]> {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const out = { part1: [] as QuestionRow[], part2: [] as QuestionRow[], part3: [] as QuestionRow[] };
  for (const row of rows) {
    if (row.part !== "part1" && row.part !== "part2" && row.part !== "part3") continue;
    const hay = norm(`${row.topic ?? ""} ${row.promptText} ${row.cueCard ?? ""}`);
    if (terms.every((t) => hay.includes(t))) out[row.part].push(row);
  }
  return out;
}
