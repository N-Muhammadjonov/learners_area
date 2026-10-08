import { readingQuestionType, readingStorageType, readingGroupCode } from "@/lib/reading/question-model";
import { eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { generalReadingPassages, generalReadingSets, readingPassages, readingQuestions, readingQuestionGroups } from "@/db/schema";
import { ingestReadingPassageOccurrences } from "@/lib/services/lexical/reading-occurrences";

/**
 * General Reading content bundle (authored by a teacher/owner — never generated here).
 * One set = up to three passages, each with optional questions and an authored
 * vocabulary list that becomes canonical senses + occurrences through the shared
 * ingestion rule (exact sense only inside the author's example sentence).
 */
export type { GeneralReadingBundle } from "@/lib/reading/import-schema";
export { generalReadingBundle } from "@/lib/reading/import-schema";
import { generalReadingBundle, type GeneralReadingBundle } from "@/lib/reading/import-schema";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "query" | "delete">;

/** Idempotent on sourceRef: a re-run reports the existing set and writes nothing. */
export async function importGeneralReadingSet(tx: Tx, input: GeneralReadingBundle) {
  const bundle = generalReadingBundle.parse(input);
  const existing = await tx.query.generalReadingSets.findFirst({ where: eq(generalReadingSets.sourceRef, bundle.sourceRef) });
  if (existing) return { setId: existing.id, created: false, passages: [] as { passageNo: number; passageId: string; resolved: number; unresolved: number }[] };
  const state = bundle.publish ? "published" as const : "draft" as const;
  const [set] = await tx.insert(generalReadingSets).values({ title: bundle.title, description: bundle.description ?? null, difficultyLevel: bundle.level ?? null, publicationState: state, sourceRef: bundle.sourceRef }).returning();
  const passages = [];
  for (const item of [...bundle.passages].sort((a, b) => a.passageNo - b.passageNo)) {
    const [passage] = await tx.insert(readingPassages).values({ title: item.title, bodyText: item.body, publicationState: state, sourceRef: bundle.sourceRef.slice(0, 80) }).returning();
    await tx.insert(generalReadingPassages).values({ passageId: passage!.id, setId: set!.id, passageNo: item.passageNo });
    const groupIds=new Map<string,string>();
    for(const [position,group] of (item.groups??[]).entries()) {
      const [row]=await tx.insert(readingQuestionGroups).values({passageId:passage!.id,position:position+1,typeCode:readingGroupCode(group.typeCode),displayTitle:group.displayTitle,instructionsText:group.instructionsText,sharedChoices:group.sharedChoices??[],fromQuestionNo:group.fromQuestionNo,toQuestionNo:group.toQuestionNo}).returning();
      groupIds.set(group.key,row!.id);
    }
    if (item.questions.length) {
      await tx.insert(readingQuestions).values(item.questions.map((q, index) => {
        const at = q.evidence ? item.body.indexOf(q.evidence) : -1;
        return {
          passageId: passage!.id, order: index + 1, questionNo: q.questionNo, type: readingStorageType(q.type), typeCode:readingQuestionType(q.type)!.id, questionText: q.text,
          groupId:q.groupKey ? groupIds.get(q.groupKey):undefined, answerConstraint:q.answerConstraint, renderMode:q.renderMode,
          options: q.options ?? null, correctAnswer: q.answer, acceptedAnswers: q.accepted, explanation: q.explanation,
          evidenceQuote: q.evidence ?? null, evidenceStartChar: at >= 0 ? at : null, evidenceEndChar: at >= 0 ? at + q.evidence!.length : null,
          evidenceType: q.evidence ? (at >= 0 ? "source_marker" : "missing_source") : null,
        };
      }));
    }
    // Question evidence is NOT an input here: occurrences come only from the vocabulary list.
    const lexical = await ingestReadingPassageOccurrences(tx, passage!.id, item.body, item.vocabulary);
    passages.push({ passageNo: item.passageNo, passageId: passage!.id, resolved: lexical.resolved, unresolved: lexical.unresolved });
  }
  return { setId: set!.id, created: true, passages };
}
