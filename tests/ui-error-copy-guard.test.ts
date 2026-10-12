// Global guard (master §O/§47/§59): no .tsx under src/ may push a server/exception
// code or message straight into rendered state. Complements the behavioural tests of
// apiErrorMessage; this scan catches new call sites anywhere, not a fixed file list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
const SINK = /\b(set[A-Z]\w*|alert|toast\w*)\(/;
const LEAKS = [
  /\b\w+\??\.(error|code|reason)\s*\?\?/, // "data.error ?? fallback" renders the code when present
  /String\(\s*\w+\??\.(error|code|reason)\b/,
  /\$\{\s*\w+\??\.(error|code|reason)\b/,
  /\(\s*\w+ instanceof Error \? \w+\.message/, // exception text as UI copy
  /\(\s*["'`][a-z]+(_[a-z0-9]+)+["'`]\s*\)/, // setError("could_not_start")
];
// Lines that map/compare codes rather than render them.
const MAPPING = /apiErrorMessage|as keyof|console\.|\.message ===|zipProblem\(/;

test("EG1 no raw error code/message reaches a UI state setter anywhere in src/", () => {
  const hits: string[] = [];
  for (const f of walk("src"))
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (SINK.test(line) && !MAPPING.test(line) && LEAKS.some((r) => r.test(line))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  assert.deepEqual(hits, []);
});

test("EG2 the scan itself catches the historical leak shapes", () => {
  const bad = [
    'setError(data.error ?? "Could not save");',
    'setError(String(data.error ?? "could_not_start"));',
    "setError(`${t.failed} (${data.error ?? res.status})`);",
    'setError(e instanceof Error ? e.message : "Save failed");',
    'setError("intent_failed");',
  ];
  for (const l of bad) assert.ok(SINK.test(l) && !MAPPING.test(l) && LEAKS.some((r) => r.test(l)), l);
  assert.ok(MAPPING.test("setError(apiErrorMessage(data.error, res.status, dict));"));
});
