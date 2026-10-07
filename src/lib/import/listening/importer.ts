import { and, desc, eq, ne } from "drizzle-orm";
import {
  contentImports,
  listeningAttempts,
  listeningPackages,
  listeningQuestions,
  listeningTests,
  resourceBlocks,
} from "@/db/schema";
import { attachClaimedAssets, type ResolvedAsset } from "../core/assets";
import type { ImportTransaction } from "../core/dry-run";
import { packageContentHash } from "../core/identity";
import { pinVersion } from "@/lib/content/versions";
import { provenanceRecord } from "../core/provenance";
import { issue, type ImportErrorCode, type ImportIssue } from "../core/validation";
import type { ListeningPackage } from "@/lib/listening/package";
import { listeningIdentityReviewNotes, listeningQuestionIdentity } from "@/lib/listening/question-identity";
import { ingestListeningOccurrences } from "@/lib/services/lexical/listening-occurrences";
import {
  LISTENING_CONTENT_TYPE,
  storedListeningPackageResult,
  type ListeningCanonicalPackage,
} from "./canonical";

/**
 * Listening canonical import.
 *
 * Everything a canonical Listening import writes happens in ONE transaction:
 * the test row, the canonical package, the question rows used by attempts and
 * MCQ mastery, the resource blocks that authorize private delivery, the claimed
 * uploads, the lexical occurrences and the import record. A failure anywhere
 * rolls the whole import back; the unclaimed finalized object is left for the
 * existing abandoned-upload cleanup.
 *
 * Idempotency is explicit, never incidental:
 *   • same sourceRef + same content hash → no write at all (`unchanged`)
 *   • same sourceRef + changed payload   → versioned update, audited
 *   • changed answer key with attempts   → refused unless the owner acknowledges
 *     the grade impact (historical assessment truth is never silently rewritten)
 */

export const LISTENING_IMPORT_VERSION = 1;

export type ListeningImportOptions = {
  actorUserId: string;
  assets: ResolvedAsset[];
  /** Explicit authorized publish action; import alone never publishes. */
  publish: boolean;
  publishAuthorized: boolean;
  originalFilename?: string;
  /** Owner/admin explicitly accepting that answer keys change for a used test. */
  acknowledgeGradeImpact?: boolean;
  /** Marks the compatibility path that still runs uploaded HTML. */
  legacyRuntime?: boolean;
  /**
   * Dry run: the caller rolls the transaction back. Reporting must be identical.
   */
  dryRun?: boolean;
};

export type ListeningImportCounts = {
  sections: number;
  questions: number;
  vocabulary: number;
  activities: number;
};

export type ListeningImportSuccess = {
  ok: true;
  action: "created" | "updated" | "unchanged";
  targetId: string;
  sourceRef: string;
  contentImportId: string | null;
  contentVersion: number;
  contentHash: string;
  publicationState: string;
  legacyRuntime: boolean;
  counts: ListeningImportCounts;
  warnings: string[];
  lexical?: { resolved: number; unresolved: number; skipped: boolean };
};

export type ListeningImportFailure = {
  ok: false;
  code: ImportErrorCode;
  report: { ok: false; issues: ImportIssue[]; warnings: ImportIssue[] };
  detail?: string;
};

export type ListeningImportOutcome = ListeningImportSuccess | ListeningImportFailure;

function failure(code: ImportErrorCode, entries: ImportIssue[], detail?: string): ListeningImportFailure {
  return { ok: false, code, report: { ok: false, issues: entries, warnings: [] }, ...(detail ? { detail } : {}) };
}

function countsFor(payload: ListeningPackage): ListeningImportCounts {
  return {
    sections: payload.sections.length,
    questions: payload.questions.length,
    vocabulary: payload.vocabulary.length,
    activities: payload.studyPack?.activities?.length ?? 0,
  };
}

/** The stored answer key of a question, in the form the grader compares. */
function answerKeyOf(payload: ListeningPackage) {
  return payload.questions
    .map((question) => `${question.number}:${question.key}:${question.alternatives.join("|")}:${question.pair.join("+")}`)
    .sort()
    .join("\n");
}

/**
 * The canonical rows of a package's questions, WITH their canonical identity.
 *
 * The storage type and the stored `type_code` both come from `listeningQuestionIdentity`, so a
 * question is filed as what it IS: a completion that carries a word bank stays a typed answer, a
 * map stays a map instead of becoming an MCQ, and a source that named its own type keeps it. The
 * review notes the identity reports are returned with the rows, because an under-specified source
 * must reach the staff who can confirm it rather than being silently smoothed over.
 */
async function questionRowsFor(testId: string, payload: ListeningPackage) {
  const rows = payload.questions.map((question) => {
    const identity = listeningQuestionIdentity({ kind: question.kind, typeCode: question.typeCode });
    return {
      testId,
      order: question.number,
      type: identity.storageType,
      typeCode: identity.typeCode,
      questionText: question.text,
      options: question.options,
      correctAnswer: question.options.find((option) => option === question.key || option.startsWith(`${question.key} `)) ?? question.key,
      explanation: question.evidence.why,
      review: identity.review,
    };
  });
  return rows;
}

/** The review notes of a payload's questions — the same implementation the staff preview uses. */
export function listeningReviewNotes(payload: ListeningPackage): string[] {
  return listeningIdentityReviewNotes(payload.questions);
}

/**
 * Question rows are reconciled by `order` instead of deleted and re-created:
 * `listening_answers` and `listening_mcq_sessions` reference these rows, so
 * re-inserting them would erase real learner history.
 */
export async function reconcileListeningQuestions(
  tx: ImportTransaction,
  testId: string,
  payload: ListeningPackage,
): Promise<string[]> {
  const existing = await tx.select().from(listeningQuestions).where(eq(listeningQuestions.testId, testId));
  const byOrder = new Map<number, (typeof existing)[number]>(existing.map((row) => [row.order, row]));
  const next = await questionRowsFor(testId, payload);
  const keep = new Set<string>();

  for (const row of next) {
    const { review: _review, ...stored } = row;
    const current = byOrder.get(row.order);
    if (!current) {
      await tx.insert(listeningQuestions).values(stored);
      continue;
    }
    keep.add(current.id);
    await tx
      .update(listeningQuestions)
      .set({
        type: stored.type,
        // The identity converges on re-import too: a row that was stored before its type could be
        // expressed is corrected to the canonical id rather than keeping a NULL for ever.
        typeCode: stored.typeCode,
        questionText: stored.questionText,
        options: stored.options,
        correctAnswer: stored.correctAnswer,
        explanation: stored.explanation,
      })
      .where(eq(listeningQuestions.id, current.id));
  }

  for (const row of existing) {
    if (keep.has(row.id)) continue;
    const used = await tx
      .select({ id: listeningAttempts.id })
      .from(listeningAttempts)
      .where(eq(listeningAttempts.testId, testId))
      .limit(1);
    if (used.length) continue; // never drop a question that learner history can point at
    await tx.delete(listeningQuestions).where(eq(listeningQuestions.id, row.id));
  }

  // What the source did not prove, for the staff who can confirm it.
  return listeningReviewNotes(payload);
}

async function latestImport(tx: ImportTransaction, sourceRef: string) {
  const rows = await tx
    .select()
    .from(contentImports)
    .where(
      and(
        eq(contentImports.module, "listening"),
        eq(contentImports.contentType, LISTENING_CONTENT_TYPE),
        eq(contentImports.sourceRef, sourceRef),
      ),
    )
    .orderBy(desc(contentImports.contentVersion))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Pin the canonical revision of a Listening test.
 *
 * One writer (`pinVersion`) for imported and authored Listening content alike, so
 * the same version-bound guarantees hold whichever door the content came through.
 */
async function pinListeningRevision(
  tx: ImportTransaction,
  input: {
    sourceRef: string;
    title: string;
    content: unknown;
    state: string;
    actorUserId: string;
    targetId: string;
    contentImportId: string | null;
    source: string;
  },
): Promise<void> {
  await pinVersion(tx as never, {
    module: "listening",
    contentType: LISTENING_CONTENT_TYPE,
    sourceRef: input.sourceRef,
    title: input.title,
    content: input.content,
    publicationState: input.state,
    actorUserId: input.actorUserId,
    targetType: "listening_test",
    targetId: input.targetId,
    contentImportId: input.contentImportId,
    provenance: { origin: "import", source: input.source, importId: input.contentImportId },
  });
}

export async function importCanonicalListeningPackage(
  tx: ImportTransaction,
  pkg: ListeningCanonicalPackage,
  options: ListeningImportOptions,
): Promise<ListeningImportOutcome> {
  /*
   * The stored payload, or the issues that prevent storing one. This is the canonical WRITE path, so it
   * may not throw either: a package that fails the domain rules must come back as an actionable
   * failure, not as an exception the route turns into a generic error.
   */
  const normalized = storedListeningPackageResult(pkg);
  if (!normalized.ok) return failure("semantic_invalid", normalized.issues);
  const payload = normalized.stored;
  const contentHash = packageContentHash(pkg);
  const audio = options.assets.find((asset) => asset.key === pkg.content.audio.assetKey);
  if (!audio)
    return failure("asset_missing", [
      issue(3, "asset_missing", "The package recording must be uploaded before it can be imported.", "assets"),
    ]);

  const warnings: string[] = [];
  const existing = await tx.query.listeningPackages.findFirst({ where: eq(listeningPackages.sourceId, payload.testId) });
  const previous = await latestImport(tx, payload.testId);

  /*
   * A DAY BELONGS TO ONE ITEM. 0052 refuses a second row for the same (programme, day), and this
   * check turns that database refusal into a sentence staff can act on instead of a raw constraint
   * error — with the existing day named, so "which item already claims DAY 6?" has an answer.
   *
   * An update of the SAME item is not a duplicate: the day relation may be corrected in place, and
   * `existing.testId` is excluded so a re-import of day 6 does not collide with itself.
   */
  const programme = payload.programme;
  if (programme) {
    /*
     * A day IS an MCQ item. The canonical validator already says so at the door staff use, and this
     * repeats it in the writer itself so no caller — a direct import, a script, a future route — can
     * create a day filed as an Academic test or a General section. The destination is a fact about
     * the package, never something a reader guesses later.
     */
    if (payload.collection !== "mcq")
      return failure("semantic_invalid", [
        issue(
          2,
          "semantic_invalid",
          `A day of the MCQ programme is authored as an MCQ item (collection "mcq"); this package says "${payload.collection ?? "academic"}".`,
          "content.collection",
        ),
      ]);
    const [claimed] = await tx
      .select({ id: listeningTests.id, title: listeningTests.title })
      .from(listeningTests)
      .where(
        and(
          eq(listeningTests.programRef, programme.ref),
          eq(listeningTests.programOrdinal, programme.day),
          existing ? ne(listeningTests.id, existing.testId) : undefined,
        ),
      )
      .limit(1);
    if (claimed)
      return failure("source_conflict", [
        issue(
          4,
          "source_conflict",
          `Day ${programme.day} of ${programme.ref} is already item "${claimed.title}". Import this material under another day, or update the day it belongs to.`,
          "content.programme.day",
        ),
      ]);
  }

  if (existing && previous?.contentHash === contentHash) {
    const [current] = await tx
      .select({ publicationState: listeningTests.publicationState })
      .from(listeningTests)
      .where(eq(listeningTests.id, existing.testId));
    return {
      ok: true,
      action: "unchanged",
      targetId: existing.testId,
      sourceRef: payload.testId,
      contentImportId: previous.id,
      contentVersion: previous.contentVersion,
      contentHash,
      publicationState: current?.publicationState ?? "draft",
      legacyRuntime: existing.legacyRuntime,
      counts: countsFor(payload),
      warnings: ["This exact package was already imported; nothing was written."],
    };
  }

  const now = new Date();
  const desiredState = options.publish && options.publishAuthorized ? "published" : "draft";
  const importRecordBase = {
    module: "listening",
    contentType: LISTENING_CONTENT_TYPE,
    schemaVersion: pkg.schemaVersion,
    importVersion: LISTENING_IMPORT_VERSION,
    sourceRef: payload.testId,
    contentHash,
    contentVersion: (previous?.contentVersion ?? 0) + 1,
    actorUserId: options.actorUserId,
    originalFilename: options.originalFilename ?? pkg.provenance.originalFilename ?? null,
    legacyRuntime: false,
    assets: options.assets.map((asset) => ({
      key: asset.key,
      role: asset.role,
      objectKey: asset.objectKey,
      mimeType: asset.mimeType,
      size: asset.size,
    })),
    provenance: provenanceRecord(pkg, options.actorUserId, now),
    note: null,
    createdAt: now,
  };

  if (existing) {
    const current = await tx
      .select({ test: listeningTests, pkg: listeningPackages })
      .from(listeningPackages)
      .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
      .where(eq(listeningPackages.testId, existing.testId));
    const row = current[0];
    if (!row) return failure("unknown", [issue(4, "unknown", "The existing package row could not be read.")]);

    const attempts = await tx
      .select({ id: listeningAttempts.id })
      .from(listeningAttempts)
      .where(eq(listeningAttempts.testId, existing.testId))
      .limit(1);
    const answerChanged = answerKeyOf(row.pkg.payload) !== answerKeyOf(payload);
    if (answerChanged && attempts.length && !options.acknowledgeGradeImpact)
      return failure("source_conflict", [
        issue(
          4,
          "source_conflict",
          "This test already has learner attempts, and the imported package changes the answer key. " +
            "Import it as a new sourceRef, or confirm that historical grades may change.",
          "content.questions",
        ),
      ]);

    await tx
      .update(listeningTests)
      .set({
        title: payload.title,
        transcript: payload.sections.map((section) => section.transcript).join("\n\n"),
        audioUrl: `/api/resources/${audio.objectKey}`,
        /*
         * The programme relation is written when the package states one, and otherwise LEFT AS IT IS:
         * an import that does not mention the programme must never silently detach an authored day.
         */
        ...(programme ? { programRef: programme.ref, programOrdinal: programme.day } : {}),
        // A published test is never silently unpublished by an import.
        publicationState: desiredState === "published" ? "published" : row.test.publicationState,
      })
      .where(eq(listeningTests.id, existing.testId));
    await tx
      .update(listeningPackages)
      .set({
        payload,
        audioObjectKey: audio.objectKey,
        imageObjectKey: options.assets.find((asset) => asset.role === "image")?.objectKey ?? null,
        sourceHash: contentHash,
        legacyRuntime: false,
      })
      .where(eq(listeningPackages.testId, existing.testId));
    warnings.push(...(await reconcileListeningQuestions(tx, existing.testId, payload)));
    await attachClaimedAssets(tx, options.assets);
    const [record] = await tx
      .insert(contentImports)
      .values({
        ...importRecordBase,
        status: "updated",
        targetType: "listening_test",
        targetId: existing.testId,
        result: { action: "updated", counts: countsFor(payload), answerChanged, acknowledgedGradeImpact: Boolean(options.acknowledgeGradeImpact) },
      })
      .returning();
    // Lexical enrichment shares the transaction on purpose: a test is never live
    // with authored vocabulary that points at no checked sense. A failure here
    // aborts the whole import rather than leaving a half-linked vocabulary.
    const lexical = await ingestListeningOccurrences(tx, existing.testId, payload);
    // The revision records what the learner is graded against, so a re-import that
    // changed the material is a NEW revision rather than a silent rewrite: attempts
    // bound to the previous one stay interpretable (§71/§72).
    await pinListeningRevision(tx, {
      sourceRef: payload.testId,
      title: payload.title,
      content: payload,
      state: desiredState === "published" ? "published" : row.test.publicationState,
      actorUserId: options.actorUserId,
      targetId: existing.testId,
      contentImportId: record?.id ?? null,
      source: pkg.provenance.source,
    });
    return {
      ok: true,
      action: "updated",
      targetId: existing.testId,
      sourceRef: payload.testId,
      contentImportId: record?.id ?? null,
      contentVersion: importRecordBase.contentVersion,
      contentHash,
      publicationState: desiredState === "published" ? "published" : row.test.publicationState,
      legacyRuntime: false,
      counts: countsFor(payload),
      warnings,
      lexical: { resolved: lexical.resolved, unresolved: lexical.unresolved, skipped: false },
    };
  }

  const [test] = await tx
    .insert(listeningTests)
    .values({
      title: payload.title,
      createdByUserId: options.actorUserId,
      audioType: "audio",
      publicationState: desiredState,
      transcript: payload.sections.map((section) => section.transcript).join("\n\n"),
      audioUrl: `/api/resources/${audio.objectKey}`,
      // The programme relation, when the package IS a day (0052). NULL for everything else.
      programRef: programme?.ref ?? null,
      programOrdinal: programme?.day ?? null,
    })
    .returning();
  if (!test) return failure("unknown", [issue(4, "unknown", "The Listening test row could not be created.")]);

  await tx.insert(listeningPackages).values({
    testId: test.id,
    sourceId: payload.testId,
    payload,
    audioObjectKey: audio.objectKey,
    imageObjectKey: options.assets.find((asset) => asset.role === "image")?.objectKey ?? null,
    sourceHash: contentHash,
    legacyRuntime: false,
  });

  const rows = await questionRowsFor(test.id, payload);
  if (rows.length) await tx.insert(listeningQuestions).values(rows.map(({ review: _review, ...stored }) => stored));
  // What the source did not prove goes to the staff who can confirm it (Q numbers included).
  warnings.push(...listeningReviewNotes(payload));

  await tx.insert(resourceBlocks).values(
    options.assets.map((asset, position) => ({
      ownerType: "listening" as const,
      ownerId: test.id,
      position,
      type: asset.role === "audio" ? ("audio" as const) : asset.role === "image" ? ("image" as const) : ("file" as const),
      objectKey: asset.objectKey,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      createdByUserId: options.actorUserId,
    })),
  );

  await attachClaimedAssets(tx, options.assets);

  const [record] = await tx
    .insert(contentImports)
    .values({
      ...importRecordBase,
      status: "created",
      targetType: "listening_test",
      targetId: test.id,
      result: { action: "created", counts: countsFor(payload), publicationState: desiredState },
    })
    .returning();

  const lexical = await ingestListeningOccurrences(tx, test.id, payload);

  await pinListeningRevision(tx, {
    sourceRef: payload.testId,
    title: payload.title,
    content: payload,
    state: desiredState,
    actorUserId: options.actorUserId,
    targetId: test.id,
    contentImportId: record?.id ?? null,
    source: pkg.provenance.source,
  });

  return {
    ok: true,
    action: "created",
    targetId: test.id,
    sourceRef: payload.testId,
    contentImportId: record?.id ?? null,
    contentVersion: importRecordBase.contentVersion,
    contentHash,
    publicationState: desiredState,
    legacyRuntime: false,
    counts: countsFor(payload),
    warnings,
    lexical: { resolved: lexical.resolved, unresolved: lexical.unresolved, skipped: false },
  };
}

/**
 * Compatibility path: material that still needs the sandboxed authored frame.
 * It records the same import provenance with `legacyRuntime: true` so the
 * remaining legacy count is a query, not a guess — and it is never created by
 * the canonical importer.
 */
export async function importLegacyListeningRuntime(
  tx: ImportTransaction,
  payload: ListeningPackage,
  options: ListeningImportOptions,
): Promise<ListeningImportOutcome> {
  if (!payload.authoredRuntime)
    return failure("invalid_input", [issue(1, "invalid_input", "This is not a legacy authored package.")]);
  /*
   * A programme DAY is native material: its five questions are canonical rows the staged drill and
   * the day's navigation read. Importing one through the legacy authored-runtime path would create a
   * day whose questions live in an HTML bundle, so it is refused in words rather than quietly
   * stripped of its programme relation.
   */
  if (payload.programme)
    return failure("invalid_input", [
      issue(1, "invalid_input", "A day of the MCQ programme is imported as a canonical package, not as legacy authored material.", "content.programme"),
    ]);
  const audio = options.assets.find((asset) => asset.role === "audio");
  if (!audio)
    return failure("asset_missing", [
      issue(3, "asset_missing", "The package recording must be uploaded before it can be imported.", "assets"),
    ]);
  const existing = await tx.query.listeningPackages.findFirst({ where: eq(listeningPackages.sourceId, payload.testId) });
  if (existing)
    return failure("source_already_imported", [
      issue(4, "source_already_imported", "This source identity has already been imported.", "sourceRef"),
    ]);

  const now = new Date();
  const contentHash = packageContentHash({ module: "listening", contentType: "legacy_runtime", content: payload.keyword1.length ? payload.keyword1 : payload.sections });
  const [test] = await tx
    .insert(listeningTests)
    .values({
      title: payload.title,
      createdByUserId: options.actorUserId,
      audioType: "audio",
      publicationState: options.publish && options.publishAuthorized ? "published" : "draft",
      transcript: payload.sections.map((section) => section.transcript).join("\n\n"),
      audioUrl: `/api/resources/${audio.objectKey}`,
    })
    .returning();
  if (!test) return failure("unknown", [issue(4, "unknown", "The Listening test row could not be created.")]);

  await tx.insert(listeningPackages).values({
    testId: test.id,
    sourceId: payload.testId,
    payload: { ...payload, legacyRuntime: true },
    audioObjectKey: audio.objectKey,
    imageObjectKey: options.assets.find((asset) => asset.role === "image")?.objectKey ?? null,
    sourceHash: contentHash,
    legacyRuntime: true,
  });
  await tx.insert(resourceBlocks).values(
    options.assets.map((asset, position) => ({
      ownerType: "listening" as const,
      ownerId: test.id,
      position,
      type: asset.role === "audio" ? ("audio" as const) : asset.role === "image" ? ("image" as const) : ("file" as const),
      objectKey: asset.objectKey,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      createdByUserId: options.actorUserId,
    })),
  );
  await attachClaimedAssets(tx, options.assets);
  const [record] = await tx
    .insert(contentImports)
    .values({
      module: "listening",
      contentType: "legacy_runtime",
      schemaVersion: 1,
      importVersion: LISTENING_IMPORT_VERSION,
      sourceRef: payload.testId,
      contentHash,
      contentVersion: 1,
      status: "created",
      targetType: "listening_test",
      targetId: test.id,
      actorUserId: options.actorUserId,
      originalFilename: options.originalFilename ?? null,
      legacyRuntime: true,
      assets: options.assets.map((asset) => ({
        key: asset.key,
        role: asset.role,
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        size: asset.size,
      })),
      provenance: {
        source: "legacy_conversion",
        sourceRef: payload.testId,
        module: "listening",
        contentType: "legacy_runtime",
        schemaVersion: 1,
        originalFilename: options.originalFilename ?? null,
        importedAt: now.toISOString(),
        importedBy: options.actorUserId,
      },
      result: { action: "created", legacyRuntime: true, questions: payload.questions.length },
      note: "Retained authored runtime; conversion to canonical data is pending owner review.",
      createdAt: now,
    })
    .returning();

  return {
    ok: true,
    action: "created",
    targetId: test.id,
    sourceRef: payload.testId,
    contentImportId: record?.id ?? null,
    contentVersion: 1,
    contentHash,
    publicationState: options.publish && options.publishAuthorized ? "published" : "draft",
    legacyRuntime: true,
    counts: countsFor(payload),
    warnings: ["This material still uses the legacy authored runtime; its conversion is pending."],
  };
}
