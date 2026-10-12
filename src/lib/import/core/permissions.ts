import { isAdministrator, type Role } from "@/lib/auth/roles";
import { mayImportListening } from "@/lib/listening/permissions";
import { mayImportReading } from "@/lib/reading/permissions";
import type { ContentModule } from "./envelope";

/**
 * Import authorization is server-enforced and per module. Hiding a button is not
 * a control: every import request re-checks the caller's role against the same
 * rule the existing admin API uses. A student can never import course content,
 * and a teacher's scope stays bounded by the existing policies.
 */

export function mayImportModule(role: Role, module: ContentModule): boolean {
  switch (module) {
    case "listening":
      return mayImportListening(role);
    case "reading":
      return mayImportReading(role);
    default:
      // Every other canonical module is Management-owned today; each importer
      // must still be authorized here before it can be reached over HTTP.
      return isAdministrator(role);
  }
}

/** Publication is a separate authorized action from import (§35). */
export function mayPublishImportedContent(role: Role): boolean {
  return isAdministrator(role);
}
