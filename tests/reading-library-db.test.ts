import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, readingPassages, readingQuestions, readingAttempts } from "../src/db/schema";
import { listLibrary, readingHubCounts } from "../src/lib/data/reading-library";

test("reading cards count their own questions; live search and clear preserve order", {
  skip: process.env.QA2_DATABASE_TESTS !== "1" && "requires isolated QA database",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  const uid = randomUUID();
  const ids = [randomUUID(), randomUUID()];
  const marker = `QA2-${randomUUID()}`;
  await db.insert(users).values({ id: uid, name: "Reading QA fixture" });
  try {
    await db.insert(readingPassages).values(ids.map((id, n) => ({ id, title: `${marker}-${n}`, bodyText: "QA fixture", publicationState: "published" as const })));
    await db.insert(readingQuestions).values([0, 1, 2].map((n) => ({ passageId: ids[n === 2 ? 1 : 0]!, order: n, type: "short_answer" as const, questionText: "Fixture", correctAnswer: "x", explanation: "QA fixture" })));
    await db.insert(readingAttempts).values([
      { userId: uid, passageId: ids[0]!, status: "completed" },
      { userId: uid, passageId: ids[1]!, status: "in_progress" },
    ]);
    const hub = await readingHubCounts(uid);
    assert.equal(hub.completed, 1, "hub counts correlate to the passage, not the attempt id");
    assert.equal(hub.inProgress, 1);
    const original = await listLibrary(uid, { query: marker });
    assert.deepEqual(original.items.map((row) => row.questionCount), [2, 1]);
    const filtered = await listLibrary(uid, { query: `${marker}-1` });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0]?.id, ids[1]);
    const restored = await listLibrary(uid, { query: marker });
    assert.deepEqual(restored.items.map((row) => row.id), original.items.map((row) => row.id));
    assert.equal((await listLibrary(uid, { query: `${marker}%` })).total, 0, "SQL wildcards are literal user text");
  } finally {
    await db.delete(readingAttempts).where(eq(readingAttempts.userId, uid));
    await db.delete(readingPassages).where(inArray(readingPassages.id, ids));
    await db.delete(users).where(eq(users.id, uid));
  }
});
