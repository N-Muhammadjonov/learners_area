import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, liveClassAttendance, liveClasses } from "@/db/schema";

/**
 * Record that a learner attended a live class, and write the activity event that says so.
 *
 * Attendance and its event are ONE write unit: split, a failure between them left a learner marked as
 * attended with no event, or an event for an attendance row that did not exist.
 *
 * §04 — CONCURRENT FIRST JOIN. Extracted from `POST /api/live-classes/:id/join` so the join write can be
 * exercised directly by a concurrency test instead of only through an authenticated HTTP request. The
 * route keeps its own class lookup, cancellation check and join-window check; this function owns only
 * the write, which is the part that has to be atomic.
 */
export async function recordLiveClassAttendance(
  liveClassId: string,
  userId: string,
  database: typeof db = db,
): Promise<{ created: boolean; joinedAt: Date | null }> {
  return database.transaction(async (tx) => {
    /*
     * §04 — WHY THE EXISTENCE CHECK IS NOW INSIDE THE TRANSACTION, BEHIND A ROW LOCK.
     *
     * `live_class_attendance` has only a primary key: no unique constraint on (live_class_id, user_id).
     * So "check whether the row exists, then insert it" cannot be made atomic by a transaction alone. At
     * READ COMMITTED each transaction reads a snapshot taken before the other committed, so two
     * simultaneous first joins BOTH see "absent" and BOTH insert. The reproduction in
     * tests/live-class-concurrent-join-qa2.test.ts proves this with two independent connections held open
     * at once: one learner ended up with two attendance rows and two LIVE_CLASS_ATTENDED events.
     *
     * Locking the parent class row with SELECT … FOR UPDATE serializes joins for THAT CLASS: the second
     * transaction blocks on the lock until the first commits, and its own existence check then sees the
     * committed row and does nothing. It does not serialize different classes, and it holds no external
     * call — the lock spans three local statements.
     *
     * A unique index would be the stronger guarantee and is prepared as an owner decision (see
     * docs/OWNER-DOSSIER.md): it needs a migration, and applying one to Production without checking the
     * authoritative schema for pre-existing duplicates could fail the deploy or, worse, invite someone to
     * "fix" it by deleting rows. This lock closes the defect with no schema change at all.
     */
    const locked = await tx
      .select({ id: liveClasses.id })
      .from(liveClasses)
      .where(eq(liveClasses.id, liveClassId))
      .for("update");
    if (locked.length === 0) return { created: false, joinedAt: null };

    const existing = await tx
      .select({ joinedAt: liveClassAttendance.joinedAt })
      .from(liveClassAttendance)
      .where(and(eq(liveClassAttendance.liveClassId, liveClassId), eq(liveClassAttendance.userId, userId)))
      .limit(1);
    const already = existing[0];
    if (already) return { created: false, joinedAt: already.joinedAt };

    const [inserted] = await tx
      .insert(liveClassAttendance)
      .values({ liveClassId, userId })
      .returning({ joinedAt: liveClassAttendance.joinedAt });
    await tx.insert(activityEvents).values({
      userId,
      type: "LIVE_CLASS_ATTENDED",
      payload: { liveClassId },
    });
    return { created: true, joinedAt: inserted?.joinedAt ?? null };
  });
}

/** Re-exported so callers can check the class exists without a second import of the schema. */
export { liveClasses };
