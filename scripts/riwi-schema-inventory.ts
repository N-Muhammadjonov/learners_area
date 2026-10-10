import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import { PORTABILITY_TABLES } from "../src/lib/portability/classification";
import { canonicalMigrationInputs, inspectCanonicalSchema } from "./lib/riwi-schema-inventory";

const root = process.cwd();
const output = process.argv[2];
if (!output || resolve(output) === resolve("docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl")) throw new Error("explicit_inventory_output_required");
const riwi = await inspectCanonicalSchema(canonicalMigrationInputs(root));
const declared = Object.values(schema).filter(value => is(value, PgTable)).map(value => getTableName(value as PgTable)).sort();
const catalog = riwi.objects.tables!.map(row => String(row.name)).sort();
const unclassified = catalog.filter(name => !(name in PORTABILITY_TABLES));
if (JSON.stringify(catalog) !== JSON.stringify(declared) || unclassified.length) throw new Error("inventory_schema_classification_mismatch");
let website = null;
if (process.argv[3]) {
  const input = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const common = canonicalMigrationInputs(root).filter(m => /^drizzle\/00[0-2]|^drizzle\/003[0-5]_/.test(m.path));
  const journal = JSON.parse(input.blobs["drizzle/meta/_journal.json"].content);
  const additional = journal.entries.filter((e: { idx: number }) => e.idx >= 36).map((entry: { tag: string }) => {
    const path = `drizzle/${entry.tag}.sql`, blob = input.blobs[path];
    if (!blob) throw new Error("website_migration_missing");
    const bytes = Buffer.from(blob.content);
    if (createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== blob.sha) throw new Error("website_blob_hash_mismatch");
    return { path, sql: blob.content as string, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  website = { commit: input.commit, tree: input.tree, ...await inspectCanonicalSchema([...common, ...additional]) };
}
writeFileSync(output, JSON.stringify({ version: 1, riwi_base: "7f805af85705906f6c37710a3030f3eb357e90c0", riwi, classification: { catalogTables: catalog.length, declaredTables: declared.length, missing: unclassified, allowlist: PORTABILITY_TABLES }, website, limits: ["No external database contacted", "No production data read", "Provider extension/role/grant differences must be re-inventoried in authorized native destinations", "Empty classes establish canonical-source absence only", "Sequence values belong to the empty fixture; target sequence reconciliation remains required", "No real object lifecycle, PITR restore or cutover was performed"] }, null, 2) + "\n");
console.log(JSON.stringify({ output, tables: catalog.length, classes: Object.keys(riwi.summary).length, websiteTables: website?.objects.tables!.length ?? null }));
