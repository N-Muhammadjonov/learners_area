import "server-only";
import pg from "pg";
import { parseArgs } from "node:util";
import { privatePortableFile } from "./lib/portable-private-file";
import { runPortableImportCommand } from "../src/lib/portability/import-command";
let pool: pg.Pool | undefined; let key: Buffer | undefined;
try {
  const { values } = parseArgs({ options: { source: { type: "string" }, "expected-scope": { type: "string" }, "dry-run": { type: "boolean", default: true }, apply: { type: "boolean", default: false }, "destination-fingerprint": { type: "string" }, "session-file": { type: "string" }, "key-file": { type: "string" }, "identity-map-file": { type: "string" } }, strict: true, allowPositionals: false });
  if (!values.source || !values["expected-scope"] || !values["session-file"] || !values["key-file"] || !values["destination-fingerprint"] || !process.env.DATABASE_URL) throw new Error("portable_arguments_required");
  if (values.apply && process.argv.includes("--dry-run")) throw new Error("portable_conflicting_modes");
  const sessionToken = (await privatePortableFile(values["session-file"], 8192)).toString("utf8").trim();
  key = await privatePortableFile(values["key-file"], 32);
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const identityMapping = values["identity-map-file"] ? JSON.parse((await privatePortableFile(values["identity-map-file"], 262144)).toString("utf8")) : undefined;
  const plan = await runPortableImportCommand({ request: { source: values.source, expectedScope: values["expected-scope"], dryRun: !values.apply, destinationFingerprint: values["destination-fingerprint"] }, sessionToken, pool, key, identityMapping });
  console.log(JSON.stringify({ ...plan, activation: "NOT_PERFORMED", acceptance: "PENDING_DESTINATION_BOOT_OBJECT_ACCESS_AND_REGRESSION" }));
} catch {
  console.error("portable_import_failed: inspect scope, credentials, fresh destination, identities and archive; reconcile any uncertain commit before retrying");
  process.exitCode = 1;
} finally { key?.fill(0); await pool?.end(); }
