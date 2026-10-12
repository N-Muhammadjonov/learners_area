/**
 * §06 — types for the shared cleanup verdict. Declared next to the implementation so the probes and the
 * truth-table test share ONE contract: a change to the helper's shape is a compile error here, not a
 * silent `any` in whichever file imported it.
 */
export type SweepOutcome = {
  removed?: Record<string, number>;
  residue?: string[];
  lockReleased?: boolean;
  uncovered?: string[];
  vanished?: string[];
  /** Present when `sweeper.sweep()` THREW — the case the old probes printed and then ignored. */
  error?: string;
};

export type CleanupVerdict = {
  failures: string[];
  warnings: string[];
  exitCode: 0 | 1;
  bodyFailed: boolean;
  cleanupFailed: boolean;
  verdict: string;
};

export function resolveVerdict(options?: {
  bodyFailures?: string[];
  sweep?: SweepOutcome | null;
  label?: string;
}): CleanupVerdict;

export function reportVerdict(verdict: CleanupVerdict, options?: { pass?: number }): 0 | 1;
