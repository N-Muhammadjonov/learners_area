/**
 * OWNER TRIAGE — what the Listening catalogue classifies today, and what needs a human decision.
 *
 * READ-ONLY. There is no INSERT, UPDATE, DELETE, DROP or ALTER anywhere in this file: it issues
 * exactly one SELECT and prints it. Running it against Production while the owner triages is safe,
 * and it is equally safe to run it twice.
 *
 * WHAT IT IS FOR. The owner's rule is that a legacy row whose canonical identity cannot be PROVEN
 * is flagged for review — never guessed into a classification, never relabelled, never retired
 * behind the owner's back. So this report is deliberately NOT a classifier: it does not look at a
 * title, a file name, a question count or where a row used to sit in the old UI. It shows the
 * product the APPLICATION ITSELF decides (`src/lib/listening/product.ts` — the same decision table
 * the catalogues and the hub guard use, so the report cannot drift from the product), and for
 * every row that needs a decision it states WHY the product could not decide, plus the learner
 * history that would be affected. The owner then decides, with the source material in hand.
 *
 * Run against any database:
 *   DATABASE_URL=postgres://… node --conditions=react-server --import tsx scripts/listening-classification-report.ts
 */
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  inProgrammeSql,
  partsSql,
  productSql,
  questionsSql,
  versionTypeSql,
  type ListeningProductKind,
} from "../src/lib/listening/product";
import { attemptHistoryLine, classificationDecisionReason } from "../src/lib/listening/classification-triage";

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
  /*
   * One SELECT. Every column exists to answer a question the owner has to answer anyway:
   * what IS this row (identity), what does it structurally contain (facts), was it ever used
   * (learner history, so a decision never silently destroys a real result), and — for a row the
   * product cannot place — WHY it could not.
   */
  const reportQuery = sql`
    select t.id,
           t.title,
           t.source_ref,
           (p.payload is not null) as has_package,
           ${versionTypeSql(sql.raw("t.id"))} as revision_type,
           p.payload->>'collection' as collection,
           ${partsSql(sql.raw("p.payload"))} as parts,
           ${questionsSql(sql.raw("p.payload"))} as questions,
           ${productSql({
             testId: sql.raw("t.id"),
             payload: sql.raw("p.payload"),
             payloadIsNull: sql.raw("p.payload is null"),
             inProgramme: inProgrammeSql(sql.raw("t.program_ref")),
           })} as product,
           (t.publication_state in ('published','scheduled')
             and t.is_active
             and (t.publish_at is null or t.publish_at <= now())) as learner_visible,
           (select count(*)::int from listening_attempts a where a.test_id = t.id) as attempts,
           (select count(*)::int from listening_attempts a where a.test_id = t.id and a.status = 'completed') as completed_attempts,
           (select count(distinct a.user_id)::int from listening_attempts a where a.test_id = t.id) as learners,
           (select max(a.started_at) from listening_attempts a where a.test_id = t.id) as last_attempt_at
      from listening_tests t
      left join listening_packages p on p.test_id = t.id
     order by learner_visible desc, product, t.created_at, t.source_ref, t.id
  `;
  type ReportRow = {
    id: string;
    title: string;
    source_ref: string | null;
    has_package: boolean;
    revision_type: string | null;
    collection: string | null;
    parts: number | null;
    questions: number | null;
    product: ListeningProductKind;
    learner_visible: boolean;
    attempts: number;
    completed_attempts: number;
    learners: number;
    last_attempt_at: Date | null;
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
      const shape = row.has_package ? `package: yes, ${row.parts ?? "?"} part(s) / ${row.questions ?? "?"} question(s)` : "package: NONE (authored natively)";
      const history = attemptHistoryLine({
        attempts: row.attempts,
        completedAttempts: row.completed_attempts,
        learners: row.learners,
        lastAttemptAt: row.last_attempt_at,
      });
      console.log(`  ${row.title}`);
      console.log(`      id=${row.id}`);
      console.log(`      source_ref=${row.source_ref ?? "(none)"} · collection=${row.collection ?? "(none)"} · revision=${row.revision_type ?? "(none)"}`);
      console.log(`      ${shape}`);
      console.log(`      learner history: ${history}`);
      if (key === "unclassified") {
        console.log(
          `      why it needs a decision: ${classificationDecisionReason({
            product: row.product,
            hasPackage: row.has_package,
            revisionType: row.revision_type,
            collection: row.collection,
            parts: row.parts,
            questions: row.questions,
          })}`,
        );
      }
    }
  }

  const review = groups.get("unclassified") ?? [];
  const academic = groups.get("academic_full_test") ?? [];
  const general = groups.get("general_section") ?? [];
  console.log(`\nSummary: ${academic.length} academic full test(s), ${general.length} General section(s), ${review.length} row(s) awaiting an owner decision.`);
  if (review.length) {
    const withHistory = review.filter((row) => row.attempts > 0);
    console.log("Nothing was changed — this report writes nothing. The Academic catalogue does not list the rows below it flags.");
    if (withHistory.length) {
      console.log(
        `${withHistory.length} of them carry real learner history: deciding to retire one would withdraw content learners have already attempted ` +
          `(their results stay readable — no attempt, answer or score is ever deleted — but the item stops being offered).`,
      );
    }
    console.log(
      "For each row the owner decides, with the source material in hand, between: registering it as the content it really is, " +
        "leaving it out of every catalogue as it is today, or retiring it. Nothing is guessed from a title, a file name or a question count.",
    );
  }
} finally {
  await client.end();
}
