/** Defaults to source-only validation. --apply writes only to the verified existing production service. */
import { db } from "../src/db/client";
import { readRetentionV4Source, RETENTION_V4_SOURCE_SHA256 } from "./retention-v4-source";
import { importRetentionV4 } from "./retention-v4-import";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== "--apply")) throw new Error("retention_v4_invalid_options");
  const items = readRetentionV4Source();
  if (!args.includes("--apply")) {
    console.log(JSON.stringify({ ok: true, mode: "source_only", items: items.length, perLevel: 15,
      sourceSha256: RETENTION_V4_SOURCE_SHA256 }));
    return;
  }
  if (process.env.RAILWAY_PROJECT_ID !== "fa66cadd-5364-47bd-95f9-0689b0562269" ||
      process.env.RAILWAY_ENVIRONMENT_ID !== "e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a" ||
      process.env.RAILWAY_SERVICE_ID !== "68f0cfac-8723-40e7-9c3c-52856dc06786") throw new Error("retention_v4_wrong_target");
  if (!process.env.RETENTION_BATCH_EXPECTED_REVISION ||
      process.env.RAILWAY_GIT_COMMIT_SHA !== process.env.RETENTION_BATCH_EXPECTED_REVISION) throw new Error("retention_v4_deployment_revision_mismatch");
  const ownerId = process.env.RETENTION_BATCH_OWNER_ID;
  if (!ownerId) throw new Error("retention_v4_owner_required");
  const results = await importRetentionV4(items, ownerId, db);
  console.log(JSON.stringify({ ok: true, mode: "apply", sourceSha256: RETENTION_V4_SOURCE_SHA256,
    revision: process.env.RAILWAY_GIT_COMMIT_SHA, items: results.length,
    created: results.filter(row => row.action === "created").length,
    unchanged: results.filter(row => row.action === "unchanged").length, results }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Retention import failed"); process.exitCode = 1; })
  .finally(() => db.$client.end());
