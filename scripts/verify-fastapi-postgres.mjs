/** Real PostgreSQL engine + actual Python ASGI requests, without opening a port. */
import { PGlite } from '@electric-sql/pglite';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema.ts';
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
  const probe=process.env.POSTGRES_PROBE || 'tests/pglite_http_probe.py';
  if(!/^tests\/[a-z0-9_]+\.py$/.test(probe))throw Error('Invalid probe path');
  const runProbe=async()=>{
    const child = spawn(python, [probe], { cwd: join(root, 'services/backend'), env: { ...process.env, PYTHONPATH: '.' }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    return report;
  };
  const replicas=process.env.POSTGRES_PROBE_REPLICAS==='2'?2:1;
  const reports=await Promise.all(Array.from({length:replicas},()=>runProbe()));
  const report=reports[0];
  if(replicas===2 && reports.reduce((n,r)=>n+(r.allowed??0),0)!==8)throw Error('Replica counters diverged');
  const checks=reports.reduce((n,r)=>n+r.checks,0);
  const checkKinds=report.probeKind==='read_model'?{readModelChecks:checks}:
    report.probeKind==='riwi_assignments'?{integrationChecks:checks}:
    ['riwi_policy','riwi_domain','riwi_contracts','riwi_grammar_lookup'].includes(report.probeKind)?{storeChecks:report.storeChecks,httpChecks:report.httpChecks}:{httpChecks:checks};
  console.log(JSON.stringify({ migrations: applied, typedTables, ...checkKinds, replicas, admitted:replicas===2?reports.reduce((n,r)=>n+r.allowed,0):undefined, measurements:report.measurements, database: 'embedded PostgreSQL', result: 'passed' }));
  if (process.env.FASTAPI_WIRE_FIXTURE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.FASTAPI_WIRE_FIXTURE, JSON.stringify(report.wire));
  }
} finally {
  await db.close();
}
