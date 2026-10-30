/**
 * After migration 0029: (1) generate inflected forms for backfilled lexical units,
 * (2) link each already-imported Listening package's authored vocabulary to its
 * transcript (same function the import route now runs). Idempotent; additive only.
 *
 *   DATABASE_URL=… node --conditions=react-server --import tsx scripts/backfill-vocabulary-0029.ts [--dry-run]
 *
 * --dry-run runs everything inside a transaction and rolls it back, printing counts.
 * Never point this at Production without the guarded procedure used for migrations.
 */
import { db } from "../src/db/tooling-client";
import { listeningPackages } from "../src/db/schema";
import { backfillLexicalForms } from "../src/lib/services/lexical/units";
import { ingestListeningOccurrences } from "../src/lib/services/lexical/listening-occurrences";

const dryRun = process.argv.includes("--dry-run");
class Rollback extends Error {}
const report: Record<string, unknown> = { dryRun };
try {
  await db.transaction(async (tx) => {
    report.forms = await backfillLexicalForms(tx);
    const packages = await tx.select({ testId: listeningPackages.testId, payload: listeningPackages.payload }).from(listeningPackages);
    report.listening = [];
    for (const pkg of packages) (report.listening as unknown[]).push({ testId: pkg.testId, ...(await ingestListeningOccurrences(tx, pkg.testId, pkg.payload)) });
    if (dryRun) throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
}
console.log(JSON.stringify(report, null, 2));
process.exit(0);
