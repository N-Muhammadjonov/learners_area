import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

/**
 * The one place that answers "when did this student last do real work?".
 *
 * Retention needs that question answered honestly: a student who signs in every
 * day to look at the dashboard but never submits anything is inactive in the
 * sense the policy cares about (see services/retention.ts). So this is called
 * from the write paths where work is actually produced and recorded — never from
 * a page render or a session touch.
 *
 * A bookkeeping update must never fail the work it describes, so failures here
 * are swallowed deliberately: the attempt is already saved and the retention
 * clock being one submission behind is a far smaller problem than an error page
 * on a student's finished essay.
 */
export async function touchMeaningfulActivity(userId: string): Promise<void> {
  try {
    await db.update(users).set({ lastMeaningfulActivityAt: new Date() }).where(eq(users.id, userId));
  } catch {
    // See above: intentionally not fatal.
  }
}
