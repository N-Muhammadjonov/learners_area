import { sql, type SQL } from "drizzle-orm";
import type { ListeningPackage } from "./package";

/**
 * WHAT KIND OF LISTENING PRODUCT IS THIS? — the one classifier, from AUTHORED facts only.
 *
 * The owner separated three products that used to be mixed together:
 *
 *   • an **Academic Listening full test** — a real IELTS-style full test, offered at
 *     `/app/listening/academic/<testId>` with its activity hub;
 *   • a **General Listening section** — one standalone recording with its own questions,
 *     opened directly as ONE listening exercise, never behind an activity hub;
 *   • a **dedicated practice package** — MCQ training (`mcq`) or question-type practice
 *     (`question_types`) — legitimate content that is NOT an Academic full test and must
 *     not appear as one.
 *
 * A Listening full test may CONTAIN multiple-choice questions; that is a property of its
 * hub, not a licence to file a dedicated MCQ drill as a full test.
 *
 * Classification reads authored facts in a fixed order, and never a title:
 *
 *   1. the package's EXPLICIT practice identity — `mcq`, `question_types` or `essential`.
 *      These are deliberate product labels, and they outrank everything else: a dedicated
 *      MCQ training package is an MCQ training package even though the canonical importer
 *      stamps every imported package with `contentType: full_test` (see below);
 *   2. the package's authored `academic` / `general` collection — the canonical product
 *      label of a package, and the only thing that separates an imported ACADEMIC test from
 *      an imported GENERAL section (`src/lib/import/listening/canonical.ts` stamps both as
 *      `full_test`, so the stamp alone cannot tell them apart);
 *   3. a package with NO collection — a legacy canonical import. Compatibility is preserved
 *      only when its structure reliably proves a formal full test (four parts and forty
 *      questions); anything else is NOT classified by guesswork. The version stamp is
 *      deliberately ignored here: it is a generic import label, not proof of structure;
 *   4. NO package at all — the item was authored natively through the CMS, and the content
 *      type of its revision is the specific thing the author chose to file it as:
 *      `full_test` → an Academic full test, `section` → a General section (and the
 *      publication gate refuses a `full_test` revision that is not a complete test);
 *   5. nothing else is knowable → `unclassified`. Such a row is offered nowhere and is
 *      listed for owner review by `scripts/listening-classification-report.ts`.
 *
 * TWO EXPRESSIONS, ONE RULE. The catalogue reads run in SQL (a correlated subquery for the
 * newest version's content type), while a hub decides membership from an already-loaded
 * payload. Both are written from the SAME decision table below, and
 * `tests/listening-academic-hub.test.ts` (A11) drives BOTH across the same matrix of
 * cases and fails if they ever disagree — so there is exactly one rule, not two.
 */

export type ListeningProductKind =
  | "academic_full_test"
  | "general_section"
  | "mcq_programme"
  | "question_type_practice"
  | "essential_recording"
  | "unclassified";

/** The formal IELTS Listening structure the owner stated: four parts, forty questions. */
export const FORMAL_FULL_TEST_PARTS = 4;
export const FORMAL_FULL_TEST_QUESTIONS = 40;

/** The products that may appear in the Academic Listening catalogue. */
export const ACADEMIC_PRODUCT: ListeningProductKind = "academic_full_test";
/** The products that may appear in the General Listening catalogue. */
export const GENERAL_PRODUCT: ListeningProductKind = "general_section";

/** Everything the classifier needs, all of it authored or structural. */
export type ListeningProductFacts = {
  /** The content version's type for this item, when a version exists. */
  versionContentType?: string | null;
  /** The package's authored collection, when a package exists. */
  collection?: string | null;
  /** Does a canonical package exist for this item at all? */
  hasPackage: boolean;
  /** Parts (sections) the package authored, when known. */
  parts?: number | null;
  /** Questions the package authored, when known. */
  questions?: number | null;
};

/**
 * Collections that state an explicit PRACTICE identity. They are decided before anything
 * else, because they are the most specific thing a package can say about itself.
 */
const PRACTICE_COLLECTIONS: Record<string, ListeningProductKind> = {
  mcq: "mcq_programme",
  question_types: "question_type_practice",
  essential: "essential_recording",
};

/** The academic/general axis, as data: what a package's own label means. */
const COLLECTION_PRODUCTS: Record<string, ListeningProductKind> = {
  academic: "academic_full_test",
  general: "general_section",
  ...PRACTICE_COLLECTIONS,
};

/** How a version's content type maps to a product. */
const VERSION_PRODUCTS: Record<string, ListeningProductKind> = {
  full_test: "academic_full_test",
  section: "general_section",
};

/** The `collection` values that are explicitly NOT an Academic full test. */
const NON_ACADEMIC_COLLECTIONS = ["general", "mcq", "question_types", "essential"];

export function listeningProduct(facts: ListeningProductFacts): ListeningProductKind {
  const collection = facts.collection ?? "";

  // 1. An explicit practice identity is what the package IS. The importer's blanket
  //    `full_test` stamp must not promote a drill into the Academic catalogue.
  if (PRACTICE_COLLECTIONS[collection]) return PRACTICE_COLLECTIONS[collection]!;

  // 2. The package's own academic/general label: the only authored fact that distinguishes
  //    an imported academic test from an imported general section.
  if (collection === "academic") return "academic_full_test";
  if (collection === "general") return "general_section";

  // 3. A legacy canonical import without a collection: only a structure that proves the
  //    formal exam keeps its compatibility. A five-question drill is not promoted, and a
  //    generic import stamp is not proof.
  if (facts.hasPackage) {
    const formal =
      Number(facts.parts) === FORMAL_FULL_TEST_PARTS && Number(facts.questions) === FORMAL_FULL_TEST_QUESTIONS;
    return formal ? "academic_full_test" : "unclassified";
  }

  // 4. No package: the revision's own content type, chosen by whoever authored the item.
  const byVersion = VERSION_PRODUCTS[facts.versionContentType ?? ""];
  if (byVersion) return byVersion;

  // 5. Nothing about this row is authored classification.
  return "unclassified";
}

/** The facts of a LOADED package, with the version type resolved by the caller. */
export function packageProductFacts(p: ListeningPackage, versionContentType?: string | null): ListeningProductFacts {
  return {
    versionContentType,
    collection: p.collection ?? null,
    hasPackage: true,
    parts: (p.sections ?? []).length,
    questions: (p.questions ?? []).length,
  };
}

export function productOfPackage(p: ListeningPackage, versionContentType?: string | null): ListeningProductKind {
  return listeningProduct(packageProductFacts(p, versionContentType));
}

export function isAcademicFullTest(p: ListeningPackage, versionContentType?: string | null): boolean {
  return productOfPackage(p, versionContentType) === ACADEMIC_PRODUCT;
}

export function isGeneralSection(p: ListeningPackage, versionContentType?: string | null): boolean {
  return productOfPackage(p, versionContentType) === GENERAL_PRODUCT;
}

/* -------------------------------------------------------------------------- */
/* The same rule, as SQL                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The newest content version's type for a test row — `full_test`, `section`, or NULL when the
 * item was never filed through the CMS (a legacy row).
 */
export function versionTypeSql(testId: SQL | unknown): SQL<string | null> {
  return sql`(select v.content_type from content_versions v where v.module = 'listening' and v.target_id = ${testId} order by v.version_no desc limit 1)`;
}

/** The package's authored collection, or NULL when the row has no package / no collection. */
export function collectionSql(payload: SQL | unknown): SQL<string | null> {
  return sql`(${payload}->>'collection')`;
}

export function partsSql(payload: SQL | unknown): SQL<number> {
  return sql`coalesce(jsonb_array_length(${payload}->'sections'), 0)`;
}

export function questionsSql(payload: SQL | unknown): SQL<number> {
  return sql`coalesce(jsonb_array_length(${payload}->'questions'), 0)`;
}

/**
 * The decision table above, expressed for the database.
 *
 * `payloadIsNull` tells the expression whether a package exists at all, which is what
 * separates "a legacy import we can prove" from "a row with no authored classification".
 */
export function productSql(input: {
  testId: SQL | unknown;
  payload: SQL | unknown;
  payloadIsNull: SQL | unknown;
}): SQL<string> {
  const version = versionTypeSql(input.testId);
  const collection = collectionSql(input.payload);
  const parts = partsSql(input.payload);
  const questions = questionsSql(input.payload);
  return sql`case
    when ${collection} = 'mcq' then 'mcq_programme'
    when ${collection} = 'question_types' then 'question_type_practice'
    when ${collection} = 'essential' then 'essential_recording'
    when ${collection} = 'academic' then 'academic_full_test'
    when ${collection} = 'general' then 'general_section'
    when not (${input.payloadIsNull}) and ${parts} = ${FORMAL_FULL_TEST_PARTS} and ${questions} = ${FORMAL_FULL_TEST_QUESTIONS} then 'academic_full_test'
    when ${input.payloadIsNull} and ${version} = 'full_test' then 'academic_full_test'
    when ${input.payloadIsNull} and ${version} = 'section' then 'general_section'
    else 'unclassified'
  end`;
}

/** `where` fragment: this row is an Academic Listening full test. */
export function academicProductSql(input: { testId: SQL | unknown; payload: SQL | unknown; payloadIsNull: SQL | unknown }): SQL {
  return sql`${productSql(input)} = ${ACADEMIC_PRODUCT}`;
}

/** `where` fragment: this row is a standalone General Listening section. */
export function generalProductSql(input: { testId: SQL | unknown; payload: SQL | unknown; payloadIsNull: SQL | unknown }): SQL {
  return sql`${productSql(input)} = ${GENERAL_PRODUCT}`;
}

/* -------------------------------------------------------------------------- */
/* The library tab a card is filed under                                      */
/* -------------------------------------------------------------------------- */

/**
 * The tabs the Listening library can show — INCLUDING `uncatalogued`.
 *
 * The distinction matters: a row the classifier cannot prove is NOT an academic full test, and
 * the library used to label every such row `coalesce(collection, 'academic')`. That is the same
 * invented classification the owner forbade for the catalogue, in a second place. A card is
 * filed under the product the source actually IS, and a source that proves nothing lands in an
 * honest `uncatalogued` tab (which is only rendered when such a card exists).
 */
export const COLLECTION_TABS = ["essential", "academic", "general", "question_types", "mcq", "uncatalogued"] as const;
export type CollectionTab = (typeof COLLECTION_TABS)[number];

/** The ONE product → tab mapping, next to the ONE decision table above. */
export function collectionTabOf(product: ListeningProductKind): CollectionTab {
  switch (product) {
    case "academic_full_test":
      return "academic";
    case "general_section":
      return "general";
    case "mcq_programme":
      return "mcq";
    case "question_type_practice":
      return "question_types";
    case "essential_recording":
      return "essential";
    default:
      return "uncatalogued";
  }
}

/** The same mapping, expressed for a catalogue read (never a hard-coded collection). */
export function collectionTabSql(input: { testId: SQL | unknown; payload: SQL | unknown; payloadIsNull: SQL | unknown }): SQL<string> {
  return sql`case ${productSql(input)}
    when 'academic_full_test' then 'academic'
    when 'general_section' then 'general'
    when 'mcq_programme' then 'mcq'
    when 'question_type_practice' then 'question_types'
    when 'essential_recording' then 'essential'
    else 'uncatalogued'
  end`;
}

/** Named for the reader: the collections that never mean "Academic full test". */
export const nonAcademicCollections = NON_ACADEMIC_COLLECTIONS;

/* -------------------------------------------------------------------------- */
/* The formal full test, at publication time                                  */
/* -------------------------------------------------------------------------- */

/**
 * Does this content describe the formal IELTS Listening full test the owner stated?
 *
 * Called when a revision filed as `listening:full_test` is being PUBLISHED. Returned as a
 * sentence, because the person publishing must be told what to do instead (file it as a
 * Listening SECTION) rather than being handed a code.
 *
 * Only a revision that actually declares its questions is judged: a revision whose shape is
 * not knowable is never blocked on guesswork, and content that is already live is never
 * re-validated — historical tests are not rewritten to satisfy a new rule.
 */
export function fullTestStructureProblem(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const snapshot = content as { questions?: unknown; sections?: unknown };
  const questions = Array.isArray(snapshot.questions) ? snapshot.questions.length : null;
  if (questions === null) return null;
  if (questions !== FORMAL_FULL_TEST_QUESTIONS) {
    return `A formal Listening full test has ${FORMAL_FULL_TEST_QUESTIONS} questions; this revision has ${questions}. Publish it as a Listening section instead, or complete it before publishing.`;
  }
  const sections = Array.isArray(snapshot.sections) ? snapshot.sections.length : null;
  if (sections !== null && sections !== FORMAL_FULL_TEST_PARTS) {
    return `A formal Listening full test has ${FORMAL_FULL_TEST_PARTS} parts; this revision has ${sections}.`;
  }
  return null;
}
