/*
 * §06 — ONE VERDICT FROM A BODY RESULT AND A CLEANUP RESULT.
 *
 * THE FALSE PASS THIS EXISTS TO PREVENT.
 *
 * Both assignment probes did this:
 *
 *     const result = await sweeper.sweep().catch((e) => ({ error: e.message }));
 *     console.log(`  cleanup: removed ${JSON.stringify(result?.removed ?? result?.error)}`);
 *     if (result?.residue?.length) failures.push(...);
 *
 * The `.catch` converts a THROWN sweep into `{error}`, which is only printed. `result.residue` is then
 * undefined, so the `if` never fires, nothing reaches `failures`, and the script exits 0 — after failing
 * to clean up at all. A probe that cannot clean up is worse than one that fails loudly: it leaves
 * fixtures behind for the next run to trip over, and reports success while doing it.
 *
 * Required truth table:
 *
 *     BODY PASS + CLEANUP PASS = PASS
 *     BODY PASS + CLEANUP FAIL = FAIL
 *     BODY FAIL + CLEANUP PASS = FAIL
 *     BODY FAIL + CLEANUP FAIL = FAIL   (and BOTH errors must survive into the report)
 *
 * `vanished` and `uncovered` are deliberately WARNINGS, not failures: a table that was dropped mid-run
 * cannot be swept, and failing on that would abort the sweep and leave the tables after it unchecked.
 * They are surfaced and counted so they cannot be silently ignored, but they do not decide the exit code.
 */

/**
 * @param options {{
 *   bodyFailures?: string[],
 *   sweep?: {removed?: Record<string, number>, residue?: string[], lockReleased?: boolean,
 *            uncovered?: string[], vanished?: string[], error?: string} | null,
 *   label?: string,
 * }}
 * @returns {{failures: string[], warnings: string[], exitCode: 0|1,
 *            bodyFailed: boolean, cleanupFailed: boolean, verdict: string}}
 */
export function resolveVerdict({ bodyFailures = [], sweep, label = "cleanup" } = {}) {
  const failures = [...bodyFailures];
  const warnings = [];
  const bodyFailed = bodyFailures.length > 0;

  // A missing result is itself a failure: "we never learned whether cleanup worked" is not a pass.
  let cleanupFailed = false;
  if (!sweep) {
    failures.push(`${label} reported no result — the sweep never completed`);
    cleanupFailed = true;
  } else if (sweep.error) {
    // THE case the old code swallowed.
    failures.push(`${label} FAILED: ${sweep.error}`);
    cleanupFailed = true;
  } else if (Array.isArray(sweep.residue) && sweep.residue.length > 0) {
    failures.push(`${label} left residue: ${JSON.stringify(sweep.residue)}`);
    cleanupFailed = true;
  }

  if (sweep && !sweep.error) {
    if (Array.isArray(sweep.vanished) && sweep.vanished.length > 0) {
      warnings.push(`${label}: ${sweep.vanished.length} table(s) vanished before the sweep: ${sweep.vanished.join(", ")}`);
    }
    if (Array.isArray(sweep.uncovered) && sweep.uncovered.length > 0) {
      warnings.push(`${label}: ${sweep.uncovered.length} table(s) were not covered by the sweep: ${sweep.uncovered.join(", ")}`);
    }
    if (sweep.lockReleased === false) {
      warnings.push(`${label}: the advisory lock was not released`);
    }
  }

  const verdict = bodyFailed && cleanupFailed ? "FAIL (body and cleanup)"
    : cleanupFailed ? "FAIL (cleanup)"
    : bodyFailed ? "FAIL (body)"
    : "PASS";

  return { failures, warnings, exitCode: failures.length > 0 ? 1 : 0, bodyFailed, cleanupFailed, verdict };
}

/** Print a verdict block the same way in every probe, so a report can be compared across runs. */
export function reportVerdict(verdict, { pass = 0 } = {}) {
  console.log(`\n${pass} passed, ${verdict.failures.length} failed — ${verdict.verdict}`);
  for (const failure of verdict.failures) console.log(`  - ${failure}`);
  for (const warning of verdict.warnings) console.log(`  ! ${warning}`);
  return verdict.exitCode;
}
