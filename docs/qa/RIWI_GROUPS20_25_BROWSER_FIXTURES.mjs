/** Fresh identified private browser-QA cluster only. Never use an existing target. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
const [configFile, readyFile] = process.argv.slice(2);
assert.ok(configFile && readyFile);
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
assert.equal(config.host, '127.0.0.1');
assert.match(config.data_dir, /^\/tmp\/riwi-final-browser-[^/]+\/data$/);
assert.ok(Number.isSafeInteger(config.port) && config.port > 0);
assert.equal(new URL(ready.base).hostname, '127.0.0.1');
assert.deepEqual(ready.people.map(p => p.role), ['student', 'teacher', 'admin', 'owner']);
const admin = new pg.Client({ ...config, database: 'postgres' });
let client;
try {
  await admin.connect();
  const identity = (await admin.query("select current_setting('data_directory') as data_dir,current_setting('server_version_num')::int as version")).rows[0];
  assert.equal(await fs.realpath(identity.data_dir), await fs.realpath(config.data_dir));
  assert.ok(identity.version >= 150000);
  const dbs = (await admin.query("select datname from pg_database where datname like 'riwi_multi_owner_%'")).rows;
  assert.equal(dbs.length, 1);
  assert.match(dbs[0].datname, /^riwi_multi_owner_[a-f0-9]{32}$/);
  client = new pg.Client({ ...config, database: dbs[0].datname });
  await client.connect();
  const actors = (await client.query('select email,role from users where email = any($1::text[])', [ready.people.map(p => p.email)])).rows;
  assert.equal(actors.length, 4);
  for (const p of ready.people) assert.ok(actors.some(a => a.email === p.email && a.role === p.role));
  const promptCount = Number((await client.query('select count(*) as n from speaking_prompts')).rows[0].n);
  assert.equal(promptCount, 0, 'QA prompt fixtures must not overwrite any bank');
  for (const part of ['part1', 'part2', 'part3']) {
    await client.query("insert into speaking_prompts(part,category,prompt_text,topic,source_class,available_in,publication_state,is_active) values($1,'general',$2,'Disposable QA','owner_authored_test','[\"practice_alone\"]'::jsonb,'published',true)", [part, 'Disposable browser layout fixture: ' + part]);
  }
  console.log(JSON.stringify({ scope: 'DISPOSABLE_PRIVATE_BROWSER_QA', nativeClusterIdentityVerified: true, actorsVerified: 4, syntheticPromptsInserted: 3, originalBankChanged: false, microphoneRequested: false, providerInvoked: false }));
} finally { await client?.end(); await admin.end(); }
