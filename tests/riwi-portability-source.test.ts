import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { users, riwiConversations, riwiConversationMessages } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { createPostgresImportDestination, withPostgresExportSource } from "../src/lib/portability/postgres-adapter";
import { exportPortableArchive, importPortableArchive, type ExportSource } from "../src/lib/portability/archive";

const now = new Date("2026-10-09T00:00:00Z");
const DAY = 86_400_000;

test("PostgreSQL export uses bounded cursors and a read-only snapshot and excludes overdue chats and old messages", async () => {
  const database = await createTestDatabase();
  let releases = 0;
  const statements: string[] = [];
  const pool = { async connect() { return {
    async query(text: string, values?: unknown[]) { statements.push(text); return { rows: await database.query(text, values) }; },
    release() { releases++; },
  }; } };
  try {
    const active = randomUUID(); const offline = randomUUID(); const boundary = randomUUID();
    await database.db.insert(users).values([
      { id: active, name: "active export user", lastActiveAt: now },
      { id: offline, name: "offline export user", lastActiveAt: new Date(now.getTime() - 7 * DAY - 1) },
      { id: boundary, name: "day seven user", lastActiveAt: new Date(now.getTime() - 7 * DAY) },
    ]);
    const activeId = randomUUID(); const offlineId = randomUUID(); const expiredId = randomUUID(); const boundaryId = randomUUID();
    await database.db.insert(riwiConversations).values([
      ...[{ id: activeId, userId: active }, { id: offlineId, userId: offline }, { id: boundaryId, userId: boundary }]
        .map((row) => ({ ...row, roleAtCreation: "student" as const, expiresAt: new Date(now.getTime() + DAY) })),
      { id: expiredId, userId: active, roleAtCreation: "student", expiresAt: now },
    ]);
    await database.db.insert(riwiConversationMessages).values([
      ...Array.from({ length: 1250 }, (_, index) => ({ conversationId: activeId, role: "user" as const, content: `recent-${index}`, createdAt: new Date(now.getTime() - 1000 + index) })),
      { conversationId: activeId, role: "user", content: "exact 30 days", createdAt: new Date(now.getTime() - 30 * DAY) },
      { conversationId: activeId, role: "user", content: "OLD_MESSAGE_CANARY", createdAt: new Date(now.getTime() - 30 * DAY - 1) },
      { conversationId: offlineId, role: "user", content: "OFFLINE_CHAT_CANARY", createdAt: now },
      { conversationId: expiredId, role: "user", content: "EXPIRED_CHAT_CANARY", createdAt: now },
      { conversationId: boundaryId, role: "user", content: "day seven survives", createdAt: now },
    ]);
    const files = new Map<string, string>(); let file = "";
    let escaped: ExportSource | undefined;
    let exported: Awaited<ReturnType<typeof exportPortableArchive>> | undefined;
    await withPostgresExportSource(pool, { snapshotAt: now, async *objects() {} }, async (source) => {
      escaped = source;
      await assert.rejects(() => exportPortableArchive({ scope: "full-system", objectMode: "keep-r2", sourceFingerprint: "wrong-time", source, createdAt: new Date(now.getTime() + 1),
        sink: { async beginFile() { throw new Error("must_not_start"); }, async write() {}, async endFile() {} },
      }), /portable_snapshot_time_mismatch/);
      for (const scope of ["riwi", "learners-area"] as const) {
        await assert.rejects(() => exportPortableArchive({ scope, objectMode: "keep-r2", sourceFingerprint: "wrong-mode", source,
          sink: { async beginFile() { throw new Error("must_not_start"); }, async write() {}, async endFile() {} },
        }), /portable_source_scope_mismatch/);
      }
      assert.deepEqual(new Set(await source.activeConversationIds!([activeId, offlineId, expiredId, boundaryId], now)), new Set([activeId, boundaryId]));
      await assert.rejects(() => source.activeConversationIds!([activeId], new Date(now.getTime() + 1)), /portable_snapshot_time_mismatch/);
      const manifest = await exportPortableArchive({ scope: "full-system", objectMode: "keep-r2", sourceFingerprint: "isolated-source", source, batchSize: 10,
        sink: { async beginFile(path) { file = path; files.set(file, ""); }, async write(chunk) { files.set(file, files.get(file)! + chunk); }, async endFile() {} },
      });
      exported = manifest;
      assert.equal(manifest.createdAt, now.toISOString());
      assert.equal(manifest.tables.find((table) => table.table === "riwi_conversation_messages")!.rowCount, 1252);
      assert.equal(manifest.tables.find((table) => table.table === "riwi_conversations")!.rowCount, 2);
    });
    assert.doesNotMatch([...files.values()].join(""), /OLD_MESSAGE_CANARY|OFFLINE_CHAT_CANARY|EXPIRED_CHAT_CANARY/);
    assert.match(files.get("tables/riwi_conversations.jsonl")!, /"userId"/);
    assert.doesNotMatch(files.get("tables/riwi_conversations.jsonl")!, /"user_id"/);
    assert.equal(statements[0], "begin isolation level repeatable read read only");
    assert.equal(statements.at(-1), "commit");
    assert.ok(statements.filter((statement) => statement.startsWith("fetch")).every((statement) => statement.startsWith("fetch forward 10")));
    assert.equal(releases, 1);
    const destinationDb = await createTestDatabase();
    try {
      const destination = createPostgresImportDestination({ async connect() { return {
        async query(text: string, values?: unknown[]) { return { rows: await destinationDb.query(text, values) }; },
      }; } });
      const archive = { async *readRows(path: string) { for (const line of (files.get(path) ?? "").split("\n")) if (line) yield line; }, async readObject() { return new Uint8Array(); } };
      const applied = await importPortableArchive({ manifest: exported!, archive, destination, dryRun: false });
      assert.equal(applied.conflicts.length, 0);
      assert.equal((await destinationDb.db.select().from(riwiConversations)).length, 2);
      assert.equal((await destinationDb.db.select().from(riwiConversationMessages)).length, 1252);
    } finally { await destinationDb.close(); }
    await assert.rejects(() => escaped!.activeConversationIds!([activeId], now), /portable_snapshot_closed/);
  } finally { await database.close(); }
});

test("export sink failure rolls back and releases the snapshot without replacing the original error", async () => {
  const database = await createTestDatabase();
  const statements: string[] = []; let released = false;
  try {
    const pool = { async connect() { return {
      async query(text: string, values?: unknown[]) { statements.push(text); return { rows: await database.query(text, values) }; },
      release() { released = true; },
    }; } };
    await assert.rejects(() => withPostgresExportSource(pool, { snapshotAt: now, async *objects() {} }, async (source) => {
      for await (const _batch of source.rows("users", 0)) { /* invalid batch must reject before a cursor opens */ }
    }), /portable_batch_size_invalid/);
    assert.equal(statements.at(-1), "rollback");
    assert.equal(released, true);
    await database.db.insert(users).values({ name: "unchanged source" });
    await assert.rejects(() => withPostgresExportSource(pool, { snapshotAt: now, async *objects() {} }, async (source) => {
      for await (const _batch of source.rows("users", 1)) throw new Error("sink_failed");
    }), /sink_failed/);
    assert.equal(statements.at(-1), "rollback");
    assert.equal((await database.db.select().from(users)).length, 1);
    const escapedIterator = await withPostgresExportSource(pool, { snapshotAt: now, async *objects() {} }, async (source) => {
      const iterator = source.rows("users", 1)[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).done, false);
      return iterator;
    });
    const countAtCommit = statements.length;
    await assert.rejects(() => escapedIterator.next(), /portable_snapshot_closed/);
    assert.equal(statements.length, countAtCommit, "a released connection is never queried by an escaped cursor");
  } finally { await database.close(); }
});


test("an import rollback error cannot hide the original failure or leak the connection", async () => {
  const original = new Error("original_import_failure");
  let releases = 0;
  const statements: string[] = [];
  const destination = createPostgresImportDestination({ async connect() { return {
    async query(text: string) {
      statements.push(text);
      if (text === "rollback") throw new Error("rollback_connection_failed");
      return { rows: [] };
    },
    release() { releases++; },
  }; } });
  await assert.rejects(() => destination.transaction(async () => { throw original; }), (error) => error === original);
  assert.deepEqual(statements, ["begin", "rollback"]);
  assert.equal(releases, 1);
});


test("the full-system destination rejects unsupported identity reconciliation before executing row queries", async () => {
  const statements: string[] = [];
  const destination = createPostgresImportDestination({ async connect() { return {
    async query(text: string) { statements.push(text); return { rows: [] }; },
  }; } });
  await destination.transaction(async (tx) => {
    const id = randomUUID(); const map = new Map([[id, randomUUID()]]);
    await assert.rejects(() => tx.planRow("users", { id }, map), /portable_identity_map_unsupported/);
    await assert.rejects(() => tx.applyRow("users", { id }, map), /portable_identity_map_unsupported/);
  });
  assert.deepEqual(statements, ["begin", "commit"]);
});
