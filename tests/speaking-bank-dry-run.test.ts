import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs script without types
import { planSpeakingBank } from "../scripts/speaking-bank-dry-run.mjs";

const line = (id: string, part: number, cue: string[] = []) => JSON.stringify({ id, part, question: `Q ${id}`, cue_points: cue, source_class: "x" });
test("dry-run plan counts parts, rejects duplicates, bad ids and Part 2 without cue points", () => {
  const plan = planSpeakingBank([line("P1-001", 1), line("P1-001", 1), line("P2-001", 2), line("P3-001-1", 3), line("bad", 3), "{oops"].join("\n"));
  assert.deepEqual(plan.byPart, { 1: 2, 2: 1, 3: 2 });
  assert.ok(plan.errors.some((e: string) => e.includes("duplicate id P1-001")));
  assert.ok(plan.errors.some((e: string) => e === "line 5: id"));
  assert.ok(plan.errors.some((e: string) => e === "line 3: part 2 without cue points"));
  assert.ok(plan.errors.some((e: string) => e === "line 6: invalid JSON"));
  assert.ok(plan.errors.some((e: string) => e.startsWith("part 1: 2 rows, expected 285")));
});
