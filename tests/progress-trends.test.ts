import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activityHeatmap, heatLevel, retentionLevelTrends, weekStartKey, weeklyAccuracy, weeklyBand } from "../src/lib/progress/trends";
import { RETENTION_LEVELS } from "../src/lib/retention/levels";

const NOW = new Date("2026-10-01T10:00:00Z"); // Thursday

test("weeks start on Monday in the centre timezone, including late-evening UTC edge", () => {
  assert.equal(weekStartKey(NOW), "2026-09-28");
  // Sunday 20:00 UTC is already Monday 01:00 in UTC+5.
  assert.equal(weekStartKey(new Date("2026-09-27T20:00:00Z")), "2026-09-28");
});

test("weekly accuracy pools real rows; empty weeks are null, not zero; old rows ignored", () => {
  const pts = weeklyAccuracy([
    { at: new Date("2026-09-29T08:00:00Z"), score: 3, total: 4 },
    { at: new Date("2026-09-30T08:00:00Z"), score: 1, total: 4 },
    { at: new Date("2025-01-01T08:00:00Z"), score: 4, total: 4 },
  ], NOW);
  assert.equal(pts.length, 8);
  assert.deepEqual(pts.at(-1), { weekStart: "2026-09-28", value: 50, count: 2 });
  assert.ok(pts.slice(0, -1).every((p) => p.value === null && p.count === 0));
});

test("writing band averages stored estimates to one decimal", () => {
  const pts = weeklyBand([{ at: new Date("2026-09-29T08:00:00Z"), band: 6 }, { at: new Date("2026-09-29T09:00:00Z"), band: 6.5 }], NOW);
  assert.equal(pts.at(-1)!.value, 6.3);
});

test("heatmap is 12×7, Monday-first, counts per Tashkent day", () => {
  const grid = activityHeatmap([new Date("2026-09-30T19:30:00Z"), new Date("2026-10-01T05:00:00Z")], NOW);
  assert.equal(grid.length, 12);
  assert.ok(grid.every((w) => w.length === 7));
  assert.equal(grid.at(-1)![3]!.day, "2026-10-01");
  assert.equal(grid.at(-1)![3]!.count, 2);
  assert.deepEqual([0, 1, 2, 4, 6].map(heatLevel), [0, 1, 2, 3, 4]);
});

test("retention trends per level use last five finalized scores in time order", () => {
  const rows = [70, 40, 50, 60, 80, 90].map((score, i) => ({ at: new Date(Date.UTC(2026, 8, 1 + i)), level: "B1" as const, score, textId: `t${i % 4}` }));
  const trends = retentionLevelTrends(rows.reverse(), RETENTION_LEVELS);
  const b1 = trends.find((t) => t.level === "B1")!;
  assert.deepEqual(b1.recent, [40, 50, 60, 80, 90]);
  assert.equal(b1.attempts, 6);
  assert.equal(b1.average, 64);
  assert.equal(b1.change, 50);
  assert.equal(b1.best, 90);
  assert.equal(b1.textsCompleted, 4, "repeat of the same text counts once");
  assert.deepEqual(trends.find((t) => t.level === "A2"), { level: "A2", attempts: 0, textsCompleted: 0, best: null, recent: [], average: null, change: null });
});

test("trend data source is user-scoped, bounded, never reads self-estimates or Retention source/rubric", () => {
  const src = readFileSync("src/lib/data/progress-trends.ts", "utf8");
  assert.equal((src.match(/\.limit\(ROW_CAP\)/g) ?? []).length, 6);
  assert.equal((src.match(/eq\(\w+\.userId, userId\)/g) ?? []).length, 6);
  for (const forbidden of ["onboardingProfiles", "currentBand", "bodyText", "scoringStructure", "recallText", "unstable_cache", "\"use cache\""]) {
    assert.ok(!src.includes(forbidden), `must not reference ${forbidden}`);
  }
});
