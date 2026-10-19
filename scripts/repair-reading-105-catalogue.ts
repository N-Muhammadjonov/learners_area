/** Default = source-only plan. --dry-run checks production in a rolled-back transaction.
 * --apply requires the exact website deployment and its active owner's UUID.
 * No passages, questions, answers, content versions or learner rows are modified.
 */
import { resolve } from "node:path";
import pg from "pg";
import { postgresConnectionOptions } from "../src/db/postgres-connection";
import { reading105Catalogue, repairReading105Catalogue } from "./lib/reading-105-catalogue";
import { restoredLawCatalogue } from "./lib/reading-105-law";

const groups = restoredLawCatalogue(reading105Catalogue(resolve("data/import-sources/learnersarea_reading_105.zip")),resolve("data/import-sources/reading-105-law-restored.json"));
const args = process.argv.slice(2);
if (!args.length || args[0] === "--plan") {
  console.log(JSON.stringify({ sourceOnly: true, passages: groups.flatMap(g => g.passages).length, groups: groups.length, held: groups.flatMap(g => g.passages.filter(p => p.held).map(p => p.externalId)), groupsWith41Questions: groups.filter(g => g.passages.reduce((n, p) => n + p.questionCount, 0) === 41).map(g => g.title) }, null, 2));
} else {
  if (args.length !== 1 || !["--dry-run", "--apply"].includes(args[0]!)) throw Error("usage: repair-reading-105-catalogue.ts [--plan|--dry-run|--apply]");
  const e = process.env;
  if (e.RAILWAY_PROJECT_ID !== "fa66cadd-5364-47bd-95f9-0689b0562269" || e.RAILWAY_ENVIRONMENT_ID !== "e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a" || e.RAILWAY_SERVICE_ID !== "68f0cfac-8723-40e7-9c3c-52856dc06786" || !/^[a-f0-9]{40}$/.test(e.EXPECTED_REVISION ?? "") || e.RAILWAY_GIT_COMMIT_SHA !== e.EXPECTED_REVISION || !e.OWNER_ID || !e.DATABASE_URL) throw Error("reading105_wrong_target_or_missing_revision_owner");
  const client = new pg.Client({ ...postgresConnectionOptions(e.DATABASE_URL), connectionTimeoutMillis: 8000, query_timeout: 30000 });
  await client.connect();
  try {
    if (args[0] === "--apply" && !(await client.query("select relrowsecurity from pg_class where oid=to_regclass('public.reading_assessment_questions')")).rows[0]?.relrowsecurity) throw Error("reading105_private_selection_migration_required");
    const result = await repairReading105Catalogue(client, e.OWNER_ID, groups, args[0] === "--apply");
    console.log(JSON.stringify({ revision: e.RAILWAY_GIT_COMMIT_SHA, ...result }, null, 2));
  } finally { await client.end(); }
}
