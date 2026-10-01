import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { GoogleClaims } from "@/lib/auth/providers/google";

type Database = Pick<typeof db, "transaction">;
export type GoogleResolution =
  | { kind: "signed_in"; user: typeof users.$inferSelect; created: boolean }
  | { kind: "link_required" }
  | { kind: "unverified_email" };

/**
 * Map a verified Google identity onto an account WITHOUT email-based merging.
 *  1. `google_sub` already known → that account (status/roles untouched).
 *  2. Unverified email → refused.
 *  3. The email belongs to an existing account → `link_required`; nothing is
 *     written. The owner of that account must sign in with their method.
 *  4. Otherwise → a new PENDING student; the caller enqueues the access request.
 */
export async function resolveGoogleAccount(claims: GoogleClaims, input: { locale: string }, connection: Database = db): Promise<GoogleResolution> {
  try {
    return await resolveOnce(claims, input, connection);
  } catch (error) {
    // Two callbacks for the same new identity can race; the unique indexes on
    // google_sub / email make the loser fail. Re-resolve once: it now sees the
    // winner's row (same sub -> signed in) or the e-mail owner (-> link_required).
    if (isUniqueViolation(error)) return resolveOnce(claims, input, connection);
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth += 1) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

async function resolveOnce(claims: GoogleClaims, input: { locale: string }, connection: Database): Promise<GoogleResolution> {
  return connection.transaction(async (tx) => {
    const known = await tx.query.users.findFirst({ where: eq(users.googleSub, claims.sub) });
    if (known) return { kind: "signed_in", user: known, created: false };
    if (!claims.email || !claims.emailVerified) return { kind: "unverified_email" };
    // Accounts store e-mail lower-cased (validation/auth.ts); compare case-insensitively
    // so "Owner@Example.com" from Google can never create a second account beside
    // "owner@example.com" and skip the link-required rule.
    const email = claims.email.trim().toLowerCase();
    const sameEmail = await tx.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
    // A concurrent callback for THIS identity may have committed between the two
    // reads: its row carries our sub, so it is the same account, not a link case.
    if (sameEmail?.googleSub === claims.sub) return { kind: "signed_in", user: sameEmail, created: false };
    if (sameEmail) return { kind: "link_required" };
    const [created] = await tx.insert(users).values({
      name: claims.name || email.split("@")[0]!, email, googleSub: claims.sub,
      role: "student", accountStatus: "pending", locale: input.locale,
    }).returning();
    return { kind: "signed_in", user: created!, created: true };
  });
}
