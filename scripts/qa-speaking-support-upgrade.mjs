import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

// A disposable native localhost database, never DATABASE_URL or a remote target.
const target = `learners_qa2_upgrade_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: 'postgres://postgres@localhost:5432/postgres', connectionTimeoutMillis: 5000 });
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
await admin.connect();
let created = false;
try {
  await admin.query(`create database ${target}`); created = true;
  const client = new pg.Client({ connectionString: `postgres://postgres@localhost:5432/${target}`, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    for (const entry of journal.filter(entry => entry.idx <= 35)) {
      for (const statement of readFileSync(`drizzle/${entry.tag}.sql`, 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await client.query(statement);
    }
    const [owner, prompt, folder, test, occurrence] = Array.from({ length: 5 }, () => randomUUID());
    const oldName = 'A'.repeat(80);
    await client.query("insert into users(id,name,role,account_status) values($1,'Isolated upgrade QA','owner','active')", [owner]);
    await client.query("insert into speaking_prompts(id,part,category,prompt_text) values($1,'part1','part1','What do you do?')", [prompt]);
    await client.query('insert into vocab_folders(id,user_id,name) values($1,$2,$3)', [folder, owner, oldName]);
    await client.query("insert into listening_tests(id,created_by_user_id,title,audio_type) values($1,$2,'Isolated QA','audio')", [test, owner]);
    await client.query("insert into lexical_occurrences(id,listening_test_id,section_number,source_type,segment_key,start_char,end_char,surface_form,sentence_text,resolution_status) values($1,$2,1,'listening','s1',0,4,'bank','bank','unresolved')", [occurrence, test]);
    const sql = readFileSync('drizzle/0036_speaking_study_support.sql', 'utf8');
    await client.query('begin');
    for (const statement of sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await client.query(statement);
    await client.query('commit');
    const preserved = (await client.query('select prompt_text,study_support from speaking_prompts where id=$1', [prompt])).rows[0];
    assert.equal(preserved.prompt_text, 'What do you do?');
    assert.deepEqual(preserved.study_support, { vocabularyHtml: '', modelAnswerHtml: '', ideasHtml: '', vocabulary: [] });
    assert.equal((await client.query('select name from vocab_folders where id=$1', [folder])).rows[0].name, oldName);
    await client.query('update vocab_folders set name=$1 where id=$2', ['Q'.repeat(200), folder]);
    await client.query("insert into lexical_occurrences(listening_test_id,section_number,source_type,segment_key,start_char,end_char,surface_form,sentence_text,resolution_status) values($1,1,'listening','q1:text',0,4,'bank','bank','unresolved')", [test]);
    assert.equal((await client.query('select count(*)::int n from lexical_occurrences where listening_test_id=$1', [test])).rows[0].n, 2);
    await assert.rejects(client.query("insert into lexical_occurrences(listening_test_id,section_number,source_type,segment_key,start_char,end_char,surface_form,sentence_text,resolution_status) values($1,1,'listening','q1:text',0,4,'bank','bank','unresolved')", [test]), error => error.code === '23505');
    assert.equal((await client.query('select segment_key from lexical_occurrences where id=$1', [occurrence])).rows[0].segment_key, 's1');
    console.log(JSON.stringify({ pass: true, engine: (await client.query('show server_version')).rows[0].server_version, through: 35, migration: 36, migrationSha256: createHash('sha256').update(sql).digest('hex'), existingDataPreserved: true, folder200: true, separateSegmentOffsets: true, duplicateOffsetsRejected: true, remoteDatabaseUsed: false }));
  } finally { await client.end(); }
} finally {
  if (created) await admin.query(`drop database ${target} with (force)`);
  await admin.end();
}
