import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, uuid, timestamp, jsonb, text, numeric } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { FrontendReadClient } from "../src/lib/backend/read-client";

test("actual PostgreSQL/Python wire values retain the existing typed view result", async () => {
  const wire = JSON.parse(readFileSync("services/backend/contracts/read-wire-fixture.json", "utf8"));
  const values = pgTable("wire_values", {
    id: uuid("id"), at: timestamp("at", { withTimezone: true }), payload: jsonb("payload"),
    tags: text("tags").array(), number: numeric("number"),
  });
  const transport = new FrontendReadClient(async () => wire);
  const db = drizzle(transport as unknown as Pool);
  const [row] = await db.select().from(values);
  assert.ok(row);
  assert.equal(row.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(row.at?.toISOString(), "2026-10-24T00:00:00.000Z");
  assert.deepEqual(row.payload, { text: "o‘rganish", nested: [1, null, true] });
  assert.deepEqual(row.tags, ["a,b", null, "NULL"]);
  assert.equal(row.number, "6.50");
});
