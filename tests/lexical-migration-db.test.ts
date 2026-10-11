import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * The QA2 database is shared by every gated file, so one file’s leftovers change what the next one
 * observes; this is what makes two consecutive runs against the same database meaningful.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("lexical-migration-db");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("lexical-migration-db", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const enabled = process.env.QA2_DATABASE_TESTS === "1";
test("0020 upgrades populated 0019 without rewriting rows; full migration chain also works from empty", { skip: !enabled }, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/learners_qa2', 'isolated QA only');
  const base = new URL(target); base.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  const names: string[] = [];
  const temporary = await mkdtemp(join(tmpdir(), 'qa2-migration-'));
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string }[] };
  try {
    await mkdir(join(temporary, 'meta'));
    const preceding = journal.entries.filter((entry) => entry.idx < 20);
    await writeFile(join(temporary, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: preceding }));
    for (const entry of preceding) await copyFile(`drizzle/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    for (const mode of ['upgrade', 'fresh']) {
      const name = `learners_qa2_migration_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`create database "${name}"`); names.push(name);
      const url = new URL(target); url.pathname = `/${name}`;
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        const db = drizzle(client);
        const userId = randomUUID(), lexemeId = randomUUID(), entryId = randomUUID();
        if (mode === 'upgrade') {
          await migrate(db, { migrationsFolder: temporary });
          await client.query("insert into users(id,name) values($1,'QA2 migration')", [userId]);
          await client.query("insert into lexemes(id,term,definition_en,sense_key) values($1,'bank','river edge','unchanged-legacy-key')", [lexemeId]);
          await client.query("insert into user_vocabulary(id,user_id,lexeme_id,sense_key,srs_stage,correct_count) values($1,$2,$3,'unchanged-legacy-key',3,7)", [entryId, userId, lexemeId]);
          assert.equal((await client.query("select confdeltype from pg_constraint where conname='user_vocabulary_lexeme_id_lexemes_id_fk'")).rows[0].confdeltype, 'c');
        }
        await migrate(db, { migrationsFolder: 'drizzle' });
        assert.equal((await client.query("select confdeltype from pg_constraint where conname='user_vocabulary_lexeme_id_lexemes_id_fk'")).rows[0].confdeltype, 'r');
        assert.equal((await client.query("select is_nullable from information_schema.columns where table_name='user_vocabulary' and column_name='source_snapshot'")).rows[0].is_nullable, 'YES');
        if (mode === 'upgrade') {
          const row = (await client.query('select * from user_vocabulary where id=$1', [entryId])).rows[0];
          assert.equal(row.lexeme_id, lexemeId); assert.equal(row.sense_key, 'unchanged-legacy-key');
          assert.equal(row.srs_stage, 3); assert.equal(row.correct_count, 7); assert.equal(row.source_snapshot, null);
          await assert.rejects(client.query('delete from lexemes where id=$1', [lexemeId]), (error: unknown) => (error as { constraint: string }).constraint === 'user_vocabulary_lexeme_id_lexemes_id_fk');
        } else assert.equal((await client.query('select count(*)::int as n from users')).rows[0].n, 0);
        await migrate(db, { migrationsFolder: 'drizzle' }); // repeated application is a no-op
      } finally { await client.end(); }
    }
  } finally {
    for (const name of names) await admin.query(`drop database "${name}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
});
