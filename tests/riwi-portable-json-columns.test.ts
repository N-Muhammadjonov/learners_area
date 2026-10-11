import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPortableTestDatabase, nativePortableTestsEnabled } from "./support/riwi-portability-database";
import { createPostgresImportDestination } from "../src/lib/portability/postgres-adapter";

// Regression: node-postgres serializes JS arrays as Postgres array literals, which json/jsonb columns reject.
// Original Speaking880 rows carry jsonb arrays (available_in, follow_ups), so applying them must send JSON text.
for (const kind of ["pglite", "native"] as const) {
  test(kind + ": jsonb array and object columns are applied as JSON, not as Postgres array literals", { skip: kind === "native" && !nativePortableTestsEnabled ? "requires an identified private native PostgreSQL cluster" : false }, async () => {
    const database = await createPortableTestDatabase(kind);
    try {
      const pool = database.pool ?? { async connect() { return { async query(sql: string, params?: unknown[]) { return { rows: await database.query(sql, params) }; } }; } };
      const id = randomUUID();
      const row = { id, part: "part3", category: "part3", promptText: "Why?", prepSeconds: 5, answerSeconds: 40, followUps: ["a", "b"], availableIn: ["practice_alone", "mock"], externalId: "P3-001-2" };
      await createPostgresImportDestination(pool).transaction(async tx => {
        assert.equal(await tx.planRow("speaking_prompts", row, new Map()), "create");
        await tx.applyRow("speaking_prompts", row, new Map());
      });
      const [saved] = await database.query<{ available_in: string[]; follow_ups: string[] }>("select available_in,follow_ups from speaking_prompts where id=$1", [id]);
      assert.deepEqual(saved!.available_in, ["practice_alone", "mock"]);
      assert.deepEqual(saved!.follow_ups, ["a", "b"]);
    } finally { await database.close(); }
  });
}
