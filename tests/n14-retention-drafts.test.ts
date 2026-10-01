import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildAll, PROVENANCE } from "../scripts/build-retention-drafts.ts";

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
