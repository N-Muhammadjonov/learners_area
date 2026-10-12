import test from "node:test";
import assert from "node:assert/strict";

/*
 * §06 — THE CLEANUP FALSE-PASS, PINNED BY A TRUTH TABLE.
 *
 * Both assignment probes did this:
 *
 *     const result = await sweeper.sweep().catch((e) => ({ error: e.message }));
 *     console.log(`cleanup: removed ${JSON.stringify(result?.removed ?? result?.error)}`);
 *     if (result?.residue?.length) failures.push(...);
 *
 * A THROWN sweep became `{error}`, was printed, and was then ignored: `result.residue` is undefined on
 * that object, so nothing reached `failures` and the probe exited 0 without having cleaned up anything.
 * A probe that cannot clean up is worse than one that fails loudly — it leaves fixtures for the next run
 * to trip over while reporting success.
 *
 * Required truth table, and both errors must survive when both occur:
 *
 *     BODY PASS + CLEANUP PASS = PASS
 *     BODY PASS + CLEANUP FAIL = FAIL
 *     BODY FAIL + CLEANUP PASS = FAIL
 *     BODY FAIL + CLEANUP FAIL = FAIL  (report shows BOTH)
 *
 * The helper is imported from the scripts directory rather than reimplemented here, so this test fails if
 * the probes' shared verdict logic changes. It needs no database, which is the point: the truth table is
 * about the decision, and a test that needed a live sweep could not cover the "sweep threw" row at all.
 */

/*
 * The helper is plain ESM JavaScript, typed by scripts/lib/cleanup-verdict.d.mts sitting beside it. So
 * the contract is declared ONCE, next to the implementation, and imported here — a change to the helper's
 * shape is a compile error rather than a silent `any`, and this test cannot drift from the probes it
 * guards.
 */
const { resolveVerdict, reportVerdict } = await import("../scripts/lib/cleanup-verdict.mjs");
type SweepOutcome = import("../scripts/lib/cleanup-verdict.mjs").SweepOutcome;

const cleanSweep = (): SweepOutcome => ({ removed: { assignments: 2 }, residue: [], lockReleased: true, uncovered: [], vanished: [] });
const threwSweep = (): SweepOutcome => ({ error: "connection terminated unexpectedly" });

test("§06 the cleanup verdict obeys the required truth table", async (t) => {
  await t.test("BODY PASS + CLEANUP PASS = PASS, exit 0", () => {
    const verdict = resolveVerdict({ bodyFailures: [], sweep: cleanSweep() });
    assert.equal(verdict.exitCode, 0);
    assert.equal(verdict.verdict, "PASS");
    assert.deepEqual(verdict.failures, []);
    assert.equal(verdict.bodyFailed, false);
    assert.equal(verdict.cleanupFailed, false);
    assert.equal(reportVerdict(verdict, { pass: 12 }), 0, "reportVerdict must return the exit code");
  });

  await t.test("BODY PASS + CLEANUP FAIL = FAIL, exit 1 — the row the old code got wrong", () => {
    // Three distinct ways cleanup can fail; all three must fail the run.
    const cases: Array<[string, SweepOutcome | null]> = [
      ["the sweep threw", threwSweep()],
      ["the sweep reported residue", { ...cleanSweep(), residue: ["assignments: 2 rows left"] }],
      ["the sweep reported nothing at all", null],
    ];
    for (const [label, sweep] of cases) {
      const verdict = resolveVerdict({ bodyFailures: [], sweep });
      assert.equal(verdict.exitCode, 1, `${label}: must exit 1`);
      assert.equal(verdict.cleanupFailed, true, `${label}: must be classified as a cleanup failure`);
      assert.equal(verdict.bodyFailed, false, `${label}: the body passed and must not be blamed`);
      assert.ok(verdict.failures.length > 0, `${label}: the failure must be recorded, not only printed`);
      assert.equal(reportVerdict(verdict, { pass: 12 }), 1);
    }
  });

  await t.test("BODY FAIL + CLEANUP PASS = FAIL, exit 1", () => {
    const verdict = resolveVerdict({ bodyFailures: ["B3-04 the targeted learner's list contains the work"], sweep: cleanSweep() });
    assert.equal(verdict.exitCode, 1);
    assert.equal(verdict.bodyFailed, true);
    assert.equal(verdict.cleanupFailed, false);
    assert.equal(verdict.verdict, "FAIL (body)");
  });

  await t.test("BODY FAIL + CLEANUP FAIL = FAIL, and BOTH errors are preserved", () => {
    const body = ["B3-06 the other learner's list does not"];
    const verdict = resolveVerdict({ bodyFailures: body, sweep: threwSweep() });
    assert.equal(verdict.exitCode, 1);
    assert.equal(verdict.bodyFailed, true);
    assert.equal(verdict.cleanupFailed, true);
    assert.equal(verdict.verdict, "FAIL (body and cleanup)");
    // The specific requirement: neither error may displace the other.
    assert.equal(verdict.failures.length, 2, `both failures must survive, got ${JSON.stringify(verdict.failures)}`);
    assert.ok(verdict.failures.some((f) => f.includes("B3-06")), "the body failure must be in the report");
    assert.ok(verdict.failures.some((f) => /cleanup FAILED/i.test(f)), "the cleanup failure must be in the report");
    assert.ok(verdict.failures.some((f) => f.includes("connection terminated")), "the underlying sweep error must be named");
  });

  await t.test("a vanished or uncovered table warns but does not decide the exit code", () => {
    /*
     * Deliberate: a table dropped mid-run cannot be swept, and failing on that would abort the sweep and
     * leave every table after it unchecked. These must be surfaced so they cannot be silently ignored,
     * but they are not by themselves a cleanup failure.
     */
    const verdict = resolveVerdict({
      bodyFailures: [],
      sweep: { ...cleanSweep(), vanished: ["scratch_table"], uncovered: ["live_partner_blocks"], lockReleased: false },
    });
    assert.equal(verdict.exitCode, 0, "warnings alone must not fail the run");
    assert.equal(verdict.warnings.length, 3, `all three warnings must be surfaced, got ${JSON.stringify(verdict.warnings)}`);
    assert.ok(verdict.warnings.some((w) => w.includes("live_partner_blocks")), "an uncovered table must be named");
    assert.ok(verdict.warnings.some((w) => /lock was not released/.test(w)), "an unreleased lock must be named");
  });

  await t.test("residue is reported even when the body already failed", () => {
    const verdict = resolveVerdict({
      bodyFailures: ["body"],
      sweep: { ...cleanSweep(), residue: ["assignment_targets: 1 rows left"] },
    });
    assert.equal(verdict.failures.length, 2);
    assert.ok(verdict.failures.some((f) => f.includes("assignment_targets")), "the residue must name the table");
  });
});

test("§06 both assignment probes derive their exit code from the shared verdict", async (t) => {
  /*
   * The helper alone does not prove the probes use it: a probe could import it and still exit on
   * `failures.length`. So the actual source of both probes is checked for the wiring — that the sweep's
   * thrown error is no longer swallowed into a print, and that the exit code comes from the verdict.
   */
  const { readFileSync } = await import("node:fs");
  for (const script of ["scripts/verify-assignment-b3.mjs", "scripts/verify-assignment-journey.mjs"]) {
    const source = readFileSync(new URL(`../${script}`, import.meta.url), "utf8");
    assert.ok(source.includes('await import("./lib/cleanup-verdict.mjs")'), `${script} must use the shared verdict helper`);
    assert.ok(/exitCode = reportVerdict\(resolveVerdict\(/.test(source), `${script} must set its exit code from the verdict`);
    assert.ok(/process\.exit\(exitCode\)/.test(source), `${script} must exit on the verdict's code`);
    assert.ok(!/process\.exit\(failures\.length \? 1 : 0\)/.test(source), `${script} must no longer exit on the body failures alone`);
    // The swallowed-exception shape must be gone: a caught sweep error has to reach the verdict.
    assert.ok(!/if \(result\?\.residue\?\.length\) \{ failures\.push/.test(source),
      `${script} must not decide cleanup failure from result.residue alone`);
    assert.ok(/let exitCode = 1;/.test(source), `${script} must default to failure so an early abort cannot exit 0`);
    const declarationAt = source.indexOf("let exitCode = 1;");
    const tryAt = source.indexOf("\ntry {", declarationAt);
    assert.ok(declarationAt > -1 && tryAt > declarationAt,
      `${script} must declare exitCode OUTSIDE the try — a block-scoped let inside try is invisible to finally`);
  }
});
