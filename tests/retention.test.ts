import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chunk } from "../src/lib/services/retention";

const ROOT = path.resolve(import.meta.dirname, "..");
const retentionSource = readFileSync(path.join(ROOT, "src/lib/services/retention.ts"), "utf8");
const activitySource = readFileSync(path.join(ROOT, "src/lib/services/activity.ts"), "utf8");

test("batching never loads a table in one go", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
  // A batch larger than the list is still one batch, not a loop forever.
  assert.deepEqual(chunk([1], 500), [[1]]);
  assert.match(retentionSource, /deleteBatched/, "the service must delete in batches");
  assert.match(retentionSource, /\.limit\(limit\)/, "each batch must be limited");
});

test("the retention lock is taken per run, and released afterwards", () => {
  assert.match(retentionSource, /pg_try_advisory_lock/, "a run must take a lock");
  assert.match(retentionSource, /pg_advisory_unlock/, "the lock must be released");
  assert.match(retentionSource, /another retention run holds the lock/, "a blocked run must say so");
});

test("inactivity is measured on real work, not on sign-ins", () => {
  assert.match(retentionSource, /lastMeaningfulActivityAt/, "the inactivity rule must read meaningful activity");
  assert.ok(
    !/lt\(users\.lastActiveAt/.test(retentionSource),
    "last_active_at must not decide who has been inactive: signing in is not studying"
  );
  assert.match(activitySource, /touchMeaningfulActivity/, "the write paths need one place to record real work");
  assert.match(activitySource, /catch \{/, "a bookkeeping touch must not fail a student's submission");
});

test("only student-produced tables are in reach of a retention run", () => {
  const whitelist = retentionSource.slice(
    retentionSource.indexOf("const OLD_WORK"),
    retentionSource.indexOf("let oldWorkTotal")
  );
  for (const table of ["courses", "course_modules", "units", "lessons", "speaking_materials", "plans", "prices"]) {
    assert.ok(!whitelist.includes(`"${table}"`), `${table} is content, never swept by retention`);
  }
  for (const table of ["writing_submissions", "reading_attempts", "listening_attempts"]) {
    assert.ok(whitelist.includes(`"${table}"`), `${table} should expire with its own window`);
  }
});

test("a preview is the default and it writes nothing", async () => {
  assert.match(retentionSource, /const dryRun = options\?\.dryRun \?\? true/, "preview must be the default");
  // Every delete sits inside a batch helper that the dry-run path never calls.
  const helpers = [...retentionSource.matchAll(/deleteIds: async \(ids\) => \{/g)].length;
  const deletes = [...retentionSource.matchAll(/await db\.delete\(/g)].length;
  assert.ok(deletes > 0 && deletes <= helpers + 1, "deletes belong to the batch helper, not scattered");
  assert.match(retentionSource, /if \(!dryRun\) \{/, "the deletion path must be guarded by dryRun");
});

test("recordings leave the object store after a reference check", () => {
  const block = retentionSource.slice(
    retentionSource.indexOf("Speaking recordings"),
    retentionSource.indexOf("evaluated_work_past_window")
  );
  assert.match(block, /stillReferenced/, "an attached key is not this rule's to delete");
  assert.match(block, /storage\.delete/, "the object must actually be removed");
  assert.match(block, /recordingObjectKey: null/, "the row keeps its academic record");
});

test("old work is protected while an evaluation still refers to it", () => {
  assert.match(retentionSource, /not exists \(select 1 from evaluations e where e\.source_type in/, "reference check");
  assert.match(retentionSource, /writing_submission/, "writing evaluations protect their submission");
  assert.match(retentionSource, /speaking_attempt/, "speaking evaluations protect their attempt");
});

test("every window is configuration with a documented default", () => {
  for (const [name, fallback] of [
    ["RETENTION_INACTIVE_STUDENT_MONTHS", "6"],
    ["RETENTION_RAW_EVENT_MONTHS", "2"],
    ["RETENTION_STRUCTURED_MONTHS", "18"],
    ["RETENTION_AUDIT_MONTHS", "18"],
    ["RETENTION_EXPORT_DAYS", "7"],
    ["RETENTION_BATCH_SIZE", "500"],
  ] as const) {
    const pattern = new RegExp(`readInt\\("${name}", ${fallback}\\)`);
    assert.match(retentionSource, pattern, `${name} must default to ${fallback}`);
  }
  assert.ok(!/const .* = 6 \* 30|magic/.test(retentionSource), "no magic-number windows");
});

test("a scheduler is not assumed: the run is a plain function", () => {
  assert.match(retentionSource, /export async function runRetention/, "callable from cron, a job or a request");
  const code = retentionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/setInterval|node-cron|cron\.schedule/.test(code), "no scheduler is embedded in the service");
});
