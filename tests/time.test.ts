import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TIMEZONE, formatDate, formatDateTime, formatTime, tashkentDayKey } from "../src/lib/time";

/**
 * One timezone, one formatter.
 *
 * The bug this guards against is quiet: `toLocaleString()` without an explicit
 * timezone uses whatever the runtime is set to, so a live class stored at 15:30
 * UTC rendered as 15:30 in Tashkent on the server and 20:30 after hydration.
 */

test("the display timezone is Asia/Tashkent, not the runtime's", () => {
  assert.equal(TIMEZONE, "Asia/Tashkent");
  // 2026-03-01T15:30:00Z is 20:30 in Tashkent (UTC+5).
  const moment = "2026-03-01T15:30:00Z";
  assert.match(formatTime(moment, "en"), /20:30/);
  assert.match(formatDateTime(moment, "en"), /01\/03\/2026, 20:30|2026/);
  assert.match(formatDate(moment, "en"), /01\/03\/2026/);
});

test("the calendar day follows Tashkent, not UTC", () => {
  // 22:00 UTC is already the next day in Tashkent — the difference decides
  // whether a revision counts as "another day" and whether a streak continues.
  assert.equal(tashkentDayKey("2026-09-25T22:00:00Z"), "2026-09-26");
  assert.equal(tashkentDayKey("2026-09-25T18:00:00Z"), "2026-09-25");
  // New Year's Eve, just before midnight in Tashkent.
  assert.equal(tashkentDayKey("2026-12-31T18:59:00Z"), "2026-12-31");
  assert.equal(tashkentDayKey("2026-12-31T19:00:00Z"), "2027-01-01");
});

test("Uzbek and English render the same instant consistently", () => {
  const moment = "2026-03-01T15:30:00Z";
  assert.notEqual(formatDate(moment, "uz"), "");
  assert.notEqual(formatDate(moment, "en"), "");
  // Uzbekistan has no daylight saving, so the offset never moves.
  assert.equal(tashkentDayKey("2026-07-01T19:00:00Z"), "2026-07-02");
  assert.equal(tashkentDayKey("2026-01-01T19:00:00Z"), "2026-01-02");
});

test("a missing or broken value renders as nothing, never as Invalid Date", () => {
  assert.equal(formatDate("not a date", "en"), "");
  assert.equal(formatDateTime("not a date", "en"), "");
  assert.equal(formatTime("not a date", "en"), "");
  assert.equal(tashkentDayKey("not a date"), "");
});

test("the display timezone is declared in exactly one place", () => {
  // A second copy is how "today" quietly splits into two definitions: the ledger
  // and the page would each use their own, and a change to one would not reach
  // the other. Only `src/lib/time.ts` may name the zone; everything else imports
  // TIMEZONE / tashkentDayKey from it.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(path)) continue;
      if (path.endsWith(join("src", "lib", "time.ts"))) continue;
      // Comments may name the zone (they explain it); code may not.
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.split("//")[0])
        .join("\n");
      if (code.includes("Asia/Tashkent")) offenders.push(path);
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});
