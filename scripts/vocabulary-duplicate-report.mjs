#!/usr/bin/env node
/**
 * READ-ONLY report of learners who hold the same canonical sense twice
 * (duplicate user_vocabulary (user_id, lexeme_id) rows). Migration 0029 creates
 * user_vocabulary_user_sense_idx only when there are none; if it warned, run:
 *
 *   DATABASE_URL=… node scripts/vocabulary-duplicate-report.mjs
 *
 * Nothing is merged or deleted: each group needs a human decision because the
 * rows may carry different SRS progress. Ids are printed; no personal data.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(`
    select user_id, lexeme_id, count(*)::int as copies,
           array_agg(id order by created_at) as user_vocabulary_ids
      from user_vocabulary
     where lexeme_id is not null
     group by user_id, lexeme_id
    having count(*) > 1
     order by copies desc`);
  const index = await client.query(`select 1 from pg_indexes where indexname = 'user_vocabulary_user_sense_idx'`);
  console.log(JSON.stringify({ duplicateGroups: rows.length, uniqueIndexPresent: index.rowCount === 1, groups: rows }, null, 2));
} finally {
  await client.end();
}
