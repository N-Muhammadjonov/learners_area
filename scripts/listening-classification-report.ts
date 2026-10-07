/**
 * OWNER REVIEW — what the Listening catalogue currently classifies, and what needs a decision.
 *
 * Read-only, on purpose: the owner's rule is that a legacy row whose canonical identity cannot
 * be PROVEN is flagged for review, never guessed into a classification and never relabelled.
 * This prints the learner-visible Listening content with the product the application itself
 * decides (`src/lib/listening/product.ts` — the same decision table the Academic catalogue and
 * the hub guard use, so the report cannot drift from the product).
 *
 * Run against any database:
 *   DATABASE_URL=postgres://… node --conditions=react-server --import tsx scripts/listening-classification-report.ts
 *
 * Nothing here writes: the script is safe to run against Production while triaging.
 */
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { partsSql, productSql, questionsSql, type ListeningProductKind } from "../src/lib/listening/product";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (read-only query; nothing is written).");
  process.exit(2);
}

const explanation: Record<ListeningProductKind | "not_live", string> = {
  academic_full_test: "A formal Academic Listening full test (the Academic catalogue lists it).",
  general_section: "A General Listening section (its own catalogue lists it).",
  essential_recording: "An Essential recording: listening practice, not an IELTS test.",
  mcq_programme: "A dedicated MCQ training package: practice, NOT an academic full test.",
  question_type_practice: "Question-type practice: NOT an academic full test.",
  unclassified:
    "REVIEW REQUIRED — no canonical collection and no provable 4-part / 40-question structure. " +
    "It is NOT in any catalogue. Confirm with the source material, then either register it as the " +
    "content it really is or retire it; do not guess.",
  not_live: "Not learner-visible (draft, archived or future-dated).",
};

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // The classification is the APPLICATION's own decision table, not a copy of it: the report
  // and the catalogue read the same expression, so they can never drift apart.
  const reportQuery = sql`
    select t.id,
           t.title,
           t.source_ref,
           p.payload->>'collection' as collection,
           ${partsSql(sql.raw("p.payload"))} as parts,
           ${questionsSql(sql.raw("p.payload"))} as questions,
           ${productSql({
             testId: sql.raw("t.id"),
             payload: sql.raw("p.payload"),
             payloadIsNull: sql.raw("p.payload is null"),
           })} as product,
           (t.publication_state in ('published','scheduled')
             and t.is_active
             and (t.publish_at is null or t.publish_at <= now())) as learner_visible,
           (select count(*)::int from listening_attempts a where a.test_id = t.id) as attempts
      from listening_tests t
      left join listening_packages p on p.test_id = t.id
     order by learner_visible desc, product, t.created_at, t.source_ref, t.id
  `;
  type ReportRow = {
    id: string;
    title: string;
    source_ref: string | null;
    collection: string | null;
    parts: number | null;
    questions: number | null;
    product: ListeningProductKind;
    learner_visible: boolean;
    attempts: number;
  };
  const compiled = new PgDialect().sqlToQuery(reportQuery);
  const { rows } = await client.query<ReportRow>(compiled.sql, compiled.params);

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.learner_visible ? row.product : "not_live";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const [key, group] of groups) {
    console.log(`\n=== ${key} (${group.length}) — ${explanation[key as keyof typeof explanation] ?? ""}`);
    for (const row of group) {
      const shape = row.parts === null && row.questions === null ? "" : ` [${row.parts ?? "?"} parts / ${row.questions ?? "?"} questions]`;
      console.log(
        `  ${row.title}${shape} — source_ref=${row.source_ref ?? "(none)"} collection=${row.collection ?? "(none)"} attempts=${row.attempts} id=${row.id}`,
      );
    }
  }

  const review = groups.get("unclassified") ?? [];
  const academic = groups.get("academic_full_test") ?? [];
  console.log(`\nSummary: ${academic.length} academic full test(s), ${review.length} row(s) awaiting an owner decision.`);
  if (review.length) {
    console.log("Nothing was changed. The Academic catalogue does not list these; confirm each one's source material before classifying it.");
  }
} finally {
  await client.end();
}
