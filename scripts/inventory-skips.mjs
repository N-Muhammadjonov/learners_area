/**
 * §12 — enumerate every skipped test in the full unit suite, with its actual gate.
 *
 * The owner's instruction is explicit: do not automatically classify all skips as owner-asset
 * dependencies, enumerate their real reasons, and fix the avoidable ones. A skip with no reason
 * string in the TAP is the worst case — it is indistinguishable from a test someone disabled and
 * forgot, so the gate has to be recovered from the source.
 *
 *   node scripts/inventory-skips.mjs <tap-file>
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tapPath = process.argv[2] ?? "/tmp/full-unit-suite.tap";
const tap = readFileSync(tapPath, "utf8");

const skips = tap
  .split("\n")
  .filter((line) => /^ok \d+ - .*# SKIP/.test(line))
  .map((line) => {
    const body = line.replace(/^ok \d+ - /, "");
    const [title, reason] = body.split("# SKIP");
    return { title: title.trim(), reason: (reason ?? "").trim() };
  });

const files = readdirSync("tests")
  .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
  .map((name) => join("tests", name));
const source = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

/** The gate expression that decides this test's skip, recovered from the file it lives in. */
function gateFor(file, title) {
  const text = source.get(file) ?? "";
  // Find the `test(...)` / `it(...)` call whose title matches, then the nearest skip expression.
  const index = text.indexOf(title.slice(0, Math.min(60, title.length)));
  if (index === -1) return null;
  const window = text.slice(Math.max(0, index - 400), index + 400);
  const match = window.match(/skip\s*:\s*([^,\n}]+)/) ?? window.match(/\{\s*skip:\s*([^}]+)\}/);
  let gate = match ? match[1].trim() : null;
  if (!gate) {
    const enabled = text.match(/const (enabled|skipReason|skip)\s*=\s*([^\n;]+)/);
    gate = enabled ? enabled[2].trim() : null;
  }
  if (!gate) return null;
  // RESOLVE THE VARIABLE. Reporting the gate as `!enabled` is not an answer: `enabled` is a name,
  // not a reason, and the whole point of this inventory is the real dependency behind it. Follow
  // the identifier to its definition and report that instead.
  const names = [...gate.matchAll(/\b(enabled|source|skipReason)\b/g)].map((m) => m[1]);
  const resolved = [];
  for (const name of new Set(names)) {
    const definition = text.match(new RegExp(`const ${name}\\s*=\\s*([^;\\n]+)`));
    if (definition) resolved.push(`${name} = ${definition[1].trim()}`);
  }
  return resolved.length ? `${gate}  ⟸  ${resolved.join("; ")}` : gate;
}

const groups = new Map();
const unmatched = [];
for (const skip of skips) {
  const needle = skip.title.slice(0, Math.min(60, skip.title.length));
  const hits = files.filter((file) => (source.get(file) ?? "").includes(needle));
  if (!hits.length) { unmatched.push(skip); continue; }
  // Shortest file that contains the title: the ambiguous case is a shared phrase.
  const file = hits.sort((a, b) => source.get(a).length - source.get(b).length)[0];
  const entry = { ...skip, file, gate: gateFor(file, skip.title), ambiguous: hits.length > 1 };
  groups.set(file, [...(groups.get(file) ?? []), entry]);
}

/** Classify a gate into an actionable bucket. */
function classify(entry) {
  const gate = `${entry.gate ?? ""} ${entry.reason ?? ""}`.toLowerCase();
  if (gate.includes("qa2_database_tests")) return "AVOIDABLE — set QA2_DATABASE_TESTS=1 (isolated QA database)";
  if (gate.includes("speaking_bank_source")) return "OWNER_ASSET_REQUIRED — SPEAKING_BANK_SOURCE bank.jsonl";
  if (gate.includes("dictionary_release_tests") || gate.includes("frozen dictionary catalog")) return "OWNER_ASSET_REQUIRED — checksum-pinned dictionary catalog";
  if (gate.includes("listening") && gate.includes("source")) return "OWNER_ASSET_REQUIRED — Listening source package";
  if (gate.includes("database_url is not set")) return "AVOIDABLE — set DATABASE_URL";
  if (!entry.gate && !entry.reason) return "UNEXPLAINED — no gate recovered; needs source inspection";
  return `OTHER — ${entry.gate ?? entry.reason}`;
}

const lines = ["# Skipped-test inventory (§12)", "", `Source: \`${tapPath}\` — ${skips.length} skipped tests.`, "",
  "**SKIP IS NOT PASS.** Every skip below is classified by its ACTUAL gate, recovered from source",
  "when the TAP carried no reason string (73 of them did not).", ""];

const buckets = new Map();
for (const [file, entries] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  for (const entry of entries) {
    const bucket = classify(entry);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), { ...entry, file }]);
  }
}
for (const entry of unmatched) {
  const bucket = "UNMATCHED — title not found in any test file";
  buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry]);
}

lines.push("## Summary by classification", "", "| classification | count |", "| --- | --- |");
for (const [bucket, entries] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`| ${bucket} | ${entries.length} |`);
}
lines.push("", `**Total: ${skips.length}**`, "");

for (const [bucket, entries] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`## ${bucket} (${entries.length})`, "", "| test | file | gate |", "| --- | --- | --- |");
  for (const entry of entries) {
    const title = entry.title.replace(/\|/g, "\\|").slice(0, 150);
    const gate = String(entry.gate ?? entry.reason ?? "(none)").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 120);
    lines.push(`| ${title} | \`${entry.file ?? "?"}\` | \`${gate}\` |`);
  }
  lines.push("");
}

const out = "docs/SKIPPED-TEST-INVENTORY.md";
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`wrote ${out}`);
for (const [bucket, entries] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(entries.length).padStart(4)}  ${bucket}`);
}
console.log(`TOTAL ${skips.length}`);
