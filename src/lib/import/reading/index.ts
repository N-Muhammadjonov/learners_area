import type { CanonicalPackage } from "../core/envelope";
import { registerContentType } from "../core/registry";
import { registerModuleImporter, type ModuleImporter, type ModuleImportOptions } from "../core/server-registry";
import type { ImportRunOutcome } from "../core/types";
import { READING_CONTENT_TYPE, readingSetDescriptor, type ReadingCanonicalPackage } from "./canonical";
import { importCanonicalReadingSet } from "./importer";

export * from "./canonical";
export { importCanonicalReadingSet } from "./importer";

export const readingImporter: ModuleImporter = {
  module: "reading",
  contentType: READING_CONTENT_TYPE,
  targetType: "general_reading_set",
  run: async (tx, pkg: CanonicalPackage, options: ModuleImportOptions): Promise<ImportRunOutcome> => {
    const outcome = await importCanonicalReadingSet(tx, pkg as ReadingCanonicalPackage, {
      actorUserId: options.actorUserId,
      publish: options.publish,
      publishAuthorized: options.publishAuthorized,
      ...(options.originalFilename ? { originalFilename: options.originalFilename } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    });
    if (!outcome.ok)
      return {
        ok: false,
        code: outcome.code,
        issues: outcome.issues,
        ...(outcome.detail ? { detail: outcome.detail } : {}),
      };
    return {
      ok: true,
      action: outcome.action,
      targetType: "general_reading_set",
      targetId: outcome.targetId,
      sourceRef: outcome.sourceRef,
      contentVersion: outcome.contentVersion,
      contentHash: outcome.contentHash,
      publicationState: outcome.publicationState,
      legacyRuntime: false,
      summary: { passages: outcome.passages.length, resolved: outcome.passages.reduce((n, p) => n + p.resolved, 0) },
      warnings: outcome.warnings,
    };
  },
};

let registered = false;
export function registerReadingModule(): void {
  if (registered) return;
  registerContentType(readingSetDescriptor);
  registerModuleImporter(readingImporter);
  registered = true;
}
