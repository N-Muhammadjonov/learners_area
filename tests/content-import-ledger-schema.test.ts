import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import { contentImports, listeningPackages } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";

/**
 * Migration 0040 is hand-written (the snapshot chain ends at 0027), so the
 * drizzle schema and the shipped SQL are two independent descriptions of the
 * same table. This suite pins them to each other, column by column, so a future
 * hand-written migration cannot silently drift from the schema the code uses.
 */

test("IM1 every content_imports column the code uses exists in the migrated database", async () => {
  const database = await createTestDatabase();
  try {
    const rows = await database.query<{ column_name: string; is_nullable: string; data_type: string }>(
      `select column_name, is_nullable, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'content_imports'
        order by column_name`,
    );
    assert.ok(rows.length > 0, "migration 0040 created the ledger table");
    const inDatabase = rows.map((row) => row.column_name).sort();
    const inSchema = Object.values(getTableColumns(contentImports))
      .map((column) => column.name)
      .sort();
    assert.deepEqual(inDatabase, inSchema);

    const notNull = new Set(rows.filter((row) => row.is_nullable === "NO").map((row) => row.column_name));
    for (const required of ["module", "content_type", "schema_version", "import_version", "source_ref", "content_hash", "content_version", "status", "target_type", "legacy_runtime", "created_at"])
      assert.ok(notNull.has(required), `${required} is NOT NULL`);
    for (const optional of ["target_id", "actor_user_id", "original_filename", "assets", "provenance", "result", "note"])
      assert.ok(!notNull.has(optional), `${optional} stays nullable`);
  } finally {
    await database.close();
  }
});

test("IM2 the status enum, the indexes and the actor foreign key match the schema", async () => {
  const database = await createTestDatabase();
  try {
    const values = await database.query<{ enumlabel: string }>(
      `select enumlabel from pg_enum join pg_type on pg_type.oid = pg_enum.enumtypid where pg_type.typname = 'content_import_status' order by enumsortorder`,
    );
    assert.deepEqual(
      values.map((row) => row.enumlabel),
      ["validated", "created", "updated", "unchanged", "rejected", "converted"],
    );
    assert.deepEqual(Object.values(contentImports.status.enumValues), values.map((row) => row.enumlabel));

    const indexes = await database.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'content_imports' order by indexname`,
    );
    assert.deepEqual(
      indexes.map((row) => row.indexname).sort(),
      ["content_imports_created_idx", "content_imports_pkey", "content_imports_source_idx"],
    );

    const [foreignKey] = await database.query<{ delete_rule: string; column_name: string }>(
      `select rc.delete_rule, kcu.column_name
         from information_schema.referential_constraints rc
         join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
        where rc.constraint_name = 'content_imports_actor_user_id_users_id_fk'`,
    );
    assert.equal(foreignKey?.column_name, "actor_user_id");
    assert.equal(foreignKey?.delete_rule, "SET NULL", "deleting a user keeps the import history");
  } finally {
    await database.close();
  }
});

test("IM3 the legacy marker exists, defaults to false, and the shipped backfill flips exactly the runtime rows", async () => {
  const database = await createTestDatabase();
  try {
    const { query } = database;
    const columns = Object.values(getTableColumns(listeningPackages)).map((column) => column.name);
    assert.ok(columns.includes("legacy_runtime"), "the schema describes the marker column");
    const [column] = await query<{ is_nullable: string; column_default: string; data_type: string }>(
      `select is_nullable, column_default, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'listening_packages' and column_name = 'legacy_runtime'`,
    );
    assert.equal(column?.data_type, "boolean");
    assert.equal(column?.is_nullable, "NO");
    assert.match(column?.column_default ?? "", /false/);

    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Marker QA', 'owner') returning id`);
    const common = {
      category: "full",
      provenance: "Marker QA fixture",
      audio: { path: "audio.mp3", durationSec: 600 },
      imagePath: null,
      sections: [{ number: 1, title: "Part 1", transcript: "T", reviewRequired: false }],
      questions: [
        {
          number: 1,
          section: 1,
          text: "Q1 [Q1]",
          instruction: "Write ONE WORD.",
          options: [],
          key: "answer",
          alternatives: [],
          pair: [],
          evidence: { at: 10, why: "the speaker says answer" },
        },
      ],
      keyword1: [],
      keyword2: [],
      vocabulary: [],
    };
    const insert = async (testId: string, extra: Record<string, unknown>, title: string) => {
      const [test] = await query<{ id: string }>(
        `insert into listening_tests (created_by_user_id, title, audio_type, publication_state) values ($1, $2, 'audio', 'draft') returning id`,
        [owner!.id, title],
      );
      await query(
        `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime) values ($1, $2, $3::jsonb, 'audio/a.mp3', $4, false)`,
        [test!.id, testId, JSON.stringify({ schemaVersion: 1, testId, title, ...common, ...extra }), "c".repeat(64)],
      );
      return test!.id;
    };
    const runtime = await insert("marker-legacy", { authoredRuntime: { entryPath: "index.html", files: { "index.html": "<html></html>" } } }, "Legacy");
    const native = await insert("marker-native", {}, "Native");

    // The exact statement 0040 ships, applied to rows written before it.
    await query(
      `update listening_packages set legacy_runtime = true where payload -> 'authoredRuntime' is not null and legacy_runtime = false`,
    );
    const [legacyRow] = await query<{ legacy_runtime: boolean }>(`select legacy_runtime from listening_packages where test_id = $1`, [runtime]);
    const [nativeRow] = await query<{ legacy_runtime: boolean }>(`select legacy_runtime from listening_packages where test_id = $1`, [native]);
    assert.equal(legacyRow!.legacy_runtime, true, "a runtime payload is backfilled as legacy");
    assert.equal(nativeRow!.legacy_runtime, false, "a canonical payload is never marked legacy");
  } finally {
    await database.close();
  }
});
