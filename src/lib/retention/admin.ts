import "server-only";
import type { NextResponse } from "next/server";
import { isAdministrator, requireActiveUser, type CurrentUser } from "@/lib/auth/current-user";
import { forbidden, unauthenticated } from "@/lib/retention/http";

/**
 * The admin gate for every Retention CMS route.
 *
 * Same three states as the rest of the Management area — signed out, signed in
 * without rights, allowed — so a route never has to remember the role list and
 * the answer is consistent across the whole section.
 */
export async function requireRetentionAdmin(): Promise<
  { ok: true; user: CurrentUser } | { ok: false; response: NextResponse }
> {
  const user = await requireActiveUser();
  if (!user) return { ok: false, response: unauthenticated() };
  if (!isAdministrator(user.role)) return { ok: false, response: forbidden() };
  return { ok: true, user };
}
