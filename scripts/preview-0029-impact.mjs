#!/usr/bin/env node
/**
 * READ-ONLY impact check for migration 0029 on the Preview QA database.
 *
 *   DATABASE_URL=<preview QA url> node scripts/preview-0029-impact.mjs
 *
 * Runs inside `BEGIN TRANSACTION READ ONLY` (the server rejects any write) and
 * ends with ROLLBACK. Prints counts only — never the URL, never row contents.
 * The key expression mirrors the backfill in drizzle/0029_vocabulary_architecture.sql.
 */
import pg from "pg";
import { qaConnectionOptions, refuseProduction } from "./preview-qa-migrate.mjs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
const prod = refuseProduction(url);
if (prod) { console.error(`REFUSED: ${prod}`); process.exit(1); }

const KEYS = `
SELECT btrim(regexp_replace(translate(lower(normalize(l.term, NFKC)), '‘’ʻʼ\`´′', ''''''''''''''''), '\\s+', ' ', 'g')) AS lemma_norm,
  CASE r.raw WHEN 'n' THEN 'noun' WHEN 'v' THEN 'verb' WHEN 'adj' THEN 'adjective' WHEN 'adv' THEN 'adverb' WHEN 'phr' THEN 'phrase'
   WHEN 'prep' THEN 'preposition' WHEN 'n.phrase' THEN 'noun phrase' WHEN 'v.phrase' THEN 'verb phrase'
   ELSE regexp_replace(r.raw, '\\s+', ' ', 'g') END AS pos_norm
FROM lexemes l CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(btrim(lower(normalize(coalesce(l.part_of_speech, ''), NFKC))), '^\\((.*)\\)$', '\\1'), '\\.$', '') AS raw) r`;

const client = new pg.Client(qaConnectionOptions(url));
await client.connect();
const one = async (sql) => (await client.query(sql)).rows[0];
try {
  await client.query("BEGIN TRANSACTION READ ONLY");
  const col = await one(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='lexemes' AND column_name='lexical_unit_id'`);
  const units = await one(`SELECT to_regclass('public.lexical_units') AS t`);
  const lexemes = await one(`SELECT count(*)::int AS n FROM lexemes`);
  const occ = await one(`SELECT count(*)::int AS n FROM lexical_occurrences`);
  const nullUnit = col.n ? await one(`SELECT count(*)::int AS n FROM lexemes WHERE lexical_unit_id IS NULL`) : { n: lexemes.n };
  const distinctKeys = await one(`SELECT count(*)::int AS n FROM (SELECT DISTINCT left(lemma_norm,120), left(pos_norm,30) FROM (${KEYS}) k) d`);
  const emptyLemma = await one(`SELECT count(*)::int AS n FROM (${KEYS}) k WHERE lemma_norm = ''`);
  const dupUV = await one(`SELECT count(*)::int AS groups, coalesce(sum(c - 1),0)::int AS extra FROM (SELECT count(*) AS c FROM user_vocabulary GROUP BY user_id, lexeme_id HAVING count(*) > 1) d`);
  const occNulls = await one(`SELECT count(*) FILTER (WHERE passage_id IS NULL)::int AS p, count(*) FILTER (WHERE lexeme_id IS NULL)::int AS l FROM lexical_occurrences`);
  console.log(JSON.stringify({
    already_has_0029_column: col.n > 0,
    lexical_units_table_exists: Boolean(units.t),
    lexemes_rows_before: lexemes.n,
    lexical_occurrences_rows_before: occ.n,
    lexemes_with_null_lexical_unit_id: nullUnit.n,
    expected_lexemes_updated: nullUnit.n,
    expected_lexical_units_inserted_upper_bound: distinctKeys.n,
    lexemes_with_empty_normalized_term: emptyLemma.n,
    user_vocabulary_duplicate_groups: dupUV.groups,
    user_vocabulary_duplicate_extra_rows: dupUV.extra,
    user_vocabulary_unique_index_would_be_created: dupUV.groups === 0,
    lexical_occurrences_null_passage_or_lexeme_now: occNulls,
  }, null, 2));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
