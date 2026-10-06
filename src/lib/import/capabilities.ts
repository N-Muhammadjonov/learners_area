import { listContentTypes, registerContentType, type ContentTypeDescriptor } from "./core/registry";
import { listeningPackageDescriptor } from "./listening/canonical";
import { readingSetDescriptor } from "./reading/canonical";

/**
 * Client-safe entry point of the import framework.
 *
 * It registers DESCRIPTORS only (schemas, semantics, previews, templates) —
 * never a database importer — so an admin page can list capabilities, download a
 * template or validate a file in the browser without pulling server code into
 * the bundle. Server-side binding lives in `./server`.
 */

let registered = false;

export function registerImportDescriptors(): void {
  if (registered) return;
  registerContentType(listeningPackageDescriptor);
  registerContentType(readingSetDescriptor);
  registered = true;
}

export type ImportCapability = {
  module: string;
  contentType: string;
  schemaVersion: number;
  label: string;
  status: ContentTypeDescriptor["status"];
  /** `module:contentType:vN` — the identity an AI author is asked to declare. */
  key: string;
  /** Downloadable canonical template (exactly the shape the importer accepts). */
  template: unknown;
};

export function importCapabilities(): ImportCapability[] {
  registerImportDescriptors();
  return listContentTypes().map((descriptor) => ({
    module: descriptor.module,
    contentType: descriptor.contentType,
    schemaVersion: descriptor.schemaVersion,
    label: descriptor.label,
    status: descriptor.status,
    key: `${descriptor.module}:${descriptor.contentType}:v${descriptor.schemaVersion}`,
    template: descriptor.template?.() ?? null,
  }));
}

export function capabilityFor(module: string, contentType: string): ImportCapability | undefined {
  return importCapabilities().find((entry) => entry.module === module && entry.contentType === contentType);
}

/** The canonical synthetic example for a module, when one is published. */
export function examplePackageFor(module: string, contentType: string): unknown {
  registerImportDescriptors();
  const descriptor = listContentTypes().find(
    (entry) => entry.module === module && entry.contentType === contentType,
  );
  return descriptor?.example?.() ?? null;
}
