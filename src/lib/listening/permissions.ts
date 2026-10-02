import { isAdministrator, type Role } from "@/lib/auth/roles";

/**
 * Listening package import is a Management capability: administrators and the
 * owner. The page (/admin/listening/import) and the API use this one rule so a
 * hidden link is never the only barrier. No current owner requirement grants
 * teachers package import (V2 master prompt re-read 2026-10-02).
 */
export function mayImportListening(role: Role): boolean {
  return isAdministrator(role);
}
