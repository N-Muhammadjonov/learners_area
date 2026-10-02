/**
 * Import one authored General Reading set (JSON bundle, see
 * src/lib/services/reading/general-import.ts). Requires migration 0030.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/import-general-reading.ts path/to/set.json [--dry-run]
 *
 * Draft by default ("publish": true in the bundle publishes). Idempotent on sourceRef.
 * Never run against Production without owner approval.
 */
import { readFileSync } from "node:fs";
import { db } from "../src/db/client";
import { generalReadingBundle, importGeneralReadingSet } from "../src/lib/services/reading/general-import";
import { generalReadingSchemaReady } from "../src/lib/data/general-reading";

const [file, flag] = process.argv.slice(2);
if (!file) { console.error("usage: import-general-reading.ts <bundle.json> [--dry-run]"); process.exit(2); }
const bundle = generalReadingBundle.parse(JSON.parse(readFileSync(file, "utf8")));
if (!(await generalReadingSchemaReady())) { console.error("migration 0030 is not applied on this database"); process.exit(1); }
class DryRun extends Error {}
try {
  await db.transaction(async (tx) => {
    const result = await importGeneralReadingSet(tx, bundle);
    console.log(JSON.stringify(result, null, 2));
    if (flag === "--dry-run") throw new DryRun();
  });
} catch (error) {
  if (!(error instanceof DryRun)) throw error;
  console.log("dry run: rolled back");
}
process.exit(0);
