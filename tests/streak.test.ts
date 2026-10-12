import test from "node:test";
import assert from "node:assert/strict";
import { streakFromDays } from "../src/lib/progress/streak";

test("ST1 consecutive days ending today", () => assert.equal(streakFromDays(["2026-10-03", "2026-10-02", "2026-10-01"], "2026-10-03"), 3));
test("ST2 today not logged yet keeps yesterday's streak", () => assert.equal(streakFromDays(["2026-10-02", "2026-10-01"], "2026-10-03"), 2));
test("ST3 a gap ends the streak; duplicates do not inflate it", () => assert.equal(streakFromDays(["2026-10-03", "2026-10-03", "2026-10-01"], "2026-10-03"), 1));
test("ST4 month and year boundaries", () => assert.equal(streakFromDays(["2027-01-01", "2026-12-31", "2026-12-30"], "2027-01-01"), 3));
test("ST5 no activity is 0", () => assert.equal(streakFromDays([], "2026-10-03"), 0));
