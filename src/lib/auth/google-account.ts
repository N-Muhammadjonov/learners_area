import "server-only";
import { eq } from "drizzle-orm";
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
  return connection.transaction(async (tx) => {
    const known = await tx.query.users.findFirst({ where: eq(users.googleSub, claims.sub) });
    if (known) return { kind: "signed_in", user: known, created: false };
    if (!claims.email || !claims.emailVerified) return { kind: "unverified_email" };
    const sameEmail = await tx.query.users.findFirst({ where: eq(users.email, claims.email), columns: { id: true } });
    if (sameEmail) return { kind: "link_required" };
    const [created] = await tx.insert(users).values({
      name: claims.name || claims.email.split("@")[0]!, email: claims.email, googleSub: claims.sub,
      role: "student", accountStatus: "pending", locale: input.locale,
    }).returning();
    return { kind: "signed_in", user: created!, created: true };
  });
}
