import "server-only";
import { registerListeningModule } from "./listening";
import { registerReadingModule } from "./reading";
import { registerImportDescriptors } from "./capabilities";

/**
 * Server entry point of the import framework: descriptors + database importers.
 * Every canonical import route calls this once, then runs the shared pipeline.
 */
let registered = false;

export function registerImportFramework(): void {
  if (registered) return;
  registerImportDescriptors();
  registerListeningModule();
  registerReadingModule();
  registered = true;
}

export { runContentImport, latestImportFor } from "./core/pipeline";
export type { ContentImportRequest, ContentImportOutcome, ContentImportSuccess, ContentImportFailure } from "./core/pipeline";
export { parseContentPackage } from "./core/parse";
export type { ParseOutcome, ParseSuccess, ParseFailure } from "./core/parse";
export { packageContentHash } from "./core/identity";
export { importCapabilities, capabilityFor, examplePackageFor, registerImportDescriptors } from "./capabilities";
export { listContentTypes } from "./core/registry";
export { MAX_PACKAGE_BYTES, IMPORT_ERROR_STATUS } from "./core/validation";
export type { ImportErrorCode, ImportIssue, ValidationReport } from "./core/validation";
export { runWithDryRun } from "./core/dry-run";
export { claimDeclaredAssets, mimeAllowedForRole } from "./core/assets";
