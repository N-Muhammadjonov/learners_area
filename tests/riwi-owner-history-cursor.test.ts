import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  decodeOwnerHistoryCursor,
  encodeOwnerHistoryCursor,
  ownerHistoryPageLimit,
  RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH,
  RIWI_OWNER_HISTORY_MAX_PAGE_SIZE,
  RIWI_OWNER_HISTORY_PAGE_SIZE,
  RiwiOwnerHistoryCursorError,
} from "../src/lib/services/riwi/owner-history-cursor";
import { installOwnerHistoryCursorTestSecret } from "./support/riwi-history-cursor";

test.after(installOwnerHistoryCursorTestSecret());

const actor = { id: randomUUID(), role: "owner" };
const scopeId = randomUUID();
const after = { sortAt: new Date("2026-10-05T09:30:00.000Z"), id: randomUUID() };

test("owner history cursors are signed, canonical, and bound to actor, collection, and resource scope", () => {
  const cursor = encodeOwnerHistoryCursor({ actor, collection: "learning_reviews", scopeId, after });
  assert.deepEqual(decodeOwnerHistoryCursor(cursor, actor, "learning_reviews", scopeId), after);
  assert.throws(() => decodeOwnerHistoryCursor(cursor, { id: randomUUID(), role: "owner" }, "learning_reviews", scopeId), RiwiOwnerHistoryCursorError);
  assert.throws(() => decodeOwnerHistoryCursor(cursor, { ...actor, role: "student" }, "learning_reviews", scopeId), RiwiOwnerHistoryCursorError);
  assert.throws(() => decodeOwnerHistoryCursor(cursor, actor, "learning_signals"), RiwiOwnerHistoryCursorError);
  assert.throws(() => decodeOwnerHistoryCursor(cursor, actor, "learning_reviews", randomUUID()), RiwiOwnerHistoryCursorError);
  assert.throws(() => decodeOwnerHistoryCursor(cursor, actor, "learning_reviews"), RiwiOwnerHistoryCursorError,
    "a scoped cursor cannot be replayed without its signal id");
  const filteredCursor = encodeOwnerHistoryCursor({ actor, collection: "learning_signals", filter: "state:candidate", after });
  assert.deepEqual(decodeOwnerHistoryCursor(filteredCursor, actor, "learning_signals", undefined, "state:candidate"), after);
  assert.throws(() => decodeOwnerHistoryCursor(filteredCursor, actor, "learning_signals", undefined, "state:accepted"), RiwiOwnerHistoryCursorError);
  assert.throws(() => decodeOwnerHistoryCursor(filteredCursor, actor, "learning_signals"), RiwiOwnerHistoryCursorError,
    "a filtered cursor cannot be replayed without its original filter");

  const [payload, signature] = cursor.split(".");
  const tamperedPayload = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
  const position = tamperedPayload.after as { sortAt: string; id: string };
  position.id = randomUUID();
  const forgedPosition = `${Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url")}.${signature}`;
  assert.throws(() => decodeOwnerHistoryCursor(forgedPosition, actor, "learning_reviews", scopeId), RiwiOwnerHistoryCursorError,
    "a syntactically valid edit to the navigation position fails the HMAC check");
  const forgedSignature = `${payload}.${signature![0] === "A" ? "B" : "A"}${signature!.slice(1)}`;
  assert.throws(() => decodeOwnerHistoryCursor(forgedSignature, actor, "learning_reviews", scopeId), RiwiOwnerHistoryCursorError);
});

test("owner history cursor parser rejects malformed tokens and enforces the exact page bounds", () => {
  const cursor = encodeOwnerHistoryCursor({ actor, collection: "knowledge_sources", after });
  for (const malformed of ["not-a-cursor", "..", "a.b.c", `${cursor}=`, "!".repeat(12)]) {
    assert.throws(() => decodeOwnerHistoryCursor(malformed, actor, "knowledge_sources"), RiwiOwnerHistoryCursorError);
  }
  assert.throws(() => decodeOwnerHistoryCursor("x".repeat(RIWI_OWNER_HISTORY_CURSOR_MAX_LENGTH + 1), actor, "knowledge_sources"), RiwiOwnerHistoryCursorError);
  assert.throws(() => encodeOwnerHistoryCursor({ actor: { id: "not-a-uuid", role: "owner" }, collection: "knowledge_sources", after }), RiwiOwnerHistoryCursorError);

  assert.equal(ownerHistoryPageLimit(undefined), RIWI_OWNER_HISTORY_PAGE_SIZE);
  assert.equal(ownerHistoryPageLimit(1), 1);
  assert.equal(ownerHistoryPageLimit(RIWI_OWNER_HISTORY_MAX_PAGE_SIZE), RIWI_OWNER_HISTORY_MAX_PAGE_SIZE);
  for (const invalid of [0, -1, 1.5, RIWI_OWNER_HISTORY_MAX_PAGE_SIZE + 1, Number.NaN]) {
    assert.throws(() => ownerHistoryPageLimit(invalid), RiwiOwnerHistoryCursorError);
  }
});
