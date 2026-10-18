import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, authSessionRevocations } from "@/db/schema";
import { timed } from "@/lib/observability/timing";
import type { CurrentUser } from "./current-user";

export type SessionAuthorityInput = {
  userId: string;
  authVersion: number;
  sessionKey: string;
  /** Unix seconds from a verified JWT or authenticated server capability. */
  expiresAt: number;
};

/** Only call with cryptographically verified identity/capability, never request JSON. */
export async function validateSessionAuthority(input: SessionAuthorityInput, client = db): Promise<CurrentUser | null> {
  if (!Number.isSafeInteger(input.authVersion) || input.authVersion < 0 ||
      !/^[a-f0-9]{64}$/.test(input.sessionKey) ||
      !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now() / 1000) return null;
  // A single indexed identity lookup includes revocation. Nothing caches current
  // role, admission or epochs across requests, instances, or database outages.
  const row = await timed("auth.currentUser", () => client.query.users.findFirst({
    where: and(eq(users.id, input.userId), eq(users.authVersion, input.authVersion),
      // Explicit subquery alias avoids the relational query builder rebinding
      // its column references to the outer users alias.
      sql`not exists (select 1 from "auth_session_revocations" r where r."token_hash" = ${input.sessionKey} and r."user_id" = ${input.userId} and r."expires_at" > now())`),
    columns: { id: true, name: true, email: true, role: true, accountStatus: true,
      locale: true, onboardingCompletedAt: true, statusReason: true },
  }));
  if (!row || input.expiresAt <= Date.now() / 1000) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role,
    accountStatus: row.accountStatus, locale: row.locale,
    onboarded: Boolean(row.onboardingCompletedAt), statusReason: row.statusReason };
}

/** Revokes this exact verified token; other devices and fresh sign-ins survive. */
export async function revokeSession(input: SessionAuthorityInput, client = db): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(input.sessionKey) || input.expiresAt <= Date.now() / 1000) return;
  await client.transaction(async (tx) => {
    await tx.insert(authSessionRevocations).values({ tokenHash: input.sessionKey, userId: input.userId, expiresAt: new Date(input.expiresAt * 1000) }).onConflictDoNothing();
    // Bounded pruning uses the expiry index. Never retain signed cookies or PII.
    await tx.execute(sql`delete from ${authSessionRevocations} where ${authSessionRevocations.tokenHash} in (select ${authSessionRevocations.tokenHash} from ${authSessionRevocations} where ${authSessionRevocations.expiresAt} <= now() order by ${authSessionRevocations.expiresAt} limit 100)`);
    await tx.execute(sql`select pg_notify('la_access_changed', ${JSON.stringify({ userId: input.userId })})`);
  });
}
