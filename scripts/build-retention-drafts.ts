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
import { RETENTION_EVALUATOR_VERSION } from "../src/lib/retention/types";
import { findPhraseAll, isNegated, splitEvidenceUnits, tokens, unitTokens } from "../src/lib/retention/normalize";
import type { MeasurementClaim, MeasurementStructureV1 } from "../src/lib/retention/types";

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

/** The canonical recall of a draft: its claim labels, one sentence each. It must score exactly 100. */
export function canonicalRecall(p: DraftPair): string {
  const st = p.structure as { claims: Array<{ label: string }> };
  return st.claims.map((c) => c.label.replace(/[.\s]+$/, "") + ".").join(" ");
}

const WRONG_ENTITY = "Zorvathian";
const WRONG_CONCEPT = "quibbleworth";
/** A wrong value of the same kind: numbers shift by one (1945 -> 1946), words become an unrelated token. */
function wrongValue(kind: string, alt: string): string {
  if (/\d/.test(alt)) return alt.replace(/\d+(?:[.,]\d+)?/g, (d) => String(Number(d.replace(/,/g, "")) + 1));
  return kind === "entity" ? WRONG_ENTITY : WRONG_CONCEPT;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Replace every occurrence of every alternative of a group inside the canonical recall (case-insensitive, word-bounded). */
function mutate(recall: string, alts: string[], replacement: (alt: string) => string): { text: string; hit: boolean } {
  let text = recall; let hit = false;
  for (const alt of [...alts].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(alt)}(?![\\p{L}\\p{N}])`, "giu");
    text = text.replace(re, () => { hit = true; return replacement(alt); });
  }
  return { text, hit };
}

export type PairAnalysis = { id: string; canonicalScore: number; sourceScore: number; sourceDeficits: Array<{ claimId: string; groupId: string; cause: string }>; mutationsChecked: number };

/** Why did the SOURCE text miss a group? Derived from the scorer's own primitives, never guessed. */
function sourceCause(text: string, claim: MeasurementClaim, groupId: string): string {
  const g = claim.groups.find((x) => x.id === groupId)!;
  const fuzzy = g.kind === "concept" && !g.critical;
  const units = claim.scope === "sentence" ? splitEvidenceUnits(text).map(unitTokens) : [unitTokens(text)];
  let negated = false;
  for (const u of units) for (const a of g.anyOf) {
    const hits = findPhraseAll(u, tokens(a), fuzzy);
    if (hits.some((i) => !isNegated(u, i))) return claim.scope === "sentence" ? "sentence-scope-split" : "other";
    if (hits.length) negated = true;
  }
  if (negated) return "negated";
  return "absent";
}

export function analyzePair(p: DraftPair): { problems: string[]; analysis?: PairAnalysis } {
  const problems: string[] = [];
  if (!isWordCountInRange(p.level as never, p.wordCount)) problems.push(`${p.id}: ${p.wordCount} words outside ${p.level} range`);
  let structure: MeasurementStructureV1;
  try { structure = validateMeasurementStructure(p.structure); } catch (e) { problems.push(`${p.id}: structure invalid ${(e as Error).message.slice(0, 200)}`); return { problems }; }
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’]/g, "'");
  const text = norm(p.text);
  for (const c of structure.claims) for (const g of c.groups) {
    if (!g.anyOf.some((a) => text.includes(norm(a)))) problems.push(`${p.id}/${c.id}/${g.id}: no alternative appears in the text (ungrounded)`);
  }
  // Every number or year written in a label must be graded by a number/date group of THAT claim,
  // otherwise a wrong date would still take full points (C2-03 1945 -> 1946 regression).
  for (const c of structure.claims) {
    const graded = new Set(c.groups.filter((g) => g.kind === "number" || g.kind === "date" || g.kind === "entity").flatMap((g) => g.anyOf.flatMap((a) => tokens(a))).filter((t) => /^\d+$/.test(t)));
    for (const t of tokens(c.label).filter((t) => /^\d+$/.test(t))) if (!graded.has(t)) problems.push(`${p.id}/${c.id}: label value ${t} is not graded by a number/date group`);
  }
  // 1. Canonical recall: exactly 100, every claim captured.
  const recall = canonicalRecall(p);
  const full = evaluateRecall(recall, structure);
  if (full.score !== 100) for (const c of full.breakdown.claims) if (c.awardedPoints < c.possiblePoints) problems.push(`${p.id}/${c.claimId}: canonical recall scores ${c.awardedPoints}/${c.possiblePoints} (missing ${c.missingGroupIds.join(",")}; ${c.status})`);
  if (evaluateRecall("", structure).score !== 0) problems.push(`${p.id}: empty recall is not 0`);
  // 2. Wrong value and missing value for every group: the owning claim must lose points.
  let mutationsChecked = 0;
  for (const c of structure.claims) for (const g of c.groups) {
    for (const mode of ["wrong", "missing"] as const) {
      const m = mutate(recall, g.anyOf, (alt) => (mode === "wrong" ? wrongValue(g.kind, alt) : ""));
      if (!m.hit) { problems.push(`${p.id}/${c.id}/${g.id}: canonical recall does not contain the group literally (cannot regression-test)`); break; }
      const r = evaluateRecall(m.text, structure).breakdown.claims.find((x) => x.claimId === c.id)!;
      mutationsChecked += 1;
      if (r.awardedPoints >= c.points) problems.push(`${p.id}/${c.id}/${g.id}: ${mode} ${g.kind} still earns full claim points`);
    }
  }
  // 3. Keyword list: one alternative per group, no sentences — must not equal full meaningful recall
  //    for SENTENCE-scoped claims is checked by the scorer; here we require the bare list of the
  //    title + the text's most frequent content words to stay well below 100.
  const groupTokens = new Set(structure.claims.flatMap((c) => c.groups.flatMap((g) => g.anyOf.flatMap((a) => tokens(a)))));
  const freq = new Map<string, number>();
  for (const t of tokens(p.text)) if (t.length > 3 && !/^\d+$/.test(t) && !groupTokens.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const unrelated = [p.title, ...[...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w)].join(", ");
  const unrelatedScore = evaluateRecall(unrelated, structure).score;
  if (unrelatedScore >= 50) problems.push(`${p.id}: unrelated topic keyword list scores ${unrelatedScore}`);
  // 4. Source text: recorded with its exact cause; a cause other than sentence scope is a problem.
  const src = evaluateRecall(p.text, structure);
  const sourceDeficits = src.breakdown.claims.flatMap((c) => {
    const claim = structure.claims.find((x) => x.id === c.claimId)!;
    if (c.status === "contradicted") return [{ claimId: c.claimId, groupId: "*", cause: "contradicted-by-disclaimer" }];
    return c.missingGroupIds.map((gid) => ({ claimId: c.claimId, groupId: gid, cause: sourceCause(p.text, claim, gid) }));
  });
  for (const d of sourceDeficits) if (d.cause !== "sentence-scope-split") problems.push(`${p.id}/${d.claimId}/${d.groupId}: source text misses group (${d.cause})`);
  return { problems, analysis: { id: p.id, canonicalScore: full.score, sourceScore: src.score, sourceDeficits, mutationsChecked } };
}

export function checkPair(p: DraftPair): string[] { return analyzePair(p).problems; }

export function buildAll(read = (level: string) => readFileSync(`content/retention-drafts/src/${level}.txt`, "utf8")) {
  const pairs = RETENTION_LEVELS.flatMap((level) => parseLevel(level, read(level)));
  const problems = pairs.flatMap(checkPair);
  const ids = new Set<string>();
  for (const p of pairs) { if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`); ids.add(p.id); }
  const titles = new Set<string>();
  for (const p of pairs) { if (titles.has(p.title)) problems.push(`duplicate title ${p.title}`); titles.add(p.title); }
  const analyses = pairs.map((p) => analyzePair(p).analysis).filter((a): a is PairAnalysis => Boolean(a));
  return { pairs, problems, analyses };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pairs, problems, analyses } = buildAll();
  const perLevel = Object.fromEntries(RETENTION_LEVELS.map((l) => [l, pairs.filter((p) => p.level === l).length]));
  const jsonl = pairs.map((p) => JSON.stringify(p)).join("\n") + "\n";
  const receipt = { builtFrom: "content/retention-drafts/src/*.txt", provenance: PROVENANCE, humanApproved: false, published: false, total: pairs.length, perLevel,
    wordCounts: Object.fromEntries(RETENTION_LEVELS.map((l) => { const w = pairs.filter((p) => p.level === l).map((p) => p.wordCount); return [l, { min: Math.min(...w), max: Math.max(...w) }]; })),
    evaluatorVersion: RETENTION_EVALUATOR_VERSION,
    checks: {
      canonicalRecallScores100: analyses.filter((a) => a.canonicalScore === 100).length,
      wrongAndMissingValueMutationsChecked: analyses.reduce((n, a) => n + a.mutationsChecked, 0),
      sourceTextScores100: analyses.filter((a) => a.sourceScore === 100).length,
      sourceTextBelow100: analyses.filter((a) => a.sourceScore < 100).map((a) => ({ id: a.id, score: a.sourceScore, deficits: a.sourceDeficits })),
    },
    problems, sha256: createHash("sha256").update(jsonl).digest("hex") };
  if (!process.argv.includes("--check")) {
    writeFileSync("content/retention-drafts/retention-drafts-75.jsonl", jsonl);
    writeFileSync("docs/receipts/N14-retention-drafts.json", JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify({ ...receipt, problems: problems.slice(0, 40) }, null, 2));
  if (problems.length) process.exit(1);
}
