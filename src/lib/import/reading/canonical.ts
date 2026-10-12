import { z } from "zod";
import { generalReadingBundle } from "@/lib/reading/import-schema";
import type { CanonicalPackage } from "../core/envelope";
import { defineContentType, type ContentTypeDescriptor } from "../core/registry";
import { issue, type ImportIssue } from "../core/validation";
import { describeProvenance } from "../core/provenance";

/**
 * Reading — canonical package.
 *
 * Reading already had the architectural precedent this framework generalizes:
 * a structured bundle, a strict schema, a transactional idempotent importer and
 * a native renderer. The canonical package therefore REUSES `generalReadingBundle`
 * for its content (`omit` of the three envelope-owned fields, so nothing is
 * weakened or duplicated) and keeps the same importer.
 *
 * No assets are declared: Reading content is JSON. Its binaries, when any exist,
 * stay supplemental materials through the existing upload lifecycle.
 */

export const READING_CANONICAL_VERSION = 1;
export const READING_CONTENT_TYPE = "general_set";

export const readingSetContentSchema = generalReadingBundle.omit({ sourceRef: true, title: true, publish: true }).strict();
export type ReadingSetContent = z.infer<typeof readingSetContentSchema>;

export type ReadingCanonicalPackage = CanonicalPackage<ReadingSetContent>;

/** Level-2 semantics: numbering that the runtime and the renderer both depend on. */
export function readingSemanticIssues(pkg: ReadingCanonicalPackage): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const numbers = new Set<number>();
  for (const passage of pkg.content.passages) {
    if (numbers.has(passage.passageNo))
      issues.push(issue(2, "semantic_invalid", `Passage ${passage.passageNo} is declared twice.`, "content.passages"));
    numbers.add(passage.passageNo);
    const questionNos = passage.questions.map((question) => question.questionNo);
    if (new Set(questionNos).size !== questionNos.length)
      issues.push(
        issue(
          2,
          "semantic_invalid",
          `Passage ${passage.passageNo}: question numbers must be unique.`,
          "content.passages",
        ),
      );
    for (const question of passage.questions) {
      if (question.type === "multiple_choice" && (question.options?.length ?? 0) < 2)
        issues.push(
          issue(
            2,
            "semantic_invalid",
            `Passage ${passage.passageNo} Q${question.questionNo}: a multiple-choice question needs at least two options.`,
            "content.passages",
          ),
        );
      if (question.evidence && !passage.body.includes(question.evidence))
        issues.push(
          issue(
            2,
            "semantic_invalid",
            `Passage ${passage.passageNo} Q${question.questionNo}: the evidence quote is not present in the passage text.`,
            "content.passages",
            false,
          ),
        );
    }
  }
  return issues;
}

export function readingPreview(pkg: ReadingCanonicalPackage) {
  const passages = pkg.content.passages;
  const questions = passages.reduce((total, passage) => total + passage.questions.length, 0);
  const vocabulary = passages.reduce((total, passage) => total + passage.vocabulary.length, 0);
  return {
    title: pkg.title,
    lines: [
      { label: "Source identity", value: pkg.sourceRef },
      { label: "Passages", value: String(passages.length) },
      { label: "Questions", value: String(questions) },
      { label: "Vocabulary items", value: String(vocabulary) },
      { label: "Level", value: pkg.content.level ?? "not set" },
      { label: "Publication intent", value: pkg.publication.state },
      { label: "Provenance", value: describeProvenance(pkg) },
    ],
    warnings: passages.some((passage) => !passage.questions.length)
      ? ["At least one passage has no questions: it imports as reading material only."]
      : [],
  };
}

export function readingTemplate() {
  return {
    schemaVersion: READING_CANONICAL_VERSION,
    module: "reading",
    contentType: READING_CONTENT_TYPE,
    sourceRef: "general-reading-example",
    title: "General Reading Example",
    language: "en",
    provenance: { source: "teacher_authored" },
    publication: { state: "draft" },
    assets: [],
    content: {
      description: "Short description shown on the set card.",
      level: "B1",
      passages: [
        {
          passageNo: 1,
          title: "Passage title",
          body: "The full passage text goes here.",
          questions: [
            {
              questionNo: 1,
              type: "short_answer",
              text: "What is the passage mainly about?",
              answer: "A short answer",
              accepted: ["short answer"],
              evidence: "The full passage text goes here.",
              explanation: "Optional explanation shown after checking.",
            },
          ],
          vocabulary: [
            { word: "passage", pos: "noun", def: "A section of a text.", uz: "", ex: "The full passage text goes here." },
          ],
        },
      ],
    },
  };
}

export const readingSetDescriptor = defineContentType({
  module: "reading",
  contentType: READING_CONTENT_TYPE,
  schemaVersion: READING_CANONICAL_VERSION,
  label: "General Reading set",
  status: "active",
  contentSchema: readingSetContentSchema,
  // Version 1 of a Reading package IS the existing authored bundle.
  migratableVersions: [1],
  upgrade: upgradeReadingBundle,
  semanticIssues: readingSemanticIssues,
  requiredAssets: () => [],
  preview: readingPreview,
  template: readingTemplate,
} satisfies ContentTypeDescriptor<ReadingSetContent>);

/** The existing bundle → the shared envelope. Same bundle, same importer, same ids. */
export function upgradeReadingBundle(fromVersion: number, raw: unknown): unknown {
  if (fromVersion !== 1) throw new Error(`Unsupported Reading package version: ${fromVersion}`);
  const bundle = generalReadingBundle.parse(raw);
  return {
    schemaVersion: READING_CANONICAL_VERSION,
    module: "reading",
    contentType: READING_CONTENT_TYPE,
    sourceRef: bundle.sourceRef,
    title: bundle.title,
    language: "en",
    provenance: { source: "teacher_authored", note: "Imported from an authored Reading bundle (version 1)." },
    publication: { state: bundle.publish ? "published" : "draft" },
    assets: [],
    content: {
      ...(bundle.description !== undefined ? { description: bundle.description } : {}),
      ...(bundle.level !== undefined ? { level: bundle.level } : {}),
      passages: bundle.passages,
    },
  };
}
