import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyzePair, buildAll, canonicalRecall, PROVENANCE } from "../scripts/build-retention-drafts";
import { evaluateRecall } from "../src/lib/retention/evaluator";
import { validateMeasurementStructure } from "../src/lib/retention/measurement";

test("N14: 75 retention drafts build with zero structural problems", () => {
  const { pairs, problems } = buildAll();
  assert.deepEqual(problems, []);
  assert.equal(pairs.length, 75);
  for (const level of ["A2", "B1", "B2", "C1", "C2"]) assert.equal(pairs.filter((p) => p.level === level).length, 15, level);
  for (const p of pairs) { assert.equal(p.humanApproved, false); assert.equal(p.provenance, PROVENANCE); }
});

test("N14: committed JSONL matches the source build", () => {
  const { pairs } = buildAll();
  const committed = readFileSync("content/retention-drafts/retention-drafts-75.jsonl", "utf8");
  assert.equal(committed, pairs.map((p) => JSON.stringify(p)).join("\n") + "\n");
});

test("N14: drafts are not referenced by app code, seeds or migrations", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = ["src", "drizzle"].flatMap((d) => { try { return walk(d); } catch { return []; } })
    .concat(readdirSync("scripts").filter((f) => /seed|import/.test(f)).map((f) => join("scripts", f)));
  const { pairs } = buildAll();
  const titles = pairs.map((p) => p.title);
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    assert.ok(!s.includes("retention-drafts"), f);
    for (const t of titles) assert.ok(!s.includes(t), `${f} contains draft title ${t}`);
  }
});

const pair = (id: string) => { const p = buildAll().pairs.find((x) => x.id === id); assert.ok(p, id); return p; };
const claimScore = (text: string, id: string, claimId: string) => {
  const p = pair(id);
  return evaluateRecall(text, validateMeasurementStructure(p.structure)).breakdown.claims.find((c) => c.claimId === claimId)!;
};

test("N14: every draft's canonical recall scores exactly 100", () => {
  for (const p of buildAll().pairs) assert.equal(evaluateRecall(canonicalRecall(p), validateMeasurementStructure(p.structure)).score, 100, p.id);
});

test("N14: audit cases A2-14, B1-07, C2-01 now score 100 on canonical recall and source text", () => {
  for (const id of ["A2-14", "B1-07", "C2-01"]) {
    const p = pair(id); const s = validateMeasurementStructure(p.structure);
    assert.equal(evaluateRecall(canonicalRecall(p), s).score, 100, `${id} canonical`);
    assert.equal(evaluateRecall(p.text, s).score, 100, `${id} source`);
  }
});

test("N14: C2-03 wrong or missing dates cannot take full claim points", () => {
  const canonical = canonicalRecall(pair("C2-03"));
  assert.ok(canonical.includes("1945") && canonical.includes("2019"));
  const c1 = claimScore(canonical.replace("1945", "1946"), "C2-03", "c1");
  assert.ok(c1.awardedPoints < c1.possiblePoints, "1945 -> 1946");
  assert.ok(c1.missingCriticalGroupIds.length > 0);
  const c4 = claimScore(canonical.replace("2019", "2020"), "C2-03", "c4");
  assert.ok(c4.awardedPoints < c4.possiblePoints, "2019 -> 2020");
  const gone = claimScore(canonical.replace("In his 1945 Nobel lecture", "In his Nobel lecture"), "C2-03", "c1");
  assert.ok(gone.awardedPoints < gone.possiblePoints, "missing 1945");
  assert.equal(evaluateRecall(canonical.replace("1945", "1946").replace("2019", "2020"), validateMeasurementStructure(pair("C2-03").structure)).score < 100, true);
});

test("N14: every date/number/entity/concept group has wrong-value and missing-value regressions", () => {
  let checked = 0;
  for (const p of buildAll().pairs) {
    const r = analyzePair(p);
    assert.deepEqual(r.problems, [], p.id);
    const groups = (p.structure as { claims: Array<{ groups: unknown[] }> }).claims.reduce((n, c) => n + c.groups.length, 0);
    assert.equal(r.analysis!.mutationsChecked, groups * 2, p.id);
    checked += r.analysis!.mutationsChecked;
  }
  assert.ok(checked > 1000);
});

test("N14: keyword lists do not score like a full meaningful recall", () => {
  for (const p of buildAll().pairs) {
    const s = validateMeasurementStructure(p.structure);
    const oneTermPerClaim = s.claims.map((c) => c.groups[0]!.anyOf[0]).join(", ");
    assert.ok(evaluateRecall(oneTermPerClaim, s).score < 100, `${p.id} one term per claim`);
    assert.ok(evaluateRecall(`${p.title}, reading, memory, important, people, years`, s).score < 50, `${p.id} unrelated list`);
  }
});

test("N14: source text deficits are only sentence-scope splits, never negation or absence", () => {
  for (const p of buildAll().pairs) for (const d of analyzePair(p).analysis!.sourceDeficits) assert.equal(d.cause, "sentence-scope-split", `${p.id}/${d.claimId}/${d.groupId}`);
});
