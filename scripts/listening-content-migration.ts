/**
 * Listening legacy migration — scan, classify, dry-run, convert.
 *
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/listening-content-migration.ts
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/listening-content-migration.ts --apply --confirm-owner-approval
 *   DATABASE_URL=… npx tsx --conditions=react-server scripts/listening-content-migration.ts --source-ref listening-test-1 --apply --confirm-owner-approval
 *
 * Dry run by default: NOTHING is written. Each package is classified:
 *
 *   CANONICAL_NATIVE         already structured data; the native renderer runs it
 *   CONVERTIBLE_LEGACY       uploaded HTML/CSS/JS whose data extracts cleanly
 *   LEGACY_REQUIRES_REVIEW   extraction is ambiguous — a human must decide
 *   INVALID                  the stored payload no longer matches the schema
 *
 * `--apply` converts the CONVERTIBLE_LEGACY packages in place: same test row, same
 * ids, same publication state, same attempt history (question rows are reconciled,
 * never re-created), plus one `content_imports` row marked `converted`.
 *
 * Extraction is inert: only JSON literals and DOM text are read. No uploaded
 * script is executed, and an ambiguous package is reported instead of guessed.
 */
import { JSDOM } from "jsdom";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db/tooling-client";
import { listeningPackages } from "../src/db/schema";
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import {
  applyListeningConversion,
  classifyListeningPayload,
  convertLegacyRuntimePackage,
  type LegacyClassification,
} from "../src/lib/import/listening/legacy";
import { contentImportSchemaReady } from "../src/lib/import/core/readiness";

type Row = {
  testId: string;
  sourceId: string;
  payload: ListeningPackage;
  legacyRuntime: boolean;
};

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const apply = flag("--apply");
const approved = flag("--confirm-owner-approval");
const onlySourceRef = value("--source-ref");
const reportPath = value("--report") ?? `docs/receipts/listening-legacy-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

if (apply && !approved) {
  console.error("STOP --apply requires --confirm-owner-approval (production migrations are an owner action).");
  process.exit(2);
}

if (!(await contentImportSchemaReady())) {
  console.error("STOP migration 0040 (content_imports) is not applied on this database.");
  process.exit(1);
}

const reader = (html: string) => new JSDOM(html).window.document;

const rows = (await db
  .select({
    testId: listeningPackages.testId,
    sourceId: listeningPackages.sourceId,
    payload: listeningPackages.payload,
    legacyRuntime: listeningPackages.legacyRuntime,
  })
  .from(listeningPackages)) as Row[];

const byClassification: Record<LegacyClassification, number> = {
  CANONICAL_NATIVE: 0,
  CONVERTIBLE_LEGACY: 0,
  LEGACY_REQUIRES_REVIEW: 0,
  INVALID: 0,
};

type Entry = {
  testId: string;
  sourceId: string;
  classification: LegacyClassification;
  legacyRuntime: boolean;
  reasons: string[];
  questions: number;
  runtimeFiles: string[];
  conversion?: { applied: boolean; questions?: number; unsupported?: string[]; convertedFrom?: string };
};

const entries: Entry[] = [];
const converted: { testId: string; sourceId: string; questions: number }[] = [];

for (const row of rows) {
  if (onlySourceRef && row.sourceId !== onlySourceRef) continue;
  const parsedPayload = listeningPackageSchema.safeParse(row.payload);
  if (!parsedPayload.success) {
    byClassification.INVALID += 1;
    entries.push({
      testId: row.testId,
      sourceId: row.sourceId,
      classification: "INVALID",
      legacyRuntime: row.legacyRuntime,
      reasons: parsedPayload.error.issues.slice(0, 5).map((issue) => issue.message),
      questions: 0,
      runtimeFiles: [],
    });
    continue;
  }
  const payload = parsedPayload.data;
  const scan = classifyListeningPayload(payload);
  byClassification[scan.classification] += 1;
  const entry: Entry = {
    testId: row.testId,
    sourceId: row.sourceId,
    classification: scan.classification,
    legacyRuntime: row.legacyRuntime,
    reasons: scan.reasons,
    questions: scan.questions,
    runtimeFiles: scan.runtimeFiles,
  };

  if (scan.classification === "CONVERTIBLE_LEGACY") {
    const outcome = convertLegacyRuntimePackage(payload, reader);
    if (!outcome.ok) {
      byClassification.CONVERTIBLE_LEGACY -= 1;
      byClassification.LEGACY_REQUIRES_REVIEW += 1;
      entry.classification = "LEGACY_REQUIRES_REVIEW";
      entry.reasons = [...outcome.reasons];
      entry.conversion = { applied: false, unsupported: outcome.unsupported };
    } else if (apply) {
      const actorUserId = await ownerActorId();
      const result = await db.transaction((tx) =>
        applyListeningConversion(tx, {
          testId: row.testId,
          actorUserId,
          package: outcome.package,
          note: "Converted by scripts/listening-content-migration.ts with owner approval.",
        }),
      );
      if (result.ok) {
        converted.push({ testId: row.testId, sourceId: row.sourceId, questions: result.questions });
        entry.conversion = { applied: true, questions: result.questions, convertedFrom: payload.authoredRuntime?.entryPath };
      } else {
        entry.conversion = { applied: false, unsupported: [result.error] };
      }
    } else {
      entry.conversion = { applied: false, questions: outcome.report.questions, convertedFrom: payload.authoredRuntime?.entryPath };
    }
  }

  entries.push(entry);
}

/** The import record needs an actor; the owner is the only role that may approve this. */
async function ownerActorId(): Promise<string> {
  const result = await db.execute(sql`select id from users where role = 'owner' order by created_at limit 1`);
  const id = (result.rows[0] as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string")
    throw new Error("No owner account exists: the migration refuses to attribute the conversion to nobody.");
  return id;
}

const report = {
  generatedAt: new Date().toISOString(),
  applied: apply,
  database: process.env.DATABASE_URL ? "configured" : "missing",
  totals: { packages: rows.length, scanned: entries.length, ...byClassification, converted: converted.length },
  converted,
  entries,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.totals, null, 2));
console.log(`report: ${reportPath}`);
const review = entries.filter((entry) => entry.classification === "LEGACY_REQUIRES_REVIEW");
if (review.length) {
  console.log(`MANUAL REVIEW REQUIRED for ${review.length} package(s):`);
  for (const entry of review) console.log(`  ${entry.sourceId}: ${entry.reasons.join(" ")}`);
}
if (!apply) console.log("dry run: nothing was written.");
process.exit(0);
