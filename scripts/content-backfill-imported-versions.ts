#!/usr/bin/env -S node --conditions=react-server --import tsx
/**
 * Backfill canonical revisions for content that was imported BEFORE the importers
 * pinned versions (§95, §43, §71).
 *
 * WHAT THIS IS: Reading sets and Listening packages that already exist in the
 * database have no `content_versions` row, so nothing could be assigned, composed
 * into a mock or bound to an attempt by revision. This script reads the content
 * that is ALREADY STORED — a Reading set's passages, a Listening package's stored
 * payload — and pins the revision it should always have had.
 *
 * It does NOT invent data: every revision is built from the stored row. A row that
 * cannot produce canonical content is REPORTED, not guessed at. A row that already
 * has a revision is left exactly as it is (the pin writer is idempotent, so even
 * `--force` cannot rewrite history in place — it can only add a revision when the
 * stored content genuinely differs).
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/content-backfill-imported-versions.ts --dry-run
 *   node --conditions=react-server --import tsx scripts/content-backfill-imported-versions.ts --apply
 *
 * `CONTENT_BACKFILL_ACTOR_USER_ID` must name the owner/admin who is accountable for
 * the backfill: a revision always records who produced it.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  contentVersions,
  generalReadingPassages,
  generalReadingSets,
  listeningPackages,
  listeningTests,
  readingPassages,
  readingQuestions,
} from "../src/db/schema";
import { pinVersion } from "../src/lib/content/versions";

/** The database the backfill reads and writes through (the CLI uses the app's). */
export type BackfillDatabase = {
  select: typeof db.select;
  transaction: typeof db.transaction;
};

type Outcome = {
  module: "reading" | "listening";
  sourceRef: string;
  action: "created" | "unchanged" | "missing_source_ref" | "no_content";
  versionNo?: number;
  note?: string;
};

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const unknown = [...args].filter((arg) => !["--dry-run", "--apply", "--json"].includes(arg));
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  return { dryRun: !args.has("--apply"), json: args.has("--json") };
}

function actorId(): string {
  const id = process.env.CONTENT_BACKFILL_ACTOR_USER_ID;
  if (!id) throw new Error("CONTENT_BACKFILL_ACTOR_USER_ID is required (the actor a revision records).");
  return id;
}

/**
 * The Reading set as canonical content: what the learner actually reads.
 *
 * The set's passages live in `reading_passages` (joined through
 * `general_reading_passages`), with their questions in `reading_questions` — the
 * same rows the learner renderer reads, so the revision describes the real thing
 * rather than a summary of it.
 */
async function readingContent(database: BackfillDatabase, setId: string) {
  const links = await database
    .select({ link: generalReadingPassages, passage: readingPassages })
    .from(generalReadingPassages)
    .innerJoin(readingPassages, eq(readingPassages.id, generalReadingPassages.passageId))
    .where(eq(generalReadingPassages.setId, setId))
    .orderBy(generalReadingPassages.passageNo);
  if (!links.length) return null;
  const passages = [];
  for (const { link, passage } of links) {
    const questions = await database
      .select()
      .from(readingQuestions)
      .where(eq(readingQuestions.passageId, passage.id))
      .orderBy(readingQuestions.order);
    passages.push({
      passageNo: link.passageNo,
      title: passage.title,
      body: passage.bodyText,
      questions: questions.map((question) => ({
        questionNo: question.questionNo,
        typeCode: question.type,
        questionText: question.questionText,
        options: question.options ?? null,
        correctAnswer: question.correctAnswer,
        acceptedAnswers: question.acceptedAnswers ?? [],
        evidenceQuote: question.evidenceQuote ?? null,
        explanation: question.explanation ?? null,
      })),
    });
  }
  return { passages };
}

/**
 * The whole backfill, as one function: it reports what it found and (unless
 * `dryRun`) pins the missing revisions, reading only content that is already
 * stored. Idempotent: anything that already has a revision is reported unchanged.
 */
export async function backfillImportedVersions(
  database: BackfillDatabase,
  options: { dryRun: boolean; actorUserId: string },
): Promise<Outcome[]> {
  const { dryRun, actorUserId } = options;
  const outcomes: Outcome[] = [];

  // Reading — every set that has no revision yet.
  const sets = await database.select().from(generalReadingSets);
  for (const set of sets) {
    if (!set.sourceRef) {
      outcomes.push({ module: "reading", sourceRef: set.id, action: "missing_source_ref", note: "cannot be versioned without a stable source ref" });
      continue;
    }
    const existing = await database.select({ id: contentVersions.id }).from(contentVersions).where(eq(contentVersions.sourceRef, set.sourceRef)).limit(1);
    if (existing.length) {
      outcomes.push({ module: "reading", sourceRef: set.sourceRef, action: "unchanged", note: "already has a revision" });
      continue;
    }
    const content = await readingContent(database, set.id);
    if (!content) {
      outcomes.push({ module: "reading", sourceRef: set.sourceRef, action: "no_content", note: "no stored passages to version" });
      continue;
    }
    if (dryRun) {
      outcomes.push({ module: "reading", sourceRef: set.sourceRef, action: "created", note: "would pin revision 1" });
      continue;
    }
    const sourceRef = set.sourceRef;
    const setTitle = set.title;
    const state = (set.publicationState ?? "draft") as string;
    const pinned = await database.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef,
        title: setTitle,
        content,
        publicationState: state,
        actorUserId,
        targetType: "general_reading_set",
        targetId: set.id,
        provenance: { origin: "backfill", note: "canonical revision backfilled from the stored set" },
      }),
    );
    outcomes.push({ module: "reading", sourceRef: set.sourceRef, action: pinned.created ? "created" : "unchanged", versionNo: pinned.version.versionNo });
  }

  // Listening — the stored payload IS the canonical content.
  const packages = await database
    .select({ package: listeningPackages, test: listeningTests })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId));
  for (const row of packages) {
    const sourceRef = row.package.sourceId;
    if (!sourceRef) {
      outcomes.push({ module: "listening", sourceRef: row.test.id, action: "missing_source_ref", note: "cannot be versioned without a stable source ref" });
      continue;
    }
    const existing = await database.select({ id: contentVersions.id }).from(contentVersions).where(eq(contentVersions.sourceRef, sourceRef)).limit(1);
    if (existing.length) {
      outcomes.push({ module: "listening", sourceRef, action: "unchanged", note: "already has a revision" });
      continue;
    }
    if (!row.package.payload) {
      outcomes.push({ module: "listening", sourceRef, action: "no_content", note: "the stored payload is empty" });
      continue;
    }
    if (dryRun) {
      outcomes.push({ module: "listening", sourceRef, action: "created", note: "would pin revision 1" });
      continue;
    }
    const pinned = await database.transaction((tx) =>
      pinVersion(tx, {
        module: "listening",
        contentType: "full_test",
        sourceRef,
        title: row.test.title,
        content: row.package.payload,
        publicationState: row.test.publicationState ?? "draft",
        actorUserId,
        targetType: "listening_test",
        targetId: row.test.id,
        provenance: { origin: "backfill", note: "canonical revision backfilled from the stored package" },
      }),
    );
    outcomes.push({ module: "listening", sourceRef, action: pinned.created ? "created" : "unchanged", versionNo: pinned.version.versionNo });
  }

  return outcomes;
}

async function main() {
  const { dryRun, json } = parseArgs(process.argv.slice(2));
  const outcomes = await backfillImportedVersions(
    { select: (db.select as typeof db.select).bind(db), transaction: db.transaction.bind(db) },
    { dryRun, actorUserId: actorId() },
  );

  if (json) {
    console.log(JSON.stringify({ dryRun, outcomes }, null, 2));
  } else {
    for (const outcome of outcomes)
      console.log(`${outcome.module}\t${outcome.sourceRef}\t${outcome.action}${outcome.versionNo ? `\tv${outcome.versionNo}` : ""}${outcome.note ? `\t${outcome.note}` : ""}`);
    const counts = outcomes.reduce<Record<string, number>>((acc, outcome) => ({ ...acc, [outcome.action]: (acc[outcome.action] ?? 0) + 1 }), {});
    console.log(
      `${dryRun ? "DRY RUN — nothing was written. " : ""}${outcomes.length} item(s): ` +
        Object.entries(counts)
          .map(([action, count]) => `${action}=${count}`)
          .join(", "),
    );
  }
  if (dryRun) return;
}

// Only run the CLI when this file IS the entry point: importing it (from tests, or
// from another script) must not perform a backfill or demand an actor id.
if (process.argv[1] && process.argv[1].endsWith("content-backfill-imported-versions.ts")) void main();
