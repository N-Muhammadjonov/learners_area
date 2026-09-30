#!/usr/bin/env node
/** READ ONLY. Run with the affected Preview environment, never print its URL.
 * node --env-file=.env.preview scripts/inspect-runtime-schema.mjs
 * Exit 0 = expected shape present; 1 = missing objects; 2 = connection failure.
 * This is diagnosis, not migration, seeding, or permission to change Production.
 */
import pg from "pg";
const required = {
  users: ["id", "role", "account_status"],
  lessons: ["id", "title"],
  video_lessons: ["id", "lesson_id", "provider", "video_id", "notes", "publication_state", "publish_at"],
  video_lesson_questions: ["id", "video_lesson_id"],
  video_lesson_progress: ["id", "video_lesson_id", "user_id"],
  retention_texts: ["id", "level", "current_version_id", "active"],
  retention_text_versions: ["id", "retention_text_id", "scoring_structure"],
  retention_attempts: ["id", "user_id", "status", "score", "completed_at", "created_at"],
  retention_rotation_state: ["id", "user_id", "level", "cycle_number"],
  retention_rotation_completions: ["id", "user_id", "level", "cycle_number"],
};
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is unset; nothing was contacted."); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000, query_timeout: 8000 });
pool.on("error", () => console.error("Database idle connection failed."));
try {
  const { rows } = await pool.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])",
    [Object.keys(required)],
  );
  let missing = 0;
  for (const [table, columns] of Object.entries(required)) {
    const present = new Set(rows.filter((row) => row.table_name === table).map((row) => row.column_name));
    const absent = columns.filter((column) => !present.has(column));
    if (absent.length) { missing += 1; console.log(`MISSING ${table}: ${absent.join(", ")}`); }
    else console.log(`OK ${table}`);
  }
  if (missing) {
    console.log("Inspect drizzle/0022_retention_bank.sql and drizzle/0023_video_lesson_notes.sql and the migration journal. Do not use db:push or reset the database.");
    process.exitCode = 1;
  } else {
    const { rows: bank } = await pool.query("select level, count(*)::int as active from retention_texts where active = true and current_version_id is not null group by level order by level");
    for (const row of bank) console.log(`BANK ${row.level}: ${row.active} active texts`);
    if (!bank.length) console.log("BANK empty: author valid owned/licensed texts in Management; no fake attempts or scores.");
  }
} catch (error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : "unknown";
  console.error(`Connection/query failed; code=${code}. Check the affected environment and server logs. No credentials or query data logged.`);
  process.exitCode = 2;
} finally { await pool.end(); }
