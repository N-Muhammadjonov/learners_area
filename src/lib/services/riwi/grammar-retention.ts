import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { evaluations, grammarAttempts, grammarExercises, grammarTopics } from "@/db/schema";
import { grammarVisibleTo } from "@/lib/data/grammar";
import { grammarAssessedVerdict, grammarEvaluationMatch } from "@/lib/data/grammar-assessment-evidence";
import { evaluationIssueSchema } from "@/lib/services/coach/schema";
import { getAssessmentContractOrThrow } from "@/lib/services/coach/contracts/registry";
import type { RiwiActor } from "./capabilities";
import { readOwnLearning, retentionExplanationResultSchema, type RetentionExplanationResult } from "./retention-explanation";

/** A produced attempt without its linked, type/owner/contract-bound verdict is
 * unassessed. The legacy isCorrect=false default must never become an error. */
export async function explainGrammarRetention(actor: RiwiActor, language: "en" | "uz", database = db): Promise<RetentionExplanationResult> {
  return readOwnLearning(actor, database, async tx => {
    const [latest] = await tx.select({ topicId: grammarExercises.topicId, topicTitle: grammarTopics.title })
      .from(grammarAttempts).innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
      .where(and(eq(grammarAttempts.userId, actor.id), grammarVisibleTo(actor.id)))
      .orderBy(desc(grammarAttempts.attemptedAt), desc(grammarAttempts.id)).limit(1);
    if (!latest) return { status: "unavailable", reason: "not_found" };
    const rows = await tx.select({ id: grammarAttempts.id, exerciseId: grammarAttempts.exerciseId, activity: grammarAttempts.activity,
      isCorrect: grammarAttempts.isCorrect, attemptedAt: grammarAttempts.attemptedAt,
      evaluationId: evaluations.id, verdict: grammarAssessedVerdict(), issues: evaluations.issues })
      .from(grammarAttempts).innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .leftJoin(evaluations, grammarEvaluationMatch(actor.id))
      .where(and(eq(grammarAttempts.userId, actor.id), eq(grammarExercises.topicId, latest.topicId), grammarVisibleTo(actor.id)))
      .orderBy(desc(grammarAttempts.attemptedAt), desc(grammarAttempts.id)).limit(10);
    const current = rows[0];
    if (!current) return { status: "unavailable", reason: "not_found" };
    const status = (row: typeof current) => row.verdict ?? "unassessed";
    const totals = { correct: 0, mostly_correct: 0, needs_correction: 0, unassessed: 0 };
    const repeated = new Map<string, number>();
    for (const row of rows) {
      totals[status(row)]++;
      if (!row.verdict || row.verdict === "correct") continue;
      const categories = new Set((row.issues ?? []).flatMap(issue => {
        const parsed = evaluationIssueSchema.safeParse(issue);
        return parsed.success && parsed.data.category.startsWith("GRAMMAR_") ? [parsed.data.category] : [];
      }));
      for (const category of categories) repeated.set(category, (repeated.get(category) ?? 0) + 1);
    }
    const uz = language === "uz";
    const labels: Record<string, string> = {
      GRAMMAR_ARTICLE: uz ? "artikl" : "articles", GRAMMAR_SVA: uz ? "ega va kesim mosligi" : "subject-verb agreement",
      GRAMMAR_TENSE: uz ? "zamon" : "tense", GRAMMAR_PREPOSITION: uz ? "predlog" : "prepositions",
      GRAMMAR_FRAGMENT: uz ? "tugallanmagan gap" : "sentence fragments", GRAMMAR_PUNCTUATION: uz ? "tinish belgisi" : "punctuation",
    };
    const patterns = [...repeated].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en")).slice(0, 3);
    const verdicts = { correct: uz ? "to'g'ri" : "correct", mostly_correct: uz ? "asosan to'g'ri" : "mostly correct",
      needs_correction: uz ? "tuzatish kerak" : "needs correction", unassessed: uz ? "hali baholanmagan" : "not yet assessed" };
    const lines = [uz ? `Eslash: ${latest.topicTitle} bo'yicha oxirgi ${rows.length} saqlangan urinishda ${totals.correct} to'g'ri, ${totals.mostly_correct} asosan to'g'ri, ${totals.needs_correction} tuzatish kerak va ${totals.unassessed} hali baholanmagan natija bor.`
      : `Recall: the latest ${rows.length} saved attempts for ${latest.topicTitle} contain ${totals.correct} correct, ${totals.mostly_correct} mostly correct, ${totals.needs_correction} needing correction and ${totals.unassessed} unassessed results.`,
      uz ? `Kamchilik: eng oxirgi urinish — ${verdicts[status(current)]}. Baholanmagan javob xato hisoblanmadi.`
        : `Gap: the latest attempt is ${verdicts[status(current)]}. An unassessed answer is not counted as an error.`,
      patterns.length ? (uz ? `Takrorlangan holatlar: ${patterns.map(([category, count]) => `${labels[category]} (${count} alohida urinish)`).join("; ")}.`
        : `Recurring patterns: ${patterns.map(([category, count]) => `${labels[category]} (${count} distinct attempts)`).join("; ")}.`)
        : (uz ? "Takrorlangan xato uchun yetarli baholangan dalil yo'q." : "There is insufficient assessed evidence of a recurring error."),
      uz ? "Eslash darajasi: bu mashqlar qoidani mustaqil eslash testiga teng emas. Eski topshiriqlar versiyasi saqlanmaganligi sabab unutish yoki barqaror o'sish xulosasi chiqarilmaydi. Bitta xato barqaror zaiflik emas."
        : "Retention limit: these exercises are not an unaided rule-recall test. Historical prompt versions are not recorded, so decay or stable improvement is not established. One error is not a stable weakness.",
      uz ? `Bitta mashq: natijani yopib, ${latest.topicTitle} qoidasini xotiradan ayting va yangi vaziyatga bitta o'z gapingizni yozing. Uni Grammar bo'limida tekshirtiring. Ball va mashq jadvali o'zgarmadi.`
        : `One retrieval drill: close the result, recall the rule for ${latest.topicTitle} and write one sentence of your own in a new context. Check it in Grammar. Scores and scheduling are unchanged.`];
    const contract = getAssessmentContractOrThrow("grammar.retention");
    return retentionExplanationResultSchema.parse({ status: "ready", sourceId: current.id, sourceVersion: null, score: null,
      evaluatorVersion: null, answer: lines.join("\n\n"), sourceLabel: "Grammar saved practice evidence", sourceCount: rows.length,
      contractKey: contract.key, promptVersion: contract.version, rubricVersion: contract.rubricVersion,
      sourceHash: createHash("sha256").update(JSON.stringify({ latest, rows, contractKey: contract.key,
        promptVersion: contract.version, rubricVersion: contract.rubricVersion })).digest("hex") });
  });
}
