import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, generalReadingPassages, generalReadingSets, lexicalOccurrences, readingPassageParagraphs, readingPassages, readingQuestionGroups, readingQuestions, users } from "@/db/schema";
import { pinVersion } from "@/lib/content/versions";
import { isStaff } from "@/lib/auth/roles";
import { withReadingFeedback } from "@/lib/reading/feedback";
import { isUnstatedAnswer } from "@/lib/reading/unstated";
import { readingQuestionDescriptor } from "@/lib/reading/question-model";

export type ReadingSourceRevision = {
  revision: string;
  passageId: string;
  bodySha256: string;
  corrections: {
    questionId: string;
    before: { text: string; answer: string };
    after: { text: string; answer: string; evidence: string | null; explanation: string };
    referenceUrl: string;
  }[];
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function revisionId(revision: string, kind: string, id: string) {
  const bytes = createHash("sha256").update(`learners-area-reading-revision:${revision}:${kind}:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Replace only the current catalogue slot with a new source copy. Old questions,
 * answers, assessment membership and General progress remain on their original
 * IDs. A live assessment can finish its original version; its key never changes.
 * The set ID is retained so completion and sequential unlocking are preserved.
 * Caller must supply an authenticated staff identity. No client route exposes it.
 */
export async function reviseReadingSource(input: ReadingSourceRevision, actorUserId: string, executor: typeof db = db) {
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(input.revision) || !input.corrections.length
    || new Set(input.corrections.map(c => c.questionId)).size !== input.corrections.length) throw Error("invalid_source_revision");
  const nextId = revisionId(input.revision, "passage", input.passageId);
  return executor.transaction(async tx => {
    const actor = await tx.query.users.findFirst({ where: eq(users.id, actorUserId), columns: { role: true } });
    if (!actor || !isStaff(actor.role)) throw Error("source_revision_forbidden");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"reading-source-revision:" + input.passageId}))`);
    const [original] = await tx.select().from(readingPassages).where(eq(readingPassages.id, input.passageId)).limit(1).for("update");
    if (!original || hash(original.bodyText) !== input.bodySha256) throw Error("source_body_changed");
    const questions = await tx.select().from(readingQuestions).where(eq(readingQuestions.passageId, original.id)).orderBy(asc(readingQuestions.order)).for("update");
    for (const patch of input.corrections) {
      const question = questions.find(q => q.id === patch.questionId);
      if (!question || question.questionText !== patch.before.text || question.correctAnswer !== patch.before.answer) throw Error("source_question_changed");
      if (!patch.after.text.trim() || !patch.after.answer.trim() || !patch.after.explanation.trim() || !/^https:\/\//.test(patch.referenceUrl)
        || (patch.after.evidence ? !original.bodyText.includes(patch.after.evidence) : !isUnstatedAnswer(patch.after.answer))) throw Error("source_evidence_missing");
    }
    const existing = await tx.query.readingPassages.findFirst({ where: eq(readingPassages.id, nextId) });
    if (existing) {
      const receipt = await tx.query.contentVersions.findFirst({ where: and(eq(contentVersions.targetType, "reading_passage"), eq(contentVersions.targetId, nextId)) });
      if (receipt?.provenance?.revisionManifestSha !== hash(JSON.stringify(input))) throw Error("source_revision_identity_conflict");
      return { created: false, originalPassageId: original.id, passageId: nextId, versionId: receipt.id };
    }
    const membership = await tx.query.generalReadingPassages.findFirst({ where: eq(generalReadingPassages.passageId, original.id) });
    if (!membership || original.publicationState !== "published") throw Error("source_not_current");
    // This lock coordinates catalogue replacement with Start's shared set lock.
    const [set] = await tx.select().from(generalReadingSets).where(eq(generalReadingSets.id, membership.setId)).limit(1).for("update");
    if (!set || set.publicationState !== "published") throw Error("source_set_not_current");
    const groups = await tx.query.readingQuestionGroups.findMany({ where: eq(readingQuestionGroups.passageId, original.id) });
    const paragraphs = await tx.query.readingPassageParagraphs.findMany({ where: eq(readingPassageParagraphs.passageId, original.id) });
    const occurrences = await tx.query.lexicalOccurrences.findMany({ where: eq(lexicalOccurrences.passageId, original.id) });
    const nextQuestions = withReadingFeedback(questions, original.bodyText).map(question => {
      const patch = input.corrections.find(c => c.questionId === question.id);
      const evidence = patch?.after.evidence;
      const start = evidence ? original.bodyText.indexOf(evidence) : null;
      return { ...question, id: revisionId(input.revision, "question", question.id), passageId: nextId,
        groupId: question.groupId ? revisionId(input.revision, "group", question.groupId) : null,
        ...(patch ? { questionText: patch.after.text, correctAnswer: patch.after.answer, acceptedAnswers: [patch.after.answer],
          evidenceQuote: evidence, evidenceStartChar: start, evidenceEndChar: start == null ? null : start + evidence!.length,
          evidenceType: evidence ? "source_marker" : null, explanation: patch.after.explanation } : {}) };
    });
    const nextGroups = groups.map(group => ({ ...group, id: revisionId(input.revision, "group", group.id), passageId: nextId }));
    const provenance = { origin: "source_correction", revision: input.revision, originalPassageId: original.id,
      originalSourceRef: original.sourceRef, revisionManifestSha: hash(JSON.stringify(input)), references: [...new Set(input.corrections.map(c => c.referenceUrl))] };
    const [currentSetVersion] = await tx.select().from(contentVersions).where(and(eq(contentVersions.targetType, "general_reading_set"), eq(contentVersions.targetId, set.id), eq(contentVersions.status, "published"))).limit(1);
    const setSourceRef = currentSetVersion?.sourceRef ?? set.sourceRef ?? `reading-set:${set.id}`;
    const setSnapshot = async () => {
      const slots = await tx.select().from(generalReadingPassages).where(eq(generalReadingPassages.setId, set.id)).orderBy(asc(generalReadingPassages.passageNo));
      const passages = [];
      for (const slot of slots) {
        const source = await tx.query.readingPassages.findFirst({ where: eq(readingPassages.id, slot.passageId) });
        if (!source) throw Error("source_set_incomplete");
        const members = await tx.query.readingQuestions.findMany({ where: eq(readingQuestions.passageId, source.id), orderBy: asc(readingQuestions.order) });
        const sourceGroups = await tx.query.readingQuestionGroups.findMany({ where: eq(readingQuestionGroups.passageId, source.id), orderBy: asc(readingQuestionGroups.position) });
        passages.push({ passageNo: slot.passageNo, title: source.title, body: source.bodyText,
          groups: sourceGroups.map(g => ({ key: g.id, typeCode: g.typeCode, displayTitle: g.displayTitle ?? undefined,
            instructionsText: g.instructionsText ?? undefined, sharedChoices: g.sharedChoices, fromQuestionNo: g.fromQuestionNo ?? undefined, toQuestionNo: g.toQuestionNo ?? undefined })),
          questions: members.map(q => ({ questionNo: q.questionNo ?? q.order, type: readingQuestionDescriptor(q)?.id ?? q.type,
            text: q.questionText, answer: q.correctAnswer, accepted: q.acceptedAnswers, groupKey: q.groupId ?? undefined,
            options: q.options ?? undefined, evidence: q.evidenceQuote ?? undefined, explanation: q.explanation,
            answerConstraint: q.answerConstraint ?? undefined, renderMode: q.renderMode ?? undefined })), vocabulary: [] });
      }
      return { description: set.description ?? undefined, level: set.difficultyLevel ?? undefined, passages };
    };
    if (!currentSetVersion) await pinVersion(tx, { module: "reading", contentType: "general_set", sourceRef: setSourceRef,
      title: set.title, content: await setSnapshot(), publicationState: "published", actorUserId,
      targetType: "general_reading_set", targetId: set.id, provenance: { origin: "legacy_source_snapshot" } });
    // Snapshot the source being replaced without changing any existing binding.
    await pinVersion(tx, { module: "reading", contentType: "passage", sourceRef: `reading-passage:${original.id}`, title: original.title,
      content: { passages: [{ ...original, questions, groups, paragraphs }] }, publicationState: "published", actorUserId,
      targetType: "reading_passage", targetId: original.id, provenance: { origin: "legacy_source_snapshot", originalSourceRef: original.sourceRef } });
    const { createdAt: _createdAt, ...originalFields } = original;
    await tx.insert(readingPassages).values({ ...originalFields, id: nextId,
      externalId: original.externalId ? `${original.externalId.slice(0, 140)}:r${hash(input.revision).slice(0, 12)}` : null,
      sourceRef: `reading-revision:${nextId}`, sourceChecksum: hash(JSON.stringify({ body: original.bodyText, questions: nextQuestions })) });
    if (nextGroups.length) await tx.insert(readingQuestionGroups).values(nextGroups);
    if (nextQuestions.length) await tx.insert(readingQuestions).values(nextQuestions);
    if (paragraphs.length) await tx.insert(readingPassageParagraphs).values(paragraphs.map(paragraph => ({ ...paragraph, id: revisionId(input.revision, "paragraph", paragraph.id), passageId: nextId })));
    if (occurrences.length) await tx.insert(lexicalOccurrences).values(occurrences.map(occurrence => ({ ...occurrence, id: revisionId(input.revision, "occurrence", occurrence.id), passageId: nextId })));
    await tx.update(generalReadingPassages).set({ passageId: nextId }).where(eq(generalReadingPassages.passageId, original.id));
    await tx.update(readingPassages).set({ publicationState: "archived", publishAt: null, isActive: false }).where(eq(readingPassages.id, original.id));
    const pinned = await pinVersion(tx, { module: "reading", contentType: "passage", sourceRef: `reading-passage:${original.id}`, title: original.title,
      content: { passages: [{ ...originalFields, id: nextId, questions: nextQuestions, groups: nextGroups, paragraphs }] },
      publicationState: "published", actorUserId, targetType: "reading_passage", targetId: nextId, provenance });
    await pinVersion(tx, { module: "reading", contentType: "general_set", sourceRef: setSourceRef, title: set.title,
      content: await setSnapshot(), publicationState: "published", actorUserId, targetType: "general_reading_set", targetId: set.id, provenance });
    return { created: true, originalPassageId: original.id, passageId: nextId, versionId: pinned.version.id };
  });
}
