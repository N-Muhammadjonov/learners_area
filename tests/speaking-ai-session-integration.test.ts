import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { speakingAttempts, speakingAiSessionItems, speakingPrompts, users } from "../src/db/schema";
import { createSpeakingAiSession, readSpeakingAiSession, completeSpeakingAiItem } from "../src/lib/data/speaking-ai-sessions";
import { createTestDatabase } from "./support/pglite";

test("canonical persisted examiner plans resume unchanged, scope users, and advance atomically with exact replays", async () => {
  const database = await createTestDatabase();
  try {
    const owner = randomUUID(); const foreign = randomUUID();
    await database.db.insert(users).values([{ id: owner, name: "Fixture owner", role: "student" }, { id: foreign, name: "Fixture foreign", role: "student" }]);
    const ids: string[] = [];
    for (const part of ["part1", "part2", "part3"] as const) {
      for (let index = 0; index < (part === "part2" ? 1 : 5); index++) {
        const id = randomUUID(); ids.push(id);
        await database.db.insert(speakingPrompts).values({ id, part, category: "general", topic: "Study", promptText: `${part} canonical fixture ${index}`, sourceClass: "owner_authored_test", publicationState: "published" });
      }
    }
    const excluded = randomUUID();
    await database.db.insert(speakingPrompts).values({ id: excluded, part: "part2", category: "general", topic: "Private", promptText: "Draft must never be selected", publicationState: "draft" });
    const created = await createSpeakingAiSession(database.db, owner, "full", "persisted-seed");
    assert.ok(created); assert.equal(created.items.length, 9);
    assert.ok(created.items.every(item => ids.includes(item.promptId) && item.prompt?.id === item.promptId));
    assert.ok(!created.items.some(item => item.promptId === excluded));
    const initial = created.items.map(item => ({ id: item.id, promptId: item.promptId, ordinal: item.ordinal, topicKey: item.topicKey }));
    const resumed = await readSpeakingAiSession(database.db, owner, created.session.id);
    assert.deepEqual(resumed?.items.map(item => ({ id: item.id, promptId: item.promptId, ordinal: item.ordinal, topicKey: item.topicKey })), initial);
    assert.equal(await readSpeakingAiSession(database.db, foreign, created.session.id), null);
    assert.equal((await readSpeakingAiSession(database.db, owner))?.session.id, created.session.id);
    const first = created.items[0]!; const later = created.items[1]!;
    assert.deepEqual(await completeSpeakingAiItem(database.db, foreign, created.session.id, first.id, { action: "skipped" }), { ok: false, error: "not_found", status: 404 });
    assert.deepEqual(await completeSpeakingAiItem(database.db, owner, created.session.id, later.id, { action: "skipped" }), { ok: false, error: "stale_session_position", status: 409 });
    const [attempt] = await database.db.insert(speakingAttempts).values({ userId: owner, promptId: first.promptId, part: first.part, aiSessionId: created.session.id, aiSessionItemId: first.id }).returning();
    assert.deepEqual(await completeSpeakingAiItem(database.db, owner, created.session.id, first.id, { action: "answered", attemptId: attempt!.id }), { ok: false, error: "invalid_attempt", status: 409 });
    await database.db.update(speakingAttempts).set({ status: "submitted", transcript: "Reviewed answer", transcriptOrigin: "manual" }).where(eq(speakingAttempts.id, attempt!.id));
    const answer = await completeSpeakingAiItem(database.db, owner, created.session.id, first.id, { action: "answered", attemptId: attempt!.id });
    assert.equal(answer.ok, true);
    assert.equal(answer.session.currentItemIndex, 1); assert.equal(answer.item.attemptId, attempt!.id);
    const replay = await completeSpeakingAiItem(database.db, owner, created.session.id, first.id, { action: "answered", attemptId: attempt!.id });
    assert.ok(replay.ok && replay.reused);
    assert.deepEqual(await completeSpeakingAiItem(database.db, owner, created.session.id, first.id, { action: "skipped" }), { ok: false, error: "item_already_completed", status: 409 });
    // A different session/item cannot borrow a submitted answer for this prompt.
    assert.deepEqual(await completeSpeakingAiItem(database.db, owner, created.session.id, later.id, { action: "answered", attemptId: attempt!.id }), { ok: false, error: "invalid_attempt", status: 409 });
    for (const item of created.items.slice(1)) assert.equal((await completeSpeakingAiItem(database.db, owner, created.session.id, item.id, { action: "skipped" })).ok, true);
    const final = created.items.at(-1)!;
    const lastReplay = await completeSpeakingAiItem(database.db, owner, created.session.id, final.id, { action: "skipped" });
    assert.ok(lastReplay.ok && lastReplay.reused); assert.equal(lastReplay.session.status, "completed");
    const savedItems = await database.db.select().from(speakingAiSessionItems).where(eq(speakingAiSessionItems.sessionId, created.session.id));
    assert.equal(savedItems.filter(item => item.status === "answered").length, 1);
    assert.equal(savedItems.filter(item => item.status === "skipped").length, 8);
    assert.equal(await readSpeakingAiSession(database.db, owner), null);
  } finally { await database.close(); }
});

test("an unavailable requested canonical part returns no plan or partial session rows", async () => {
  const database = await createTestDatabase();
  try {
    const id = randomUUID(); await database.db.insert(users).values({ id, name: "Empty bank fixture", role: "student" });
    assert.equal(await createSpeakingAiSession(database.db, id, "part1"), null);
    assert.equal(await readSpeakingAiSession(database.db, id), null);
  } finally { await database.close(); }
});
