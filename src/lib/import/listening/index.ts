import type { CanonicalPackage } from "../core/envelope";
import { registerContentType } from "../core/registry";
import { registerModuleImporter, type ModuleImporter, type ModuleImportOptions } from "../core/server-registry";
import type { ImportRunOutcome } from "../core/types";
import {
  LISTENING_CONTENT_TYPE,
  listeningPackageDescriptor,
  normalizeListeningPackage,
  type ListeningCanonicalPackage,
} from "./canonical";
import { importCanonicalListeningPackage } from "./importer";

export * from "./canonical";
export { importCanonicalListeningPackage, importLegacyListeningRuntime } from "./importer";
export type { ListeningImportOutcome, ListeningImportOptions } from "./importer";

/**
 * Binds the Listening descriptor to its database importer and normalizes the
 * module-specific outcome into the shared import result every caller understands.
 */
export const listeningImporter: ModuleImporter = {
  module: "listening",
  contentType: LISTENING_CONTENT_TYPE,
  targetType: "listening_test",
  run: async (tx, pkg: CanonicalPackage, options: ModuleImportOptions): Promise<ImportRunOutcome> => {
    const outcome = await importCanonicalListeningPackage(tx, pkg as ListeningCanonicalPackage, {
      actorUserId: options.actorUserId,
      assets: options.assets,
      publish: options.publish,
      publishAuthorized: options.publishAuthorized,
      ...(options.originalFilename ? { originalFilename: options.originalFilename } : {}),
      ...(options.acknowledgeGradeImpact ? { acknowledgeGradeImpact: true } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    });
    if (!outcome.ok)
      return {
        ok: false,
        code: outcome.code,
        issues: outcome.report.issues,
        ...(outcome.detail ? { detail: outcome.detail } : {}),
      };
    return {
      ok: true,
      action: outcome.action,
      targetType: "listening_test",
      targetId: outcome.targetId,
      sourceRef: outcome.sourceRef,
      contentVersion: outcome.contentVersion,
      contentHash: outcome.contentHash,
      publicationState: outcome.publicationState,
      legacyRuntime: outcome.legacyRuntime,
      summary: {
        counts: outcome.counts,
        lexical: outcome.lexical ?? null,
        contentImportId: outcome.contentImportId,
      },
      warnings: outcome.warnings,
    };
  },
};

let registered = false;
/** Idempotent: safe from both the capability entry point and the API route. */
export function registerListeningModule(): void {
  if (registered) return;
  registerContentType(listeningPackageDescriptor);
  registerModuleImporter(listeningImporter);
  registered = true;
}

/** The canonical payload the runtime stores, for tests and conversion tooling. */
export function storedListeningPackage(pkg: ListeningCanonicalPackage) {
  return normalizeListeningPackage(pkg);
}
