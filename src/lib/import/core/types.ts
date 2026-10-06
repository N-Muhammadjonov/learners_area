import type { ImportErrorCode, ImportIssue } from "./validation";

/**
 * The one result shape every module importer returns. The pipeline, the API and
 * the admin UI therefore never switch on a module — a new module plugs in
 * without touching them.
 */

export type ImportAction = "created" | "updated" | "unchanged";

export type ImportRunSuccess = {
  ok: true;
  action: ImportAction;
  targetType: string;
  targetId: string;
  sourceRef: string;
  contentVersion: number;
  contentHash: string;
  publicationState: string;
  legacyRuntime: boolean;
  /** Small, safe summary (counts, lexical resolution) — never raw content. */
  summary: Record<string, unknown>;
  warnings: string[];
};

export type ImportRunFailure = {
  ok: false;
  code: ImportErrorCode;
  issues: ImportIssue[];
  detail?: string;
};

export type ImportRunOutcome = ImportRunSuccess | ImportRunFailure;
