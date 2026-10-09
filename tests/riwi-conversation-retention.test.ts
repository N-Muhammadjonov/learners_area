import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { users, riwiConversations, riwiConversationMessages } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { recordRiwiOnlineActivity, runRiwiConversationRetention } from "../src/lib/services/riwi/conversation-retention";
import { appendRiwiTurn, getRiwiConversationTranscript, getRiwiConversationHistory } from "../src/lib/services/riwi/conversations";

const DAY = 86_400_000;
const now = new Date("2026-10-08T12:00:00Z");

test("offline sweep previews without mutation, preserves day 7, deletes on day 8 for every user role, and cascades messages", async () => {
  const database = await createTestDatabase();
  try {
    const roles = ["student", "teacher", "admin", "owner"] as const;
    const stale = roles.map(() => randomUUID());
    const boundary = randomUUID();
    const active = randomUUID();
    await database.db.insert(users).values([
      ...stale.map((id, index) => ({ id, name: `offline ${index}`, role: roles[index]!, lastActiveAt: new Date(now.getTime() - 7 * DAY - 1), lastMeaningfulActivityAt: now })),
      { id: boundary, name: "exactly seven days", lastActiveAt: new Date(now.getTime() - 7 * DAY) },
      { id: active, name: "active without learning", lastActiveAt: now, lastMeaningfulActivityAt: new Date(now.getTime() - 100 * DAY) },
    ]);
    const conversations = [...stale, boundary, active].map((userId, index) => ({ id: randomUUID(), userId, roleAtCreation: roles[index] ?? "student" as const, expiresAt: new Date(now.getTime() + DAY) }));
    await database.db.insert(riwiConversations).values(conversations);
    await database.db.insert(riwiConversationMessages).values(conversations.map((c) => ({ conversationId: c.id, role: "user" as const, content: "recent message", createdAt: now })));
    const preview = await runRiwiConversationRetention({ now }, database.db);
    assert.equal("offlineChats" in preview && preview.offlineChats, 4);
    assert.equal((await database.db.select().from(riwiConversations)).length, 6);
    const applied = await runRiwiConversationRetention({ now, dryRun: false }, database.db);
    assert.equal("offlineChats" in applied && applied.offlineChats, 4);
    assert.equal((await database.db.select().from(riwiConversations)).length, 2);
    assert.equal((await database.db.select().from(riwiConversationMessages)).length, 2);
    assert.equal((await database.db.select().from(users)).length, 6, "only chats are deleted, never accounts");
    const again = await runRiwiConversationRetention({ now, dryRun: false }, database.db);
    assert.equal("offlineChats" in again && again.offlineChats, 0);
  } finally { await database.close(); }
});

test("returning online deletes overdue chats before refreshing activity and cannot resurrect them", async () => {
  const database = await createTestDatabase();
  try {
    const userId = randomUUID();
    const id = randomUUID();
    await database.db.insert(users).values({ id: userId, name: "returning user", lastActiveAt: new Date(now.getTime() - 8 * DAY) });
    await database.db.insert(riwiConversations).values({ id, userId, roleAtCreation: "student", expiresAt: new Date(now.getTime() + DAY) });
    await database.db.insert(riwiConversationMessages).values({ conversationId: id, role: "user", content: "overdue private chat", createdAt: new Date(now.getTime() - DAY) });
    await recordRiwiOnlineActivity(userId, now, database.db);
    assert.equal((await database.db.select().from(riwiConversations)).length, 0);
    assert.equal((await database.db.select().from(riwiConversationMessages)).length, 0);
    const [user] = await database.db.select().from(users).where(eq(users.id, userId));
    assert.equal(user!.lastActiveAt.toISOString(), now.toISOString());
    assert.equal(user!.lastMeaningfulActivityAt, null, "online presence is not learning activity");
    await recordRiwiOnlineActivity(userId, new Date(now.getTime() + 30_000), database.db);
    const [same] = await database.db.select().from(users).where(eq(users.id, userId));
    assert.equal(same!.lastActiveAt.toISOString(), now.toISOString(), "online timestamps are throttled");
  } finally { await database.close(); }
});

test("rolling 30-day window excludes old messages before sweep, retains boundary and every recent message, and keeps provider context bounded", async () => {
  const database = await createTestDatabase();
  try {
    const userId = randomUUID(); const id = randomUUID();
    const actor = { id: userId, role: "student" as const };
    await database.db.insert(users).values({ id: userId, name: "recent user", lastActiveAt: now });
    await database.db.insert(riwiConversations).values({ id, userId, roleAtCreation: "student", expiresAt: new Date(now.getTime() + DAY) });
    await database.db.insert(riwiConversationMessages).values([
      { conversationId: id, role: "user", content: "too old", createdAt: new Date(now.getTime() - 30 * DAY - 1) },
      { conversationId: id, role: "user", content: "at boundary", createdAt: new Date(now.getTime() - 30 * DAY) },
      ...Array.from({ length: 100 }, (_, index) => ({ conversationId: id, role: "user" as const, content: `recent ${index}`, createdAt: new Date(now.getTime() - 1000 + index), metadata: { externalEligible: true } })),
    ]);
    const transcript = await getRiwiConversationTranscript({ actor, conversationId: id, now }, database.db);
    assert.equal(transcript.length, 101);
    assert.equal(transcript[0]!.content, "at boundary");
    assert.equal((await getRiwiConversationHistory({ actor, conversationId: id, now }, database.db)).length, 6);
    await appendRiwiTurn({ actor, conversationId: id, userMessage: "new question", assistantMessage: "new answer", now,
      metadata: { correlationId: randomUUID(), intent: "educational_explanation", fallbackUsed: false, externalEligible: true, provenance: "external_provider", citations: [] } }, database.db);
    const stored = await database.db.select().from(riwiConversationMessages);
    assert.equal(stored.length, 103);
    assert.ok(stored.every((row) => row.content !== "too old"));
    // Append handles only its own conversation; scheduled cleanup handles all others.
    await database.db.insert(riwiConversationMessages).values({ conversationId: id, role: "user", content: "old imported row", createdAt: new Date(now.getTime() - 31 * DAY) });
    const sweep = await runRiwiConversationRetention({ now, dryRun: false }, database.db);
    assert.equal("oldMessages" in sweep && sweep.oldMessages, 1);
    assert.equal((await database.db.select().from(riwiConversationMessages)).length, 103);
  } finally { await database.close(); }
});

test("rollout migration initializes previously untracked online clocks without deleting chat or academic data", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { migrateTestDatabase } = await import("./support/pglite");
  const client = new PGlite();
  try {
    await migrateTestDatabase(client, { through: "0048_condemned_pyro.sql" });
    const userId = randomUUID(); const conversationId = randomUUID();
    await client.query("insert into users (id, name, last_active_at) values ($1, 'upgrade user', '2020-01-01')", [userId]);
    await client.query("insert into riwi_conversations (id, user_id, role_at_creation, expires_at) values ($1, $2, 'student', now() + interval '30 days')", [conversationId, userId]);
    await client.query("insert into riwi_conversation_messages (conversation_id, role, content) values ($1, 'user', 'keep during rollout')", [conversationId]);
    const before = Date.now();
    await migrateTestDatabase(client, { after: "0048_condemned_pyro.sql" });
    const result = await client.query<{ last_active_at: Date }>("select last_active_at from users where id = $1", [userId]);
    assert.ok(new Date(result.rows[0]!.last_active_at).getTime() >= before - 1000);
    assert.equal((await client.query("select * from riwi_conversation_messages")).rows.length, 1);
    assert.equal((await client.query("select * from pg_indexes where indexname = 'users_online_activity_idx'")).rows.length, 1);
  } finally { await client.close(); }
});


test("0049 retention migration cannot be skipped because of an earlier journal timestamp", () => {
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const current = journal.entries.find((entry) => entry.tag === "0049_riwi_online_activity_baseline")!;
  assert.ok(current);
  assert.ok(journal.entries.filter((entry) => entry.idx < current.idx).every((entry) => entry.when < current.when));
});
