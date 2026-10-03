// Static guards for the public/internal attribution split (2026-10-03).
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_CHECKED_BY, staffProvenanceLabel } from "../src/lib/services/coach/attribution";

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(p)) yield p;
  }
}

test("CB1 the public label is the fixed constant RIWI, not configuration", () => {
  assert.equal(PUBLIC_CHECKED_BY, "RIWI");
  const src = readFileSync("src/lib/services/coach/attribution.ts", "utf8");
  assert.doesNotMatch(src, /process\.env|getBrand|readEnv/);
});

test("CB2 no learner API response carries the stored provider identity", () => {
  const offenders: string[] = [];
  for (const file of walk("src/app/api")) {
    if (file.includes(`${join("api", "admin")}`)) continue;
    const src = readFileSync(file, "utf8");
    if (/checkedBy\.displayName/.test(src)) offenders.push(`${file}: checkedBy.displayName`);
    for (const m of src.matchAll(/NextResponse\.json\(\{[\s\S]*?\}\s*[,)]/g)) {
      if (/\b(providerId|providerDisplayName|fallbackFrom)\s*:/.test(m[0])) offenders.push(`${file}: provider field in response`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("CB3 new evaluation rows store the public label; provenance columns keep the truth", () => {
  const src = readFileSync("src/lib/data/evaluations.ts", "utf8");
  assert.match(src, /checkedByName: PUBLIC_CHECKED_BY,\n\s+overallEstimate/);
  for (const col of ["providerId: result.providerId", "providerDisplayName: result.providerDisplayName", "providerType: result.providerType", "model: result.model", "fallbackFrom: result.fallbackFrom"]) {
    assert.ok(src.includes(col), `provenance column ${col} must still be stored`);
  }
});

test("CB4 staff label is truthful for external and internal evaluators", () => {
  const base = { providerVersion: "1", promptVersion: "p", rubricVersion: "r", fallbackFrom: null };
  assert.equal(staffProvenanceLabel({ ...base, providerId: "x", providerDisplayName: "X", providerType: "external", model: "m", fallbackUsed: false }), "X (x, external) · model m · v1 · prompt p · rubric r");
  assert.match(staffProvenanceLabel({ ...base, providerId: "riwi", providerDisplayName: "RIWI", providerType: "internal", model: null, fallbackUsed: true, fallbackFrom: "x" }), /RIWI \(riwi, internal\).*fallback from x$/);
});
