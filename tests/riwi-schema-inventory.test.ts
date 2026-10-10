import assert from "node:assert/strict";
import test from "node:test";
import { canonicalMigrationInputs, inspectCanonicalSchema, SCHEMA_OBJECT_QUERIES } from "../scripts/lib/riwi-schema-inventory";
import { PORTABILITY_TABLES } from "../src/lib/portability/classification";

test("canonical non-row inventory observes actual constraints/functions/triggers and never labels local absence as deployment acceptance", async () => {
  const inputs = canonicalMigrationInputs(process.cwd());
  const report = await inspectCanonicalSchema(inputs);
  assert.equal(report.deployment, "UNVERIFIED");
  assert.deepEqual(Object.keys(report.summary), Object.keys(SCHEMA_OBJECT_QUERIES));
  const tables = report.objects.tables!.map(row => String(row.name)).sort();
  assert.deepEqual(tables, Object.keys(PORTABILITY_TABLES).sort());
  assert.ok(report.objects.columns!.length > 1000);
  assert.ok(report.objects.functions_procedures!.length > 0);
  assert.ok(report.objects.triggers!.length > 0);
  for (const kind of ["p", "f", "u", "c"]) assert.ok(report.objects.constraints!.some(row => row.kind === kind), kind);
  assert.equal(report.summary.views!.status, "ABSENT_CANONICAL_LOCAL");
  assert.ok(report.migrations.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
});

test("canonical inventory rejects modified SQL instead of rehearsing a different migration under an accepted identity", async () => {
  const input = canonicalMigrationInputs(process.cwd())[0]!;
  await assert.rejects(inspectCanonicalSchema([{ ...input, sql: input.sql + "\n-- altered" }]), /inventory_sql_hash_mismatch/);
});
