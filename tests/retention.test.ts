import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chunk, monthsAgo } from "../src/lib/services/retention";

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
  assert.match(retentionSource, /pg_try_advisory_xact_lock/, "the lock must be transaction-scoped through poolers");
  assert.match(retentionSource, /database.transaction/, "lock and writes must use one transaction");
  assert.doesNotMatch(retentionSource, /pg_advisory_unlock/, "never unlock a session on an arbitrary pooled connection");
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

test("the words an applicant wrote expire, the decision about them does not", () => {
  const block = retentionSource.slice(
    retentionSource.indexOf("8b. Applicant free text"),
    retentionSource.indexOf("applicant_free_text")
  );
  assert.match(block, /isNotNull\(accessRequests\.decidedAt\)/, "only decided applications are touched");
  assert.match(block, /message: null, decisionNote: null/, "the free text is what is cleared");
  assert.match(block, /inArray\(/, "cleared in batches, not row by row in a loop over the whole table");
  // The decision record must survive: nothing in this rule deletes a row.
  const push = retentionSource.slice(retentionSource.indexOf('rule: "applicant_free_text"') - 200);
  assert.ok(!/db\.delete\(accessRequests\)/.test(retentionSource), "a decision is never deleted by retention");
  assert.match(push, /affected: staleApplicationNotes\.length/);
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

test("calendar retention cutoffs clamp month ends and preserve UTC time", () => {
  assert.equal(monthsAgo(6, new Date("2026-08-31T23:30:12.123Z")).toISOString(), "2026-02-28T23:30:12.123Z");
  assert.equal(monthsAgo(6, new Date("2024-08-31T23:30:12.123Z")).toISOString(), "2024-02-29T23:30:12.123Z");
  assert.equal(monthsAgo(18, new Date("2026-09-28T08:00:00Z")).toISOString(), "2025-03-28T08:00:00.000Z");
  const original = new Date("2026-03-31T00:01:00Z");
  monthsAgo(1, original);
  assert.equal(original.toISOString(), "2026-03-31T00:01:00.000Z");
});
