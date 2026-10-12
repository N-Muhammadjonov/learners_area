import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeMocks,
  type MockResult,
} from "../src/lib/progress/mock-summary";
const row = (
  id: string,
  band: number | null,
  day: number,
  skill = "full",
): MockResult => ({
  id,
  mockTestId: id,
  title: id,
  skill,
  finishedAt: new Date(Date.UTC(2026, 9, day)),
  estimatedBand: band,
});
test("Overall mock summary uses finished full attempts in date order, including real zero", () => {
  const data = [
    row("b", 7.5, 3),
    row("a", 0, 1),
    row("r", 9, 2, "reading"),
    { ...row("open", 9, 4), finishedAt: null },
    row("bad", 10, 5),
  ];
  const s = summarizeMocks(data, ["a", "b"]);
  assert.equal(s.latest, 7.5);
  assert.equal(s.best, 7.5);
  assert.equal(s.average, 3.75);
  assert.equal(s.change, 7.5);
  assert.equal(s.completed, 2);
  assert.deepEqual(
    s.points.map((a) => a.id),
    ["a", "b"],
  );
});
test("Empty mocks preserve absent scores and cannot invent a denominator", () => {
  const s = summarizeMocks([], []);
  assert.equal(s.latest, null);
  assert.equal(s.best, null);
  assert.equal(s.average, null);
  assert.equal(s.change, null);
  assert.equal(s.total, 0);
});
test("Repeated attempts count a catalogue mock only once; a single grade has no improvement", () => {
  const a = row("a", 6, 1);
  const s = summarizeMocks(
    [a, { ...a, id: "retry", estimatedBand: null }],
    ["a"],
  );
  assert.equal(s.completed, 1);
  assert.equal(s.attempts, 2);
  assert.equal(s.change, null);
});
