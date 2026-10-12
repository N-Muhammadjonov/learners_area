import type { CanonicalPackage } from "./envelope";
import type { ImportTransaction } from "./dry-run";
import type { ImportRunOutcome } from "./types";

/**
 * Server-side binding of the registry: which modules can actually be imported
 * right now. Kept apart from `./registry` so the browser can read capabilities
 * and templates without pulling database code into the client bundle.
 */

export type ModuleImportOptions = {
  actorUserId: string;
  assets: import("./assets").ResolvedAsset[];
  publish: boolean;
  publishAuthorized: boolean;
  originalFilename?: string;
  acknowledgeGradeImpact?: boolean;
  legacyRuntime?: boolean;
  dryRun?: boolean;
};

export type ModuleImporter = {
  module: string;
  contentType: string;
  targetType: string;
  run: (tx: ImportTransaction, pkg: CanonicalPackage, options: ModuleImportOptions) => Promise<ImportRunOutcome>;
};

const importers = new Map<string, ModuleImporter>();

export function registerModuleImporter(importer: ModuleImporter): void {
  const key = `${importer.module}:${importer.contentType}`;
  const existing = importers.get(key);
  if (existing && existing !== importer) throw new Error(`Duplicate importer registration: ${key}`);
  importers.set(key, importer);
}

export function resolveModuleImporter(module: string, contentType: string): ModuleImporter | undefined {
  return importers.get(`${module}:${contentType}`);
}

export function listRegisteredImporters(): { module: string; contentType: string; targetType: string }[] {
  return [...importers.values()]
    .map(({ module, contentType, targetType }) => ({ module, contentType, targetType }))
    .sort((a, b) => a.module.localeCompare(b.module) || a.contentType.localeCompare(b.contentType));
}
