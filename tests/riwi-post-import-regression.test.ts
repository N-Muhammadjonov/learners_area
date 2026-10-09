import test from "node:test";
import assert from "node:assert/strict";
import { exportPortableArchive, importPortableArchive } from "../src/lib/portability/archive";
import { verifyRiwiPostImport } from "../src/lib/portability/post-import-regression";
import { PORTABLE_SCHEMA_VERSION, RIWI_CORE_VERSION } from "../src/lib/portability/types";

test("post-import fake site proves denial, version compatibility and state-fenced regression without activation", async () => {
  const files = new Map<string, string>(); let active = "";
  const manifest = await exportPortableArchive({ scope: "riwi", objectMode: "keep-r2", sourceFingerprint: "fake-adapter-fixture", createdAt: new Date("2026-10-09T00:00:00Z"),
    source: { async *rows(table) { if (table === "riwi_security_signals") yield [{ id: "signal", state: "approved_regression" }]; }, async *objects() {} },
    sink: { async beginFile(path) { active = path; files.set(path, ""); }, async write(line) { files.set(active, files.get(active)! + line); }, async endFile() {} } });
  const installed: unknown[] = [];
  await importPortableArchive({ manifest, dryRun: false, archive: { async *readRows(path) { yield* files.get(path)!.split("\n").filter(Boolean); }, async readObject() { throw new Error("no objects in fixture"); } },
    destination: { async transaction(work) { return work({ async planRow() { return "create"; }, async applyRow(_table, row) { installed.push(row); }, async copyObject() { throw new Error("no object copy expected"); } }); } } });
  assert.equal(installed.length, 1);
  const actor = { id: "aaaaaaaa-0000-4000-8000-000000000001", role: "student" as const, accountStatus: "active" as const };
  const adapter = { portableSchemaVersion: PORTABLE_SCHEMA_VERSION, riwiCoreVersion: RIWI_CORE_VERSION, async resolveActor(id: string) { return id === actor.id ? actor : null; } };
  const input = { manifest, adapter, actor, async readDestinationFingerprint() { assert.equal(installed.length, 1); return "a".repeat(64); } };
  const receipt = await verifyRiwiPostImport(input);
  assert.equal(receipt.passed, true); assert.equal(receipt.activationPerformed, false);
  await assert.rejects(verifyRiwiPostImport({ ...input, adapter: { ...adapter, riwiCoreVersion: "unsupported" } }), /incompatible/);
  await assert.rejects(verifyRiwiPostImport({ ...input, adapter: { ...adapter, async resolveActor() { return { ...actor, accountStatus: "suspended" as const }; } } }), /regression_failed/);
  let reads = 0;
  await assert.rejects(verifyRiwiPostImport({ ...input, async readDestinationFingerprint() { return (++reads === 1 ? "a" : "b").repeat(64); } }), /regression_failed/);
});
