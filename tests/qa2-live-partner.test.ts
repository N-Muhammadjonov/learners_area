import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users } from "../src/db/schema";
import { acceptInvite, acceptRules, goOnline, invite, getState } from "../src/lib/data/live-partner";
import { LIVE_PARTNER_RULES_VERSION } from "../src/lib/live-partner/rules";

test("QA2 real PostgreSQL: concurrent invites/accepts on separate connections — one call wins, no deadlock", {
  skip: process.env.QA2_DATABASE_TESTS !== "1" && "set QA2_DATABASE_TESTS=1",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  const ids = Array.from({ length: 7 }, () => randomUUID());
  await db.insert(users).values(ids.map((id, i) => ({ id, name: `LP${i}`, role: "student" as const, accountStatus: "active" as const, gender: "male" as const, email: `lp.${id}@example.test` })));
  try {
    const now = new Date();
    for (const id of ids) { await acceptRules(id, LIVE_PARTNER_RULES_VERSION, now); await goOnline(id, now); }
    const [target, ...inviters] = ids as [string, ...string[]];
    const results = await Promise.allSettled(inviters.map((id) => invite(id, target, now)));
    const wins = results.filter((r) => r.status === "fulfilled");
    assert.equal(wins.length, 1, "exactly one concurrent invite to the same user succeeds");
    // Mutual simultaneous invites between two free users.
    const free = inviters.filter((_, i) => results[i]!.status === "rejected");
    const [x, y] = free as [string, string];
    const mutual = await Promise.allSettled([invite(x, y, now), invite(y, x, now)]);
    assert.equal(mutual.filter((r) => r.status === "fulfilled").length, 1, "A↔B simultaneous invites: one wins");
    // Concurrent duplicate accepts → one room.
    const inv = (wins[0] as PromiseFulfilledResult<{ id: string }>).value;
    const accepts = await Promise.all(Array.from({ length: 5 }, () => acceptInvite(target, inv.id, now)));
    assert.equal(new Set(accepts.map((s) => s.id)).size, 1);
    assert.equal((await getState(target, now)).state, "connecting");
  } finally {
    await db.delete(users).where(inArray(users.id, ids));
  }
});
