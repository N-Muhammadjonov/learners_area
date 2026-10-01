#!/usr/bin/env node
/**
 * N11 — DRY RUN ONLY. Validates the 880-row speaking master bank (JSONL) and
 * prints the per-part plan against the `speaking_prompts` schema. It never
 * connects to a database and has no --apply: `speaking_prompts` has no stable
 * external key, so an idempotent import needs an owner-approved migration first.
 *
 *   node scripts/speaking-bank-dry-run.mjs --source <bank.jsonl>
 */
import { readFileSync } from "node:fs";

export const EXPECTED = { 1: 285, 2: 85, 3: 510 };

export function planSpeakingBank(text) {
  const errors = [];
  const ids = new Set();
  const byPart = { 1: 0, 2: 0, 3: 0 };
  const rows = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try { row = JSON.parse(line); } catch { errors.push(`line ${index + 1}: invalid JSON`); return; }
    const part = Number(row.part);
    if (![1, 2, 3].includes(part)) errors.push(`line ${index + 1}: part ${row.part}`);
    if (typeof row.id !== "string" || !/^P[123]-\d{3}(-\d+)?$/.test(row.id)) errors.push(`line ${index + 1}: id`);
    else if (ids.has(row.id)) errors.push(`line ${index + 1}: duplicate id ${row.id}`);
    else ids.add(row.id);
    if (typeof row.question !== "string" || !row.question.trim()) errors.push(`line ${index + 1}: empty question`);
    if (part === 2 && (!Array.isArray(row.cue_points) || row.cue_points.length === 0)) errors.push(`line ${index + 1}: part 2 without cue points`);
    if (byPart[part] !== undefined) byPart[part] += 1;
    rows.push({ externalId: row.id, part: `part${part}`, promptText: row.question, cueCard: part === 2 ? (row.cue_points ?? []).join("\n") : null, sourceClass: row.source_class });
  });
  for (const [part, n] of Object.entries(EXPECTED)) if (byPart[part] !== n) errors.push(`part ${part}: ${byPart[part]} rows, expected ${n}`);
  return { total: rows.length, uniqueIds: ids.size, byPart, errors, sourceClasses: [...new Set(rows.map((r) => r.sourceClass))] };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const at = process.argv.indexOf("--source");
  if (at < 0 || !process.argv[at + 1]) { console.error("STOP --source <bank.jsonl> is required"); process.exit(2); }
  if (process.argv.includes("--apply")) { console.error("STOP this script is dry-run only; no --apply exists"); process.exit(2); }
  const plan = planSpeakingBank(readFileSync(process.argv[at + 1], "utf8"));
  console.log(JSON.stringify(plan, null, 2));
  process.exit(plan.errors.length ? 1 : 0);
}
