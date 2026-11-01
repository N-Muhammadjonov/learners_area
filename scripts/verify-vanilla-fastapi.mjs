/** Real PostgreSQL engine + actual Python ASGI requests, without opening a port. */
import { PGlite } from '@electric-sql/pglite';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema.ts';
import {validateBrowserWire} from './verify-browser-dtos.mjs';
import {applyTestMigrations} from './apply-test-migrations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
const python = resolve(root, process.env.BACKEND_PYTHON || 'services/backend/.venv/bin/python');
let applied = 0;
try {
  applied=await applyTestMigrations(db,root);
  // The UI's typed selectors must agree with the actual migrated database.
  const columns = (await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")).rows;
  const actual = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
  let typedTables = 0;
  for (const table of Object.values(schema).filter(value => is(value, PgTable))) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (!actual.has(`${config.name}.${column.name}`)) throw new Error(`Typed schema is ahead of migrations: ${config.name}.${column.name}`);
    }
    typedTables++;
  }
  const types = new Map((await db.query('SELECT oid,typname FROM pg_type')).rows.map(r => [r.oid, r.typname]));
  const child = spawn(python, ['tests/browser_http_probe.py'], { cwd: join(root, 'services/backend'), env: { ...process.env, PYTHONPATH: '.' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let report;
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', async line => {
    let message;
    try {
      message = JSON.parse(line);
      if (message.event === 'done') { report = message; return; }
      let result;
      if (message.mode === 'describe') {
        const info = await db.describeQuery(message.sql);
        result = { params: info.queryParams.map(p => ({ name: types.get(p.dataTypeID) })), fields: info.resultFields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID, typeName: types.get(f.dataTypeID) })) };
      } else if (message.mode === 'exec') {
        const output = await db.exec(message.sql);
        result = output[0] || { rows: [], fields: [] };
      } else result = await db.query(message.sql, message.values);
      child.stdin.write(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
    } catch (error) {
      child.stdin.write(JSON.stringify({ error: error.message, code: error.code }) + '\n');
    }
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0 || !report) throw new Error(errors || 'Python PostgreSQL probe failed');
  // Replaying the monitoring upgrade must preserve populated academic records.
  const preservedTables=['notifications','assignments','assignment_targets','assignment_responses',
    'writing_language_patterns','writing_submissions','writing_feedback','video_lesson_progress'];
  const snapshot=async()=>Promise.all(preservedTables.map(async table=>
    (await db.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM ${table} t`)).rows[0].digest));
  const beforeReplay=await snapshot();
  await db.exec('BEGIN');
  try {
    for(const file of readdirSync(join(root,'services/backend/migrations')).filter(x=>/^006[6-9]_.*\.sql$/.test(x)).sort())
      await db.exec(readFileSync(join(root,'services/backend/migrations',file),'utf8'));
    await db.exec('COMMIT');
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
  const afterReplay=await snapshot();
  if(JSON.stringify(beforeReplay)!==JSON.stringify(afterReplay))throw Error('Monitoring migration replay changed academic data');
  const migrationReplayChecks=preservedTables.length;
  if (process.env.FASTAPI_WIRE_FIXTURE) writeFileSync(process.env.FASTAPI_WIRE_FIXTURE,JSON.stringify(report.wire));
  const nativeDecoderChecks=validateBrowserWire(report.wire);
  const temporary=mkdtempSync(join(tmpdir(),'learners-native-qa-'));
  let nativeDomChecks;
  try{
    const fixture=join(temporary,'wire.json');writeFileSync(fixture,JSON.stringify(report.wire));
    const ui=spawnSync(process.execPath,[join(root,'scripts/verify-native-wire-ui.mjs'),fixture],{cwd:root,encoding:'utf8',timeout:60000});
    const result=JSON.parse(ui.stdout.trim().split('\n').at(-1));
    if(ui.status!==0||result.failures.length)throw Error(JSON.stringify(result));
    nativeDomChecks=result.checks;
  }finally{rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({ migrations: applied, typedTables, httpChecks: report.checks, nativeDecoderChecks,nativeDomChecks,migrationReplayChecks, database: 'embedded PostgreSQL', result: report.failures?.length ? 'failed' : 'passed',failures:report.failures }));
  if (report.failures?.length) process.exitCode=1;
  if (process.env.FASTAPI_WIRE_FIXTURE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.FASTAPI_WIRE_FIXTURE, JSON.stringify(report.wire));
  }
} finally {
  await db.close();
}
