/**
 * Migration contract, exercised against a real PostgreSQL engine (PGlite) - FIN-13.
 *
 * The point of the third test is the one that matters: on the upgrade path, against a
 * database with no content, 0094 still raises. The listening validation was not weakened,
 * removed or bypassed - the fresh-install path simply no longer runs a content repair against
 * a database that has no content.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestMigrations, migrationContract } from '../apply-test-migrations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const FINANCE_TABLES = [
  'tuition_charges', 'tuition_contracts', 'tuition_payments', 'tuition_refunds',
  'tuition_credit_notes', 'finance_journal_entries', 'finance_journal_lines',
  'finance_audit_events', 'finance_outbox_events', 'cash_day_adjustments',
];
const ACADEMY_TABLES = [
  'academy_groups', 'academy_group_teachers', 'academy_group_memberships',
  'academy_sessions', 'academy_session_teachers', 'academy_session_reservations', 'academy_attendance',
  'academy_leads', 'academy_lead_notes',
];

async function tableExists(db, name) {
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [name]);
  return rows.length === 1;
}

test('the fresh-install path reaches the tuition finance and academy schemas', async () => {
  const db = new PGlite();
  const report = await applyTestMigrations(db, root, { mode: 'fresh' });
  assert.equal(report.mode, 'fresh');
  assert.ok(report.applied > 90, `expected the schema chain to run, applied ${report.applied}`);
  assert.ok(report.deferred.length > 0, 'content migrations should be reported as deferred');
  // Deferral is reported, never silent.
  for (const entry of report.deferred) {
    assert.ok(entry.file && entry.reason, `deferred entry is not explained: ${JSON.stringify(entry)}`);
  }
  for (const table of [...FINANCE_TABLES, ...ACADEMY_TABLES]) {
    assert.ok(await tableExists(db, table), `${table} was not created on the fresh path`);
  }
  // The freeze on approved contract terms is a database trigger, not an application rule.
  const triggers = await db.query(
    "SELECT tgname FROM pg_trigger WHERE tgname='tuition_contracts_freeze_terms'");
  assert.equal(triggers.rows.length, 1, 'the frozen-terms trigger is missing');
  // And the per-currency balance guard survived too.
  const guard = await db.query(
    "SELECT tgname FROM pg_trigger WHERE tgname='finance_journal_balance_deferred'");
  assert.equal(guard.rows.length, 1, 'the journal balance guard is missing');
});

test('no finance migration is ever deferred', async () => {
  const contract = migrationContract(root);
  const deferredFinance = contract.contentMigrations.filter(name => /^11(1[5-9]|20)/.test(name));
  assert.deepEqual(deferredFinance, [], `finance migrations must always run: ${deferredFinance}`);
});

test('the upgrade path still enforces the listening content assertion', async () => {
  // This is the proof that nothing was weakened. An upgrade against a database with no
  // imported content must still fail exactly where it always did.
  const db = new PGlite();
  await assert.rejects(
    () => applyTestMigrations(db, root, { mode: 'upgrade' }),
    (error) => {
      assert.match(String(error.message), /Listening 1.20 must contain 80 transcript Parts/);
      return true;
    },
    'the content assertion no longer fires - the validation was removed, not deferred');
});

test('an unknown mode is refused rather than treated as fresh', async () => {
  const db = new PGlite();
  await assert.rejects(() => applyTestMigrations(db, root, { mode: 'whatever' }),
                       /Unknown migration mode/);
});
