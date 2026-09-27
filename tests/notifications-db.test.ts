import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, notifications } from "../src/db/schema";
import { countUnread, markNotificationsRead, notifyUsers } from "../src/lib/data/notifications";

test("notification acknowledgements are owned, selective and idempotent", {
  skip: process.env.QA2_DATABASE_TESTS !== "1" && "set QA2_DATABASE_TESTS=1 for the isolated database",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "only the isolated QA database is allowed");
  const ids = [randomUUID(), randomUUID()];
  await db.insert(users).values(ids.map((id) => ({ id, name: "Notification QA fixture", role: "student" as const })));
  try {
    await notifyUsers([ids[0]!, ids[0]!, ids[1]!], { type: "qa2", title: "Owned notification" });
    const rows = await db.select().from(notifications).where(inArray(notifications.userId, ids));
    const mine = rows.find((row) => row.userId === ids[0])!;
    const theirs = rows.find((row) => row.userId === ids[1])!;
    assert.equal(rows.length, 2, "duplicate recipient is delivered only once");
    await markNotificationsRead(ids[0]!, []);
    assert.equal(await countUnread(ids[0]!), 1, "empty visible list must not mean mark all");
    await markNotificationsRead(ids[0]!, [theirs.id]);
    assert.equal(await countUnread(ids[1]!), 1, "cannot acknowledge someone else's row");
    await markNotificationsRead(ids[0]!, [mine.id]);
    const firstRead = (await db.select().from(notifications).where(eq(notifications.id, mine.id)))[0]!.readAt;
    await markNotificationsRead(ids[0]!, [mine.id]);
    const secondRead = (await db.select().from(notifications).where(eq(notifications.id, mine.id)))[0]!.readAt;
    assert.equal(firstRead?.getTime(), secondRead?.getTime(), "retry preserves original read timestamp");
    assert.equal(await countUnread(ids[0]!), 0);
    await markNotificationsRead(ids[1]!);
    assert.equal(await countUnread(ids[1]!), 0, "explicit all-read is scoped to caller");
  } finally {
    await db.delete(users).where(inArray(users.id, ids));
  }
});
