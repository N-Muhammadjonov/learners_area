import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema";
import type { db as appDatabase } from "../../src/db/client";

/**
 * A real PostgreSQL for tests, inside the test process.
 *
 * The Retention data layer cannot be honestly tested with stubs: its guarantees
 * are transactions, advisory locks, a partial unique index, foreign keys and
 * aggregate queries. PGlite is PostgreSQL compiled to WebAssembly, so those are
 * the real thing — the same migration files the deployment runs are applied, in
 * order, to an empty server.
 *
 * It is not a deployment: it is one local in-process server with no network, so
 * there is no DATABASE_URL to misdirect and Production cannot be reached.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type TestDatabase = {
  /** The same type the application's data layer accepts, so tests exercise it directly. */
  db: typeof appDatabase;
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
};

/** Apply every shipped migration, in filename order, exactly as drizzle-kit does. */
export async function migrateTestDatabase(client: PGlite): Promise<void> {
  const files = readdirSync(join(ROOT, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(ROOT, "drizzle", file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await client.exec(statement);
    }
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  await migrateTestDatabase(client);
  const database = drizzle(client, { schema });
  return {
    db: database as unknown as typeof appDatabase,
    query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      (await client.query<T>(sql, params)).rows,
    close: () => client.close(),
  };
}

/** A body of exactly `count` words, for the level word-count contract. */
export function bodyOfWords(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index % 7}`).join(" ");
}

/** A minimal, valid Measurement Structure worth exactly 100 points. */
export function simpleStructure(marker: string) {
  return {
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "main",
        label: `The QA fixture fact (${marker}).`,
        points: 100,
        scope: "sentence",
        groups: [
          { id: "subject", points: 40, kind: "concept", anyOf: ["company", "business"] },
          { id: "date", points: 60, kind: "date", anyOf: ["1998"], critical: true },
        ],
        rejectPhrases: ["the company closed"],
      },
    ],
  };
}
