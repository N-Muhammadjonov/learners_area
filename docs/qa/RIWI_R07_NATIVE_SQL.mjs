import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGUSER, 'postgres');
assert.match(input.expectedDataDir, /^\/(?:private\/)?tmp\/riwi-r07-pitr-[A-Za-z0-9_]+\/(source|restored)$/);
assert.ok(['postgres', 'learners_qa2'].includes(process.env.PGDATABASE));
const client = new pg.Client({ connectionTimeoutMillis: 5000, statement_timeout: 30000 });
pg.types.setTypeParser(1184, value => value);
await client.connect();
try {
  const identity = await client.query('SELECT current_setting(\'data_directory\') AS directory, current_setting(\'server_version\') AS version');
  assert.equal(resolve(identity.rows[0].directory), resolve(input.expectedDataDir));
  assert.match(identity.rows[0].version, /^16\./);
  const result = await client.query({ text: input.sql, rowMode: 'array' });
  const batches = Array.isArray(result) ? result : [result];
  const printable = value => value === null ? '' : typeof value === 'boolean' ? (value ? 't' : 'f') : String(value);
  process.stdout.write(batches.flatMap(batch => batch.rows.map(row => row.map(printable).join('|'))).join('\n'));
} finally {
  await client.end();
}
