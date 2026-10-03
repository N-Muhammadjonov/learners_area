import { isAdministrator, type Role } from "@/lib/auth/roles";

/**
 * Writing Management policy: authoring AND publication are ADMIN / OWNER only
 * (no newer owner rule grants them to teachers). Pages, APIs and the shared
 * publication endpoint all enforce this server-side.
 */
export function canManageWriting(role: Role | null | undefined): boolean {
  return Boolean(role) && isAdministrator(role as Role);
}
