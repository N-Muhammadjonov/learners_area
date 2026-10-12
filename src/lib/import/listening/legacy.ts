import { and, desc, eq } from "drizzle-orm";
import { contentImports, listeningPackages, listeningTests } from "@/db/schema";
import type { HtmlDocumentReader } from "@/lib/listening/source-parser";
import { convertLegacyPackage } from "@/lib/listening/source-parser";
import { listeningPackageSchema, type ListeningPackage } from "@/lib/listening/package";
import type { ImportTransaction } from "../core/dry-run";
import { packageContentHash } from "../core/identity";
import { issue } from "../core/validation";
import { validateCanonicalListeningPackage, type ListeningCanonicalPackage } from "./canonical";
import { reconcileListeningQuestions, LISTENING_IMPORT_VERSION } from "./importer";

/**
 * Legacy Listening conversion — from uploaded executable HTML to canonical data.
 *
 * SAFE BY CONSTRUCTION: extraction is inert. Only JSON literals and DOM text are
 * read (`convertLegacyPackage` documents the same rule), no script is evaluated,
 * no CSS is interpreted, no event handler runs. When extraction is ambiguous the
 * conversion STOPS and reports exactly what could not be mapped — a fake success
 * would be worse than a manual review.
 */

export type LegacyClassification =
  | "CANONICAL_NATIVE"
  | "CONVERTIBLE_LEGACY"
  | "LEGACY_REQUIRES_REVIEW"
  | "INVALID";

export type LegacyScan = {
  classification: LegacyClassification;
  hasAuthoredRuntime: boolean;
  reasons: string[];
  questions: number;
  sections: number;
  transcripts: number;
  runtimeFiles: string[];
};

export type ConversionOutcome =
  | {
      ok: true;
      package: ListeningCanonicalPackage;
      report: { questions: number; sections: number; transcripts: number; runtimeFiles: string[]; notes: string[] };
    }
  | {
      ok: false;
      classification: "LEGACY_REQUIRES_REVIEW";
      reasons: string[];
      unsupported: string[];
      runtimeFiles: string[];
    };

/** Structural classification of one stored Listening package (never by title). */
export function classifyListeningPayload(payload: ListeningPackage): LegacyScan {
  const parsed = listeningPackageSchema.safeParse(payload);
  const runtimeFiles = payload.authoredRuntime ? Object.keys(payload.authoredRuntime.files).sort() : [];
  const base = {
    hasAuthoredRuntime: Boolean(payload.authoredRuntime),
    questions: payload.questions.length,
    sections: payload.sections.length,
    transcripts: payload.sections.filter((section) => section.transcript.trim()).length,
    runtimeFiles,
  };
  if (!parsed.success)
    return { ...base, classification: "INVALID", reasons: parsed.error.issues.slice(0, 5).map((entry) => entry.message) };
  if (!payload.authoredRuntime) {
    if (!payload.questions.length)
      return { ...base, classification: "INVALID", reasons: ["Canonical package contains no questions."] };
    return { ...base, classification: "CANONICAL_NATIVE", reasons: [] };
  }
  const reasons: string[] = ["Package still carries an authored runtime (uploaded HTML/CSS/JS)."];
  const entry = payload.authoredRuntime.entryPath;
  if (!entry || !payload.authoredRuntime.files[entry]) reasons.push("The runtime entry document is missing from the package.");
  return {
    ...base,
    classification: reasons.length > 1 ? "LEGACY_REQUIRES_REVIEW" : "CONVERTIBLE_LEGACY",
    reasons,
  };
}

/** Semantic comparison between the authored runtime and the extracted data. */
function extractionProblems(payload: ListeningPackage, extracted: ListeningPackage, read: HtmlDocumentReader): string[] {
  const problems: string[] = [];
  const files = payload.authoredRuntime?.files ?? {};
  const entry = payload.authoredRuntime?.entryPath;
  if (!entry || !files[entry]) return ["Runtime entry document is missing."];

  // Every answer control the author placed must have become a canonical question.
  const doc = read(files[entry]!);
  const controls = new Set<string>();
  doc.querySelectorAll("input,select,textarea").forEach((node) => {
    const id = node.id || node.getAttribute("name") || "";
    const match = /^l(\d+)$/.exec(id.trim());
    if (match) controls.add(match[1]!);
  });
  const extractedNumbers = new Set(extracted.questions.map((question) => String(question.number)));
  const unmapped = [...controls].filter((number) => !extractedNumbers.has(number)).sort((a, b) => Number(a) - Number(b));
  if (unmapped.length) problems.push(`Answer controls with no extracted question: ${unmapped.join(", ")}.`);
  if (!extracted.questions.length) problems.push("No questions could be extracted.");
  for (const question of extracted.questions) {
    if (!question.key.trim()) problems.push(`Q${question.number}: no answer key could be read.`);
    if (question.evidence.at <= 0) problems.push(`Q${question.number}: no evidence timestamp could be read.`);
  }
  return problems;
}

/**
 * Converts one legacy runtime package into a canonical package. The extractor is
 * the existing inert legacy parser; this function only decides whether the result
 * is trustworthy enough to become canonical data.
 */
export function convertLegacyRuntimePackage(
  payload: ListeningPackage,
  read: HtmlDocumentReader,
): ConversionOutcome {
  const runtime = payload.authoredRuntime;
  const runtimeFiles = runtime ? Object.keys(runtime.files).sort() : [];
  if (!runtime || !runtime.files[runtime.entryPath])
    return {
      ok: false,
      classification: "LEGACY_REQUIRES_REVIEW",
      reasons: ["The package has no readable runtime entry document."],
      unsupported: ["authoredRuntime.entryPath"],
      runtimeFiles,
    };

  let extracted: ListeningPackage;
  try {
    extracted = convertLegacyPackage(runtime.files, payload.audio.durationSec, read, { audioPath: payload.audio.path });
  } catch (error) {
    return {
      ok: false,
      classification: "LEGACY_REQUIRES_REVIEW",
      reasons: [error instanceof Error ? error.message : "The runtime document could not be parsed."],
      unsupported: ["embedded question/answer structures that the inert extractor does not recognise"],
      runtimeFiles,
    };
  }

  const problems = extractionProblems(payload, extracted, read);
  if (problems.length)
    return {
      ok: false,
      classification: "LEGACY_REQUIRES_REVIEW",
      reasons: problems,
      unsupported: [...new Set(problems.map((problem) => problem.split(":")[0]!))],
      runtimeFiles,
    };

  const converted = validateCanonicalListeningPackage({
    schemaVersion: 2,
    module: "listening",
    contentType: "full_test",
    sourceRef: payload.testId,
    title: payload.title,
    language: "en",
    provenance: {
      source: "legacy_conversion",
      note: `Converted from the authored runtime (${runtime.entryPath}); the original upload is retained as source evidence.`,
      ...(payload.provenance ? { attribution: payload.provenance } : {}),
    },
    publication: { state: "draft" },
    assets: [
      {
        key: "audio.full",
        role: "audio",
        required: true,
        mimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/webm", "audio/flac"],
        maxBytes: 200 * 1024 * 1024,
        path: payload.audio.path,
      },
      ...(payload.imagePath
        ? [
            {
              key: "image.map",
              role: "image" as const,
              required: true,
              mimeTypes: ["image/png", "image/jpeg", "image/webp"],
              maxBytes: 20 * 1024 * 1024,
              path: payload.imagePath,
            },
          ]
        : []),
    ],
    content: {
      collection: payload.collection ?? "academic",
      audio: { durationSec: payload.audio.durationSec, assetKey: "audio.full", path: payload.audio.path },
      image: payload.imagePath ? { assetKey: "image.map" } : null,
      imagePath: payload.imagePath,
      mapDiagram: payload.mapDiagram,
      sections: payload.sections,
      questions: extracted.questions,
      keyword1: extracted.keyword1,
      keyword2: extracted.keyword2,
      vocabulary: payload.vocabulary,
      studyPack: payload.studyPack,
    },
  });
  if (!converted.ok)
    return {
      ok: false,
      classification: "LEGACY_REQUIRES_REVIEW",
      reasons: converted.issues.map((entry) => entry.message),
      unsupported: ["converted data failed canonical validation"],
      runtimeFiles,
    };

  return {
    ok: true,
    package: converted.pkg,
    report: {
      questions: extracted.questions.length,
      sections: extracted.sections.length,
      transcripts: extracted.sections.filter((section) => section.transcript.trim()).length,
      runtimeFiles,
      notes: [
        `Extracted ${extracted.questions.length} questions from ${runtime.entryPath}.`,
        "The original runtime files remain in the package record as source evidence.",
      ],
    },
  };
}

export type ConversionWriteResult =
  | { ok: true; testId: string; contentHash: string; questions: number; contentImportId: string | null }
  | { ok: false; error: string };

/**
 * Writes an APPROVED conversion: same rows, same ids, same publication state —
 * only the payload becomes canonical and the legacy marker clears. Question rows
 * are reconciled (never re-created) so attempt history survives.
 */
export async function applyListeningConversion(
  tx: ImportTransaction,
  input: { testId: string; actorUserId: string; package: ListeningCanonicalPackage; note?: string },
): Promise<ConversionWriteResult> {
  const rows = await tx
    .select({ test: listeningTests, pkg: listeningPackages })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(eq(listeningPackages.testId, input.testId));
  const row = rows[0];
  if (!row) return { ok: false, error: "not_found" };

  const canonical = validateCanonicalListeningPackage(input.package);
  if (!canonical.ok) return { ok: false, error: canonical.issues[0]?.message ?? "invalid" };

  const payload = canonical.stored;
  const contentHash = packageContentHash(input.package);
  await tx
    .update(listeningPackages)
    .set({ payload, sourceHash: contentHash, legacyRuntime: false })
    .where(eq(listeningPackages.testId, input.testId));
  await tx
    .update(listeningTests)
    .set({ transcript: payload.sections.map((section) => section.transcript).join("\n\n") })
    .where(eq(listeningTests.id, input.testId));
  await reconcileListeningQuestions(tx, input.testId, payload);

  const previous = await tx
    .select()
    .from(contentImports)
    .where(
      and(
        eq(contentImports.module, "listening"),
        eq(contentImports.contentType, "full_test"),
        eq(contentImports.sourceRef, payload.testId),
      ),
    )
    .orderBy(desc(contentImports.contentVersion))
    .limit(1);

  const [record] = await tx
    .insert(contentImports)
    .values({
      module: "listening",
      contentType: "full_test",
      schemaVersion: input.package.schemaVersion,
      importVersion: LISTENING_IMPORT_VERSION,
      sourceRef: payload.testId,
      contentHash,
      contentVersion: (previous[0]?.contentVersion ?? 0) + 1,
      status: "converted",
      targetType: "listening_test",
      targetId: input.testId,
      actorUserId: input.actorUserId,
      originalFilename: input.package.provenance.originalFilename ?? null,
      legacyRuntime: false,
      assets: [],
      provenance: {
        source: "legacy_conversion",
        sourceRef: payload.testId,
        module: "listening",
        contentType: "full_test",
        schemaVersion: input.package.schemaVersion,
        importedAt: new Date().toISOString(),
        importedBy: input.actorUserId,
      },
      result: { action: "converted", questions: payload.questions.length, previousPublication: row.test.publicationState },
      note: input.note ?? "Legacy authored runtime converted to canonical Listening data.",
    })
    .returning();

  return {
    ok: true,
    testId: input.testId,
    contentHash,
    questions: payload.questions.length,
    contentImportId: record?.id ?? null,
  };
}

export const legacyReviewIssue = (message: string) => issue(4, "legacy_requires_review", message);
