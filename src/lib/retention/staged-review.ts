import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countWords } from "@/lib/retention/word-count";
import { evaluateRecall } from "@/lib/retention/evaluator";
import { validateMeasurementStructure } from "@/lib/retention/measurement";
import { type RetentionLevel } from "@/lib/retention/levels";

/**
 * Read-only author review of the approved FINAL V2 source files. The bank is
 * QA-HOLD, not an active learner bank; this module must never create attempts,
 * write retention_texts or expose the authored scoring structure to students.
 * Invoke ONLY behind requireAdministrator() in a server component.
 */
type StagedRow = {
  sourceId: string;
  level: RetentionLevel;
  bodyText: string;
  scoringStructure: unknown;
};

type HoldEvidence = {
  status: string;
  anomalies: Array<{ sourceId: string; test: string; got: number }>;
};

export type StagedRetentionReview = {
  sourceId: string;
  level: RetentionLevel;
  bodyText: string;
  wordCount: number;
  held: boolean;
  canonicalScore: number;
  sourceScore: number;
  /** Diagnostic group identifiers only; the rubric stays server-side. */
  missingGroups: Array<{ claimId: string; missingGroupIds: string[] }>;
};

export function readStagedRetentionReview(level: RetentionLevel): {
  items: StagedRetentionReview[];
  holdStatus: string;
  heldTextCount: number;
  mismatchCount: number;
} {
  // level is already constrained to RETENTION_LEVELS in the route.
  const root = resolve(process.cwd(), "content", "retention-v2");
  const source = readFileSync(resolve(root, `${level}.jsonl`), "utf8");
  const evidence = JSON.parse(readFileSync(resolve(root, "calibration-gaps.json"), "utf8")) as HoldEvidence;
  if (evidence.status !== "QA_HOLD_DO_NOT_PUBLISH") {
    throw new Error("retention_staged_source_requires_explicit_release_review");
  }
  const held = new Set(evidence.anomalies.map(a => a.sourceId));
  const rows = source.trim().split(/\r?\n/u).map(line => JSON.parse(line) as StagedRow);
  const items: StagedRetentionReview[] = rows.map(row => {
    if (row.level !== level) throw new Error("retention_staged_level_mismatch");
    const rubric = validateMeasurementStructure(row.scoringStructure);
    const canonical = evaluateRecall(rubric.claims.map(c => c.label).join("\n"), rubric);
    const sourceScore = evaluateRecall(row.bodyText, rubric);
    return {
      sourceId: row.sourceId,
      level,
      bodyText: row.bodyText,
      wordCount: countWords(row.bodyText),
      held: held.has(row.sourceId),
      canonicalScore: canonical.score,
      sourceScore: sourceScore.score,
      missingGroups: sourceScore.breakdown.claims.filter(c => c.missingGroupIds.length > 0)
        .map(c => ({ claimId: c.claimId, missingGroupIds: c.missingGroupIds })),
    };
  });
  return {
    items,
    holdStatus: evidence.status,
    heldTextCount: items.filter(row => row.held).length,
    mismatchCount: evidence.anomalies.filter(row => row.sourceId.startsWith(`${level}-`)).length,
  };
}
