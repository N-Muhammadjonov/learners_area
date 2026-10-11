import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { evaluations, lexemes, retentionAttempts, retentionTextVersions, userVocabulary, users, vocabularyUsages } from "@/db/schema";
import { getAssessmentContractOrThrow } from "@/lib/services/coach/contracts/registry";
import { MEASUREMENT_LIMITS } from "@/lib/retention/measurement";
import { authorizeCapability, type RiwiActor } from "./capabilities";
import { recordRiwiAudit } from "./audit";
import { hasActiveLearningAttempt, lockRecallAllocation } from "./retention-read-policy";

const count = z.number().int().nonnegative();
const ids = z.array(z.string().min(1).max(MEASUREMENT_LIMITS.maxIdChars)).max(MEASUREMENT_LIMITS.maxGroupsPerClaim);
const breakdownSchema = z.object({
  schemaVersion: z.literal(1), evaluatorVersion: z.string().min(1).max(60), maxScore: z.literal(100), score: count.max(100),
  totals: z.object({ captured: count, partial: count, missed: count, contradicted: count, matchedGroups: count,
    totalGroups: count, mainIdeasRemembered: count, mainIdeasPossible: count }).strict(),
  claims: z.array(z.object({ claimId: z.string().min(1).max(MEASUREMENT_LIMITS.maxIdChars),
    claimLabel: z.string().min(1).max(MEASUREMENT_LIMITS.maxLabelChars), possiblePoints: count.min(1).max(100),
    awardedPoints: count.max(100), status: z.enum(["captured", "partial", "missed", "contradicted"]),
    matchedGroupIds: ids, missingGroupIds: ids, missingCriticalGroupIds: ids }).strict()).min(1).max(MEASUREMENT_LIMITS.maxClaims),
}).strict();

export const retentionExplanationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_found", "locked", "invalid_evidence"]) }).strict(),
  z.object({ status: z.literal("ready"), sourceId: z.string().uuid(), sourceVersion: z.number().int().positive().nullable(),
    score: count.max(100).nullable(), evaluatorVersion: z.string().min(1).max(60).nullable(), answer: z.string().min(1).max(6000),
    contractKey: z.enum(["retention.reading-recall", "retention.vocabulary-recall", "retention.error-pattern", "grammar.retention"]),
    sourceLabel: z.string().min(1).max(120), sourceCount: z.number().int().min(1).max(10), promptVersion: z.string().min(1).max(80),
    rubricVersion: z.string().min(1).max(80), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type RetentionExplanationResult = z.infer<typeof retentionExplanationResultSchema>;

/** Explain an immutable saved result. Integrity checks verify its own fields;
 * they never regrade wording, reload the hidden text or change the score. */
export function explainStoredReadingRecall(record: {
  id: string; retentionTextVersionId: string; score: number | null; evaluatorVersion: string | null; scoreBreakdown: unknown;
}, sourceVersion: number, language: "en" | "uz"): RetentionExplanationResult {
  const deny = (): RetentionExplanationResult => ({ status: "unavailable", reason: "invalid_evidence" });
  if (!z.string().uuid().safeParse(record.retentionTextVersionId).success) return deny();
  const parsed = breakdownSchema.safeParse(record.scoreBreakdown);
  if (!parsed.success || parsed.data.score !== record.score || parsed.data.evaluatorVersion !== record.evaluatorVersion) return deny();
  const data = parsed.data;
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(data.claims.map(claim => claim.claimId))
    || data.claims.reduce((sum, claim) => sum + claim.possiblePoints, 0) !== 100
    || data.claims.reduce((sum, claim) => sum + claim.awardedPoints, 0) !== data.score
    || data.claims.some(claim => claim.awardedPoints > claim.possiblePoints
      || !unique([...claim.matchedGroupIds, ...claim.missingGroupIds]) || !unique(claim.missingCriticalGroupIds)
      || claim.missingCriticalGroupIds.some(id => !claim.missingGroupIds.includes(id))
      || (claim.status === "captured" ? claim.awardedPoints !== claim.possiblePoints
        : claim.status === "partial" ? claim.awardedPoints <= 0 || claim.awardedPoints >= claim.possiblePoints : claim.awardedPoints !== 0))) return deny();
  for (const status of ["captured", "partial", "missed", "contradicted"] as const)
    if (data.totals[status] !== data.claims.filter(claim => claim.status === status).length) return deny();
  if (data.totals.mainIdeasRemembered !== data.totals.captured || data.totals.mainIdeasPossible !== data.claims.length
    || data.totals.matchedGroups !== data.claims.reduce((sum, claim) => sum + claim.matchedGroupIds.length, 0)
    || data.totals.totalGroups !== data.claims.reduce((sum, claim) => sum + claim.matchedGroupIds.length + claim.missingGroupIds.length, 0)) return deny();
  const uz = language === "uz";
  const lines = [uz ? `Saqlangan recall natijangiz: ${data.score}/100.` : `Your saved recall result: ${data.score}/100.`,
    uz ? "Quyidagi fikrlar saqlangan baholash natijasidan olingan. Matn qayta baholanmadi." : "The following ideas come from your saved evaluation. The text has not been regraded."];
  const labels = { captured: uz ? "Eslangan" : "Remembered", partial: uz ? "Qisman eslangan" : "Partially remembered",
    missed: uz ? "O'tkazib yuborilgan" : "Missed", contradicted: uz ? "Zid qayd etilgan" : "Recorded as contradicted" };
  for (const status of ["captured", "partial", "missed", "contradicted"] as const) {
    const claims = data.claims.filter(claim => claim.status === status);
    lines.push(`${labels[status]}: ${claims.length ? claims.slice(0, 3).map(claim => claim.claimLabel).join("; ") : (uz ? "bu natijada qayd etilmagan" : "not recorded in this result")}.`);
  }
  if ([data.totals.captured, data.totals.partial, data.totals.missed, data.totals.contradicted].some(value => value > 3))
    lines.push(uz ? "Har bo'limdan eng ko'pi uchta fikr ko'rsatildi. To'liq natija Retention tarixida saqlangan." : "At most three ideas per section are shown. The full result remains in Retention history.");
  const gap = data.claims.find(claim => claim.status !== "captured");
  lines.push(uz ? `Eslash mashqi: natijani yopib, ${gap ? `ushbu fikrni o'z so'zlaringiz bilan eslang: ${gap.claimLabel}` : "asosiy fikrlarni o'z so'zlaringiz bilan eslang"}. Keyin saqlangan natija bilan tekshiring.`
    : `Retrieval cue: close the result and recall ${gap ? `this idea in your own words: ${gap.claimLabel}` : "the main ideas in your own words"}. Then check against your saved result.`);
  lines.push(uz ? "Bir urinishdagi xato barqaror zaiflikni isbotlamaydi. Bu tushuntirish mashq jadvalini o'zgartirmaydi."
    : "An error in one attempt does not establish a stable weakness. This explanation does not change your practice schedule.");
  const contract = getAssessmentContractOrThrow("retention.reading-recall");
  const result = retentionExplanationResultSchema.safeParse({ status: "ready", sourceId: record.id, sourceVersion, score: data.score,
    evaluatorVersion: data.evaluatorVersion, answer: lines.join("\n\n"), contractKey: contract.key,
    sourceLabel: "Retention saved recall", sourceCount: 1,
    promptVersion: contract.version, rubricVersion: contract.rubricVersion,
    sourceHash: createHash("sha256").update(JSON.stringify({ contractKey: contract.key, promptVersion: contract.version,
      rubricVersion: contract.rubricVersion, attemptId: record.id, versionId: record.retentionTextVersionId, sourceVersion, breakdown: data })).digest("hex") });
  return result.success ? result.data : deny();
}

type LearningTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shared self/exam/active-recall boundary. These reads never submit, grade,
 * award points, create learning signals or change a practice schedule. */
export async function readOwnLearning(actor: RiwiActor, database: typeof db,
  read: (tx: LearningTransaction) => Promise<RetentionExplanationResult>): Promise<RetentionExplanationResult> {
  return database.transaction(async tx => {
    const [current] = await tx.select({ id: users.id, role: users.role, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, actor.id)).for("share");
    if (!current || current.role !== actor.role || actor.accountStatus !== "active" || !authorizeCapability(current, "riwi.chat.self").allowed)
      return { status: "unavailable", reason: "not_found" };
    await lockRecallAllocation(actor.id, tx);
    if (await hasActiveLearningAttempt(current.id, tx)) return { status: "unavailable", reason: "locked" };
    const result = await read(tx);
    if (result.status === "ready") await recordRiwiAudit({ actorUserId: actor.id, action: "riwi.learning.explanation.prepared",
      targetType: "riwi_learning_source", targetId: result.sourceId, metadata: { role: actor.role, scopeKind: "self",
        capability: "riwi.chat.self", riskClass: "read-only", status: "prepared", answerSource: "deterministic_learning_data",
        assessmentContractKey: result.contractKey, promptVersion: result.promptVersion, rubricVersion: result.rubricVersion,
        sourceChecksum: result.sourceHash, resultCount: result.sourceCount } }, tx);
    return result;
  });
}

/** No source-body or recall-text column is selected. */
export async function explainLatestReadingRecall(actor: RiwiActor, language: "en" | "uz", database = db): Promise<RetentionExplanationResult> {
  return readOwnLearning(actor, database, async tx => {
    const [record] = await tx.select({ id: retentionAttempts.id, retentionTextId: retentionAttempts.retentionTextId,
      retentionTextVersionId: retentionAttempts.retentionTextVersionId, score: retentionAttempts.score,
      scoreBreakdown: retentionAttempts.scoreBreakdown, evaluatorVersion: retentionAttempts.evaluatorVersion, completedAt: retentionAttempts.completedAt })
      .from(retentionAttempts).where(and(eq(retentionAttempts.userId, actor.id), inArray(retentionAttempts.status, ["completed", "timed_out"])))
      .orderBy(desc(retentionAttempts.completedAt), desc(retentionAttempts.id)).limit(1).for("share");
    if (!record) return { status: "unavailable", reason: "not_found" };
    if (!record.completedAt) return { status: "unavailable", reason: "invalid_evidence" };
    const [version] = await tx.select({ versionNumber: retentionTextVersions.versionNumber }).from(retentionTextVersions)
      .where(and(eq(retentionTextVersions.id, record.retentionTextVersionId), eq(retentionTextVersions.retentionTextId, record.retentionTextId))).limit(1);
    if (!version) return { status: "unavailable", reason: "invalid_evidence" };
    return explainStoredReadingRecall(record, version.versionNumber, language);
  });
}

/** Review counters are self-reported recall evidence, not a measured
 * recognition/meaning distinction. Productive evidence must bind to this
 * exact learner, sense, usage and canonical evaluation. */
export async function explainVocabularyRecall(actor: RiwiActor, language: "en" | "uz", database = db): Promise<RetentionExplanationResult> {
  return readOwnLearning(actor, database, async tx => {
    const [entry] = await tx.select({ id: userVocabulary.id, correctCount: userVocabulary.correctCount,
      incorrectCount: userVocabulary.incorrectCount, lexemeId: lexemes.id, term: lexemes.term, definitionEn: lexemes.definitionEn,
      translationUz: lexemes.translationUz, example: lexemes.exampleSentence, verificationStatus: lexemes.verificationStatus })
      .from(userVocabulary).innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
      .where(eq(userVocabulary.userId, actor.id)).orderBy(userVocabulary.nextReviewAt, userVocabulary.id).limit(1);
    if (!entry) return { status: "unavailable", reason: "not_found" };
    if (!Number.isInteger(entry.correctCount) || entry.correctCount < 0 || !Number.isInteger(entry.incorrectCount) || entry.incorrectCount < 0)
      return { status: "unavailable", reason: "invalid_evidence" };
    const [usage] = await tx.select({ id: vocabularyUsages.id, evaluationId: evaluations.id, verdict: evaluations.verdict })
      .from(vocabularyUsages).innerJoin(evaluations, and(eq(evaluations.id, vocabularyUsages.evaluationId),
        eq(evaluations.userId, actor.id), eq(evaluations.evaluationType, "vocabulary"), eq(evaluations.sourceType, "vocabulary_usage"),
        eq(evaluations.sourceId, vocabularyUsages.id), eq(evaluations.assessmentContractKey, "vocabulary.use-in-sentence"),
        sql`${evaluations.overallEstimate} is null`))
      .where(and(eq(vocabularyUsages.userId, actor.id), eq(vocabularyUsages.userVocabularyId, entry.id)))
      .orderBy(desc(vocabularyUsages.createdAt), desc(vocabularyUsages.id)).limit(1);
    const uz = language === "uz", verified = entry.verificationStatus === "verified";
    const verdictLabel = usage?.verdict ? { correct: uz ? "to'g'ri" : "correct", mostly_correct: uz ? "asosan to'g'ri" : "mostly correct",
      needs_correction: uz ? "tuzatish kerak" : "needs correction" }[usage.verdict] : null;
    const lines = [uz ? `So'z: ${entry.term}.` : `Saved word: ${entry.term}.`,
      uz ? `Tanib olish: takrorlash tarixida ${entry.correctCount} muvaffaqiyatli va ${entry.incorrectCount} muvaffaqiyatsiz eslash bor. Buni siz belgilagansiz; tanib olish va ma'noni mustaqil eslash alohida o'lchanmagan.`
        : `Recognition: saved reviews record ${entry.correctCount} successful and ${entry.incorrectCount} unsuccessful recalls. These are self-reports; recognition and unaided meaning recall were not measured separately.`,
      verified ? (uz ? `Ma'no: aynan saqlagan ma'nongiz: ${entry.definitionEn.slice(0, 1000)}${entry.translationUz ? ` / ${entry.translationUz.slice(0, 500)}` : ""}.`
        : `Meaning: the exact saved, verified sense is ${entry.definitionEn.slice(0, 1000)}${entry.translationUz ? ` / ${entry.translationUz.slice(0, 500)}` : ""}.`)
        : (uz ? "Ma'no: bu ma'no hali tekshirilmagan. Uni taxmin qilib bermayman." : "Meaning: this sense has not been checked yet. No guessed meaning is supplied."),
      verified && entry.example ? (uz ? `Kontekst: shu ma'no uchun saqlangan misol: ${entry.example.slice(0, 700)}` : `Context: the saved example for this sense is ${entry.example.slice(0, 700)}`)
        : (uz ? "Kontekst: tekshirilgan misol qayd etilmagan." : "Context: no verified example is recorded."),
      verdictLabel ? (uz ? `Faol ishlatish: shu ma'noda yozgan gapingizning saqlangan bahosi: ${verdictLabel}. Bu bitta urinish, yangi vaziyatda qo'llay olishingizning isboti emas.`
        : `Productive use: a linked, evaluated attempt for this exact sense is ${verdictLabel}. This is one attempt, not proof of mastery in a new context.`)
        : (uz ? "Faol ishlatish: bog'langan tekshirilgan gap qayd etilmagan. Tanib olishning o'zi so'zni o'zlashtirish emas."
          : "Productive use: no linked evaluated sentence is recorded. Recognition alone is not mastery."),
      uz ? "Mashq: ma'noni yopib, o'z so'zlaringiz bilan eslang. So'ng yangi vaziyatda o'zingiz gap yozing va Vocabulary bo'limida tekshirtiring. Ball, o'zlashtirish holati va takrorlash jadvali o'zgarmadi."
        : "Drill: hide the meaning and recall it in your own words. Then write your own sentence in a new context and check it in Vocabulary. Points, mastery and the review schedule are unchanged."];
    const contract = getAssessmentContractOrThrow("retention.vocabulary-recall");
    return retentionExplanationResultSchema.parse({ status: "ready", sourceId: entry.id, sourceVersion: null, score: null,
      evaluatorVersion: null, answer: lines.join("\n\n"), contractKey: contract.key, promptVersion: contract.version,
      rubricVersion: contract.rubricVersion, sourceLabel: "Vocabulary saved recall evidence", sourceCount: 1,
      sourceHash: createHash("sha256").update(JSON.stringify({ entry, usage: usage ?? null, contractKey: contract.key,
        promptVersion: contract.version, rubricVersion: contract.rubricVersion })).digest("hex") });
  });
}

/** Compare only saved attempts at one immutable source version. Recurrence
 * within this bounded sample is not a stable weakness or a cross-source trend. */
export async function explainRecallErrorPattern(actor: RiwiActor, language: "en" | "uz", database = db): Promise<RetentionExplanationResult> {
  return readOwnLearning(actor, database, async tx => {
    const [latest] = await tx.select({ versionId: retentionAttempts.retentionTextVersionId, textId: retentionAttempts.retentionTextId })
      .from(retentionAttempts).where(and(eq(retentionAttempts.userId, actor.id), inArray(retentionAttempts.status, ["completed", "timed_out"])))
      .orderBy(desc(retentionAttempts.completedAt), desc(retentionAttempts.id)).limit(1);
    if (!latest) return { status: "unavailable", reason: "not_found" };
    const [version] = await tx.select({ versionNumber: retentionTextVersions.versionNumber }).from(retentionTextVersions)
      .where(and(eq(retentionTextVersions.id, latest.versionId), eq(retentionTextVersions.retentionTextId, latest.textId))).limit(1);
    if (!version) return { status: "unavailable", reason: "invalid_evidence" };
    const rows = await tx.select({ id: retentionAttempts.id, retentionTextVersionId: retentionAttempts.retentionTextVersionId,
      score: retentionAttempts.score, scoreBreakdown: retentionAttempts.scoreBreakdown,
      evaluatorVersion: retentionAttempts.evaluatorVersion, completedAt: retentionAttempts.completedAt })
      .from(retentionAttempts).where(and(eq(retentionAttempts.userId, actor.id), eq(retentionAttempts.retentionTextVersionId, latest.versionId),
        eq(retentionAttempts.retentionTextId, latest.textId), inArray(retentionAttempts.status, ["completed", "timed_out"])))
      .orderBy(desc(retentionAttempts.completedAt), desc(retentionAttempts.id)).limit(10);
    if (!rows.length || rows.some(row => !row.completedAt || explainStoredReadingRecall(row, version.versionNumber, language).status !== "ready"))
      return { status: "unavailable", reason: "invalid_evidence" };
    const breakdowns = rows.map(row => breakdownSchema.parse(row.scoreBreakdown));
    const recent = breakdowns[0];
    const current = rows[0], first = rows.at(-1);
    if (!recent || !current || !first) return { status: "unavailable", reason: "invalid_evidence" };
    if (breakdowns.some(data => data.evaluatorVersion !== recent.evaluatorVersion || JSON.stringify(data.claims.map(c => [c.claimId, c.claimLabel, c.possiblePoints]))
      !== JSON.stringify(recent.claims.map(c => [c.claimId, c.claimLabel, c.possiblePoints]))))
      return { status: "unavailable", reason: "invalid_evidence" };
    const gaps = recent.claims.map(claim => ({ claim, count: breakdowns.filter(data => data.claims.some(c => c.claimId === claim.claimId && c.status !== "captured")).length }));
    const repeated = gaps.filter(item => item.count >= 2).slice(0, 3), uz = language === "uz";
    const lines = [uz ? `Dalil: bir xil saqlangan manba versiyasidagi eng oxirgi ${rows.length} yakunlangan urinish.`
      : `Evidence: the latest ${rows.length} terminal attempts at one saved source version.`,
      repeated.length ? (uz ? `Takrorlangan kamchiliklar: ${repeated.map(item => `${item.claim.claimLabel} (${item.count} urinish)`).join("; ")}.`
        : `Repeated gaps: ${repeated.map(item => `${item.claim.claimLabel} (${item.count} attempts)`).join("; ")}.`)
        : (uz ? "Bu tanlovda takrorlangan kamchilik uchun yetarli dalil yo'q." : "There is insufficient evidence of a repeated gap in this sample."),
      rows.length > 1 ? (uz ? `Taqqoslash: bu tanlovdagi oldingi saqlangan ball ${first.score}/100, eng oxirgisi ${current.score}/100. Bu faqat shu manba va evaluator bo'yicha urinishlar taqqoslashi.`
        : `Comparison: the earlier saved score in this sample is ${first.score}/100; the latest is ${current.score}/100. This compares attempts at this source and evaluator only.`)
        : (uz ? "O'zgarish: faqat bitta urinish bor, yaxshilanish yoki pasayish tasdiqlanmaydi." : "Change: only one attempt is recorded; improvement or decline is not established."),
      uz ? `Qolgan kamchiliklar: eng oxirgi natijada ${recent.totals.partial + recent.totals.missed + recent.totals.contradicted} fikr to'liq eslanmagan.`
        : `Remaining gaps: ${recent.totals.partial + recent.totals.missed + recent.totals.contradicted} ideas were not fully captured in the latest result.`];
    const gap = repeated.find(item => item.claim.status !== "captured")?.claim ?? recent.claims.find(claim => claim.status !== "captured");
    lines.push(uz ? `Mashq: natijani yopib, ${gap ? gap.claimLabel : "asosiy fikrlarni"} o'z so'zlaringiz bilan eslang, so'ng saqlangan natija bilan tekshiring.`
      : `Drill: close the result and recall ${gap ? gap.claimLabel : "the main ideas"} in your own words, then check against the saved result.`);
    lines.push(uz ? "Bitta xato barqaror zaiflik emas. Bu cheklangan tanlov umumiy mastery yoki trendni isbotlamaydi. Ball va jadval o'zgarmadi."
      : "One error is not a stable weakness. This bounded sample does not establish overall mastery or a general trend. Scores and scheduling are unchanged.");
    const contract = getAssessmentContractOrThrow("retention.error-pattern");
    return retentionExplanationResultSchema.parse({ status: "ready", sourceId: current.id, sourceVersion: version.versionNumber, score: null,
      evaluatorVersion: recent.evaluatorVersion, answer: lines.join("\n\n"), contractKey: contract.key, promptVersion: contract.version,
      rubricVersion: contract.rubricVersion, sourceLabel: "Retention same-version attempt evidence", sourceCount: rows.length,
      sourceHash: createHash("sha256").update(JSON.stringify({ rows, sourceVersion: version.versionNumber, contractKey: contract.key,
        promptVersion: contract.version, rubricVersion: contract.rubricVersion })).digest("hex") });
  });
}
