/**
 * N14 — builds the 75 Retention DRAFT pairs from content/retention-drafts/src/<LEVEL>.txt
 * into content/retention-drafts/retention-drafts-75.jsonl, using the PRODUCTION
 * word counter, Measurement Structure validator and scorer.
 *
 * Provenance: AI-written drafts. NOT human-approved, NOT official IELTS material.
 * Nothing here is imported into any bank or published. A human reviewer must read,
 * edit and approve each pair in Management before it can become content.
 *
 *   node --import tsx scripts/build-retention-drafts.ts [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { countWords } from "../src/lib/retention/word-count";
import { isWordCountInRange, RETENTION_LEVELS } from "../src/lib/retention/levels";
import { validateMeasurementStructure } from "../src/lib/retention/measurement";
import { evaluateRecall } from "../src/lib/retention/evaluator";

export const PROVENANCE = "AI draft — not human-approved, not official IELTS material";
const KIND: Record<string, string> = { c: "concept", e: "entity", n: "number", d: "date" };
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "g";

export type DraftPair = { id: string; level: string; title: string; provenance: string; humanApproved: false; wordCount: number; text: string; structure: unknown };

export function parseLevel(level: string, source: string): DraftPair[] {
  const out: DraftPair[] = [];
  for (const block of source.split(/^### /m).slice(1)) {
    const lines = block.split("\n");
    const [id, title] = lines[0]!.split("|").map((s) => s.trim());
    const textLines: string[] = []; const claimLines: string[] = [];
    for (const l of lines.slice(1)) (l.startsWith("@") ? claimLines : textLines).push(l);
    const text = textLines.join("\n").trim().replace(/\n{3,}/g, "\n\n");
    const claims = claimLines.map((line, ci) => {
      const m = line.match(/^@\s*(\d+)\s+([sa])\s*\|\s*(.+?)\s*\|\s*(.+)$/);
      if (!m) throw new Error(`${id}: bad claim line ${line}`);
      const used = new Set<string>();
      const groups = m[4]!.split(";").map((g) => {
        const gm = g.trim().match(/^(\d+)\s+([cend])(!?)\s+(.+)$/);
        if (!gm) throw new Error(`${id}: bad group ${g}`);
        const anyOf = gm[4]!.split("/").map((a) => a.trim().toLowerCase()).filter(Boolean);
        let gid = slug(anyOf[0]!); while (used.has(gid)) gid += "-x"; used.add(gid);
        return { id: gid, points: Number(gm[1]), kind: KIND[gm[2]!], anyOf, ...(gm[3] ? { critical: true } : {}) };
      });
      return { id: `c${ci + 1}`, label: m[3]!, points: Number(m[1]), scope: m[2] === "s" ? "sentence" : "answer", groups, rejectPhrases: [] as string[] };
    });
    out.push({ id: id!, level, title: title!, provenance: PROVENANCE, humanApproved: false, wordCount: countWords(text), text, structure: { schemaVersion: 1, maxScore: 100, claims } });
  }
  return out;
}

export function checkPair(p: DraftPair): string[] {
  const problems: string[] = [];
  if (!isWordCountInRange(p.level as never, p.wordCount)) problems.push(`${p.id}: ${p.wordCount} words outside ${p.level} range`);
  let structure;
  try { structure = validateMeasurementStructure(p.structure); } catch (e) { problems.push(`${p.id}: structure invalid ${(e as Error).message.slice(0, 200)}`); return problems; }
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’]/g, "'");
  const text = norm(p.text);
  for (const c of structure.claims) for (const g of c.groups) {
    if (!g.anyOf.some((a) => text.includes(norm(a)))) problems.push(`${p.id}/${c.id}/${g.id}: no alternative appears in the text (ungrounded)`);
  }
  const full = evaluateRecall(structure.claims.map((c) => c.label).join(" "), structure);
  if (full.score < 70) problems.push(`${p.id}: recalling every label scores only ${full.score}`);
  if (evaluateRecall("", structure).score !== 0) problems.push(`${p.id}: empty recall is not 0`);
  return problems;
}

export function buildAll(read = (level: string) => readFileSync(`content/retention-drafts/src/${level}.txt`, "utf8")) {
  const pairs = RETENTION_LEVELS.flatMap((level) => parseLevel(level, read(level)));
  const problems = pairs.flatMap(checkPair);
  const ids = new Set<string>();
  for (const p of pairs) { if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`); ids.add(p.id); }
  const titles = new Set<string>();
  for (const p of pairs) { if (titles.has(p.title)) problems.push(`duplicate title ${p.title}`); titles.add(p.title); }
  return { pairs, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pairs, problems } = buildAll();
  const perLevel = Object.fromEntries(RETENTION_LEVELS.map((l) => [l, pairs.filter((p) => p.level === l).length]));
  const jsonl = pairs.map((p) => JSON.stringify(p)).join("\n") + "\n";
  const receipt = { builtFrom: "content/retention-drafts/src/*.txt", provenance: PROVENANCE, humanApproved: false, published: false, total: pairs.length, perLevel,
    wordCounts: Object.fromEntries(RETENTION_LEVELS.map((l) => { const w = pairs.filter((p) => p.level === l).map((p) => p.wordCount); return [l, { min: Math.min(...w), max: Math.max(...w) }]; })),
    problems, sha256: createHash("sha256").update(jsonl).digest("hex") };
  if (!process.argv.includes("--check")) {
    writeFileSync("content/retention-drafts/retention-drafts-75.jsonl", jsonl);
    writeFileSync("docs/receipts/N14-retention-drafts.json", JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify({ ...receipt, problems: problems.slice(0, 40) }, null, 2));
  if (problems.length) process.exit(1);
}
