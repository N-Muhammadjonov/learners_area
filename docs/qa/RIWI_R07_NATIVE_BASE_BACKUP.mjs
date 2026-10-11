// PostgreSQL 16 documented low-level physical-backup API. Disposable QA only.
import pg from 'pg';
import fs from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const data = resolve(process.env.R07_SOURCE_DATA_DIR);
const backup = resolve(process.env.R07_BACKUP_DIR);
assert.match(data, /^\/(?:private\/)?tmp\/riwi-r07-pitr-[A-Za-z0-9_]+\/source$/);
assert.equal(backup, join(dirname(data), 'base'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGUSER, 'postgres');
assert.equal(process.env.PGDATABASE, 'learners_qa2');
assert.ok(!fs.existsSync(backup), 'destination must be new');
assert.equal(fs.readdirSync(join(data, 'pg_tblspc')).length, 0, 'external tablespaces are not supported by this local harness');
const client = new pg.Client({ connectionTimeoutMillis: 5000, statement_timeout: 90000 });
await client.connect();
try {
  const identity = (await client.query("SELECT current_setting('data_directory') AS directory,current_setting('server_version') AS version,current_setting('archive_mode') AS archive_mode,current_setting('full_page_writes') AS full_page_writes,(SELECT system_identifier::text FROM pg_control_system()) AS system_identifier")).rows[0];
  assert.equal(resolve(identity.directory), data);
  assert.match(identity.version, /^16\./);
  assert.equal(identity.archive_mode, 'on');
  assert.equal(identity.full_page_writes, 'on');
  const startLSN = (await client.query("SELECT pg_backup_start('RIWI_DISPOSABLE_R07', true)::text AS lsn")).rows[0].lsn;
  const omitContents = new Set(['pg_wal', 'pg_replslot', 'pg_dynshmem', 'pg_notify', 'pg_serial', 'pg_snapshots', 'pg_stat_tmp', 'pg_subtrans']);
  let copiedFiles = 0;
  fs.cpSync(data, backup, {
    recursive: true, preserveTimestamps: true, errorOnExist: true, force: false,
    filter(source) {
      const rel = relative(data, source);
      if (!rel) return true;
      const parts = rel.split('/');
      if (parts.length > 1 && omitContents.has(parts[0])) return false;
      if (parts.some(part => part.startsWith('pgsql_tmp') || part === 'pg_internal.init')) return false;
      if (['postmaster.pid', 'postmaster.opts', 'backup_label', 'tablespace_map'].includes(rel)) return false;
      const stat = fs.lstatSync(source);
      assert.ok(!stat.isSymbolicLink(), 'unexpected symlink in private QA cluster');
      if (stat.isFile()) copiedFiles += 1;
      return true;
    },
  });
  const stop = (await client.query('SELECT * FROM pg_backup_stop(wait_for_archive => true)')).rows[0];
  assert.equal(stop.spcmapfile, '', 'unexpected tablespace map');
  assert.ok(stop.labelfile.includes('RIWI_DISPOSABLE_R07'));
  fs.writeFileSync(join(backup, 'backup_label'), stop.labelfile, { flag: 'wx', mode: 0o600 });
  for (const directory of omitContents) fs.mkdirSync(join(backup, directory), { recursive: true, mode: 0o700 });
  assert.ok(!fs.existsSync(join(backup, 'postmaster.pid')));
  const labelBytes = fs.readFileSync(join(backup, 'backup_label'));
  assert.equal(labelBytes.toString('utf8'), stop.labelfile);
  const startWAL = /START WAL LOCATION:.*\(file ([A-F0-9]{24})\)/.exec(stop.labelfile)?.[1];
  assert.ok(startWAL, 'backup label must identify first WAL');
  const stopWAL = (await client.query('SELECT pg_walfile_name($1::pg_lsn) AS filename', [stop.lsn])).rows[0].filename;
  const walDirectory = join(dirname(data), 'wal');
  const wal = fs.readdirSync(walDirectory).filter(name => /^[A-F0-9]{24}$/.test(name)).sort();
  const required = wal.filter(name => name >= startWAL && name <= stopWAL);
  assert.ok(required.includes(startWAL) && required.includes(stopWAL));
  const walHashes = required.map(name => ({ name, bytes: fs.statSync(join(walDirectory, name)).size, sha256: createHash('sha256').update(fs.readFileSync(join(walDirectory, name))).digest('hex') }));
  process.stdout.write(JSON.stringify({ kind: 'POSTGRESQL_16_LOW_LEVEL_PHYSICAL_BASE_BACKUP', same_connection_start_stop: true, wait_for_archive: true, system_identifier: identity.system_identifier, copied_files: copiedFiles, start_lsn: startLSN, stop_lsn: stop.lsn, first_wal: startWAL, last_backup_wal: stopWAL, backup_label_sha256: createHash('sha256').update(labelBytes).digest('hex'), archived_backup_wal: walHashes, logical_dump_used: false, external_tablespaces: false }) + '\n');
} finally {
  // Closing this same connection aborts any unsuccessful active backup session.
  await client.end();
}
