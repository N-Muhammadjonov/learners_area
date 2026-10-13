import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';

// Read-only. This script cannot adopt, record, apply, repair or delete anything.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
let client;
try {
  if (!process.env.DATABASE_URL) throw new Error('database_not_configured');
  const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
  client = await pool.connect();
  await client.query('begin read only');
  const ledger = (await client.query("select to_regclass('drizzle.__drizzle_migrations') as ledger")).rows[0].ledger;
  if (!ledger) throw new Error('migration_ledger_missing');
  const applied = (await client.query('select hash,created_at from drizzle.__drizzle_migrations order by created_at,id')).rows;
  const prefixMatches = applied.length <= migrations.length &&
    applied.every((row,index) => row.hash === migrations[index].hash && Number(row.created_at) === migrations[index].folderMillis);
  const existing = (await client.query("select tablename from pg_tables where schemaname='public' and (tablename like 'telegram_%' or tablename='ownership_transfer_challenges') order by tablename")).rows;
  const historicalBotSchema = applied.length <= 53 && existing.length > 0;
  const safe = prefixMatches && applied.length >= 53 && !historicalBotSchema;
  console.log(JSON.stringify({
    readOnly: true, appliedCount: applied.length, exactJournalPrefix: prefixMatches,
    existingBotTables: existing.map(row => row.tablename), requiresHistoricalSchemaAdoption: historicalBotSchema,
    pendingTags: JSON.parse((await import('node:fs')).readFileSync('drizzle/meta/_journal.json','utf8')).entries.slice(applied.length).map(row=>row.tag),
    eligibleForReviewedMigrationWindow: safe,
    productionApprovalStillRequired: true
  },null,2));
  await client.query('rollback');
  if (!safe) process.exitCode=2;
} catch (error) {
  console.error('Read-only Telegram migration preflight failed: '+(error.code || (/^[a-z_]+$/.test(error.message) ? error.message : 'database_inspection_unavailable')));
  process.exitCode=2;
} finally {
  if (client) client.release();
  await pool.end();
}
