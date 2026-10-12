import { isAdministrator, type Role } from "@/lib/auth/roles";

/** Reading content import is Management-only, matching every /api/admin/reading route. */
export function mayImportReading(role: Role): boolean {
  return isAdministrator(role);
}
