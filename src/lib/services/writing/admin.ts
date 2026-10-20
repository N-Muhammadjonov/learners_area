import { notDeleted } from "@/lib/content/deletion-filter";
import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  resourceBlocks, writingLanguagePatterns, writingLessons, writingModelTexts, writingPrompts, writingTranslationSentences, writingTranslationSets,
} from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import { canTransition, isLive, isPublicationState, publicationProblem, type PublicationState } from "@/lib/services/cms/publication";
import {
  ADMIN_INPUT, MODEL_TEXT_MIN_WORDS, wordsIn, type AdminInput, type AdminIssue, type WritingAdminKind,
} from "@/lib/writing/admin-schemas";

type Database = typeof db;

/**
 * Writing Management domain service (Part J). Owns validation, create, update,
 * list/counts and publication readiness for every Writing content kind. Routes
 * only authenticate (ADMIN/OWNER), parse and call this. Publication itself stays
 * in the ONE shared endpoint (/api/admin/content/:type/:id/publication), which
 * asks `writingPublicationIssues` before publishing or scheduling.
 */

const TABLE = {
  lesson: writingLessons, prompt: writingPrompts, translation: writingTranslationSets, "model-text": writingModelTexts, pattern: writingLanguagePatterns,
} as const;

export type StateCounts = Record<PublicationState, number> & { total: number };

export async function writingAdminCounts(database: Database = db): Promise<Record<WritingAdminKind, StateCounts>> {
  const out = {} as Record<WritingAdminKind, StateCounts>;
  for (const kind of Object.keys(TABLE) as WritingAdminKind[]) {
    const t = TABLE[kind];
    const rows = await database.select({ state: t.publicationState, n: sql<number>`count(*)::int` }).from(t).where(notDeleted(t.id)).groupBy(t.publicationState);
    const c: StateCounts = { draft: 0, scheduled: 0, published: 0, archived: 0, total: 0 };
    for (const r of rows) { c[r.state as PublicationState] = Number(r.n); c.total += Number(r.n); }
    out[kind] = c;
  }
  return out;
}

export type AdminRow = { id: string; title: string; subtitle: string; publicationState: PublicationState; publishAt: string | null };

export async function listWritingContent(kind: WritingAdminKind, database: Database = db): Promise<AdminRow[]> {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  switch (kind) {
    case "lesson": return (await database.select().from(writingLessons).where(notDeleted(writingLessons.id)).orderBy(asc(writingLessons.position), asc(writingLessons.title)))
      .map((r) => ({ id: r.id, title: r.title, subtitle: r.category, publicationState: r.publicationState, publishAt: iso(r.publishAt) }));
    case "prompt": return (await database.select().from(writingPrompts).where(notDeleted(writingPrompts.id)).orderBy(desc(writingPrompts.createdAt)))
      .map((r) => ({ id: r.id, title: r.prompt.slice(0, 140), subtitle: `${r.taskType === "task1" ? "Task 1" : "Task 2"} · ${r.category} · ${r.targetWordCount}`, publicationState: r.publicationState, publishAt: iso(r.publishAt) }));
    case "translation": {
      const rows = await database.select({ s: writingTranslationSets, n: sql<number>`(select count(*)::int from writing_translation_sentences x where x.set_id = writing_translation_sets.id)` }).from(writingTranslationSets).where(notDeleted(writingTranslationSets.id)).orderBy(asc(writingTranslationSets.title));
      return rows.map(({ s, n }) => ({ id: s.id, title: s.title, subtitle: `${s.topic} · ${s.questionType} · Band ${s.targetBand} · ${n}`, publicationState: s.publicationState, publishAt: iso(s.publishAt) }));
    }
    case "model-text": return (await database.select().from(writingModelTexts).where(notDeleted(writingModelTexts.id)).orderBy(asc(writingModelTexts.title)))
      .map((r) => ({ id: r.id, title: r.title, subtitle: `${r.taskType === "task1" ? "Task 1" : "Task 2"} · ${r.topic} · Band ${Number(r.targetBand)} · ${r.wordCount}`, publicationState: r.publicationState, publishAt: iso(r.publishAt) }));
    case "pattern": return (await database.select().from(writingLanguagePatterns).where(notDeleted(writingLanguagePatterns.id)).orderBy(asc(writingLanguagePatterns.function), asc(writingLanguagePatterns.pattern)))
      .map((r) => ({ id: r.id, title: r.pattern, subtitle: `${r.function} · ${r.taskType === "task1" ? "Task 1" : "Task 2"}${r.topic ? ` · ${r.topic}` : ""}${r.targetBand ? ` · Band ${r.targetBand}` : ""}`, publicationState: r.publicationState, publishAt: iso(r.publishAt) }));
  }
}

/** The editable values of one row, shaped exactly like the kind's input schema. */
export async function getWritingContent(kind: WritingAdminKind, id: string, database: Database = db): Promise<(Record<string, unknown> & { publicationState: PublicationState; publishAt: string | null }) | null> {
  const t = TABLE[kind];
  const [r] = await database.select().from(t).where(and(eq(t.id, id), notDeleted(t.id)));
  if (!r) return null;
  const base = { publicationState: r.publicationState, publishAt: r.publishAt ? r.publishAt.toISOString() : null };
  switch (kind) {
    case "lesson": { const x = r as typeof writingLessons.$inferSelect; return { ...base, title: x.title, category: x.category, summary: x.summary, body: x.body, durationMinutes: x.durationMinutes, position: x.position }; }
    case "prompt": { const x = r as typeof writingPrompts.$inferSelect; return { ...base, taskType: x.taskType, category: x.category, prompt: x.prompt, targetWordCount: x.targetWordCount }; }
    case "translation": {
      const x = r as typeof writingTranslationSets.$inferSelect;
      const sentences = await database.select().from(writingTranslationSentences).where(eq(writingTranslationSentences.setId, id)).orderBy(asc(writingTranslationSentences.position));
      return { ...base, title: x.title, topic: x.topic, questionType: x.questionType, taskType: x.taskType, targetBand: x.targetBand, promptText: x.promptText, provenance: x.provenance,
        sentences: sentences.map((s) => ({ position: s.position, uzbekSource: s.uzbekSource, modelEnglish: s.modelEnglish, acceptedAlternatives: s.acceptedAlternatives, notes: s.notes, targetLexicalItems: s.targetLexicalItems })) };
    }
    case "model-text": { const x = r as typeof writingModelTexts.$inferSelect; return { ...base, title: x.title, taskType: x.taskType, topic: x.topic, targetBand: Number(x.targetBand), body: x.body, provenance: x.provenance, wordCount: x.wordCount }; }
    case "pattern": { const x = r as typeof writingLanguagePatterns.$inferSelect; return { ...base, pattern: x.pattern, function: x.function, taskType: x.taskType, topic: x.topic, targetBand: x.targetBand, example: x.example, usageNote: x.usageNote, sourceRef: x.sourceRef, provenance: x.provenance }; }
  }
}

export type SaveOutcome = { ok: true; id: string } | { ok: false; issues: AdminIssue[] };

/** Domain checks beyond field shape (duplicate positions, complete model text, existing source). */
async function domainIssues(kind: WritingAdminKind, data: Record<string, unknown>, database: Database): Promise<AdminIssue[]> {
  const issues: AdminIssue[] = [];
  if (kind === "translation") {
    const positions = (data.sentences as { position: number }[]).map((s) => s.position);
    if (new Set(positions).size !== positions.length) issues.push("duplicate_position");
  }
  if (kind === "model-text") {
    const min = MODEL_TEXT_MIN_WORDS[data.taskType as "task1" | "task2"];
    if (wordsIn(String(data.body)) < min) issues.push("model_too_short");
  }
  if (kind === "pattern" && data.sourceRef) {
    const [src] = await database.select({ id: writingModelTexts.id }).from(writingModelTexts).where(eq(writingModelTexts.id, String(data.sourceRef)));
    if (!src) issues.push("unknown_source");
  }
  return issues;
}

export async function saveWritingContent(kind: WritingAdminKind, id: string | null, raw: unknown, actorUserId: string, database: Database = db): Promise<SaveOutcome> {
  const parsed = ADMIN_INPUT[kind].safeParse(raw);
  if (!parsed.success) return { ok: false, issues: ["invalid_fields"] };
  const data = parsed.data as Record<string, unknown>;
  const issues = await domainIssues(kind, data, database);
  if (issues.length) return { ok: false, issues };
  const t = TABLE[kind];
  if (id) {
    const [exists] = await database.select({ id: t.id }).from(t).where(and(eq(t.id, id), notDeleted(t.id)));
    if (!exists) return { ok: false, issues: ["not_found"] };
  }
  const now = new Date();
  let savedId: string;
  try {
    savedId = await database.transaction(async (tx) => {
      const values = columnsFor(kind, data, now);
      let rowId = id;
      if (rowId) await tx.update(t).set(values as never).where(eq(t.id, rowId));
      else {
        // New content always starts as a draft; publication goes through the shared endpoint.
        const [row] = await tx.insert(t).values({ ...values, publicationState: "draft" } as never).returning({ id: t.id });
        rowId = row!.id;
      }
      if (kind === "translation") {
        const sentences = (data as AdminInput<"translation">).sentences;
        await tx.delete(writingTranslationSentences).where(eq(writingTranslationSentences.setId, rowId));
        if (sentences.length) await tx.insert(writingTranslationSentences).values(sentences.map((s) => ({ ...s, setId: rowId! })));
      }
      return rowId;
    });
  } catch {
    return { ok: false, issues: ["write_failed"] };
  }
  await recordAudit({ actorUserId, action: "content.updated", targetType: `writing_${kind.replace("-", "_")}`, targetId: savedId, metadata: { operation: id ? "edit" : "create" } }, database);
  return { ok: true, id: savedId };
}

function columnsFor(kind: WritingAdminKind, d: Record<string, unknown>, now: Date): Record<string, unknown> {
  switch (kind) {
    case "lesson": return { title: d.title, category: d.category, summary: d.summary, body: d.body, durationMinutes: d.durationMinutes, position: d.position, updatedAt: now };
    case "prompt": return { taskType: d.taskType, category: d.category, prompt: d.prompt, targetWordCount: d.targetWordCount };
    case "translation": return { title: d.title, topic: d.topic, questionType: d.questionType, taskType: d.taskType, targetBand: d.targetBand, promptText: d.promptText, provenance: d.provenance, updatedAt: now };
    // Word count is derived from the body on the server, never typed by staff.
    case "model-text": return { title: d.title, taskType: d.taskType, topic: d.topic, targetBand: String(d.targetBand), body: d.body, wordCount: wordsIn(String(d.body)), provenance: d.provenance };
    case "pattern": return { pattern: d.pattern, function: d.function, taskType: d.taskType, topic: d.topic, targetBand: d.targetBand, example: d.example, usageNote: d.usageNote, sourceRef: d.sourceRef, provenance: d.provenance };
  }
}

/**
 * Publish/schedule blockers for a Writing row (checked by the shared publication
 * endpoint). Empty list = may go live. Never deletes or edits anything.
 */
export async function writingPublicationIssues(kind: WritingAdminKind, id: string, database: Database = db): Promise<AdminIssue[]> {
  const row = await getWritingContent(kind, id, database);
  if (!row) return ["not_found"];
  const issues: AdminIssue[] = [];
  const blank = (v: unknown) => typeof v !== "string" || !v.trim();
  switch (kind) {
    case "lesson": if (blank(row.body)) issues.push("empty_body"); break;
    case "prompt": {
      if (row.taskType === "task1") {
        const [img] = await database.select({ id: resourceBlocks.id }).from(resourceBlocks)
          .where(and(eq(resourceBlocks.ownerType, "writing"), eq(resourceBlocks.ownerId, id), eq(resourceBlocks.type, "image"))).limit(1);
        if (!img) issues.push("task1_visual_missing");
      }
      break;
    }
    case "translation": {
      const s = row.sentences as { position: number; uzbekSource: string; modelEnglish: string }[];
      if (!s.length) issues.push("no_sentences");
      if (new Set(s.map((x) => x.position)).size !== s.length) issues.push("duplicate_position");
      if (s.some((x) => blank(x.uzbekSource))) issues.push("missing_uzbek");
      if (s.some((x) => blank(x.modelEnglish))) issues.push("missing_model");
      if (blank(row.provenance)) issues.push("missing_provenance");
      break;
    }
    case "model-text":
      if (blank(row.body)) issues.push("empty_body");
      else if (wordsIn(String(row.body)) < MODEL_TEXT_MIN_WORDS[row.taskType as "task1" | "task2"]) issues.push("model_too_short");
      if (blank(row.provenance)) issues.push("missing_provenance");
      break;
    case "pattern":
      if (blank(row.example)) issues.push("missing_example");
      if (blank(row.provenance)) issues.push("missing_provenance");
      if (row.sourceRef) {
        const [src] = await database.select({ id: writingModelTexts.id }).from(writingModelTexts).where(eq(writingModelTexts.id, String(row.sourceRef)));
        if (!src) issues.push("unknown_source");
      }
      break;
  }
  return issues;
}

export type PublicationOutcome =
  | { ok: true; state: PublicationState; publishAt: string | null; changed: boolean }
  | { ok: false; status: number; error: string; issues?: AdminIssue[] };

/**
 * Writing branch of the ONE publication endpoint: the same canTransition /
 * publicationProblem / isLive rule and the same audit row as every other
 * content type, plus Writing publish-readiness. Archive never deletes.
 */
export async function changeWritingPublication(kind: WritingAdminKind, id: string, state: PublicationState, publishAt: Date | null, actorUserId: string, database: Database = db): Promise<PublicationOutcome> {
  const problem = publicationProblem(state, publishAt);
  if (problem) return { ok: false, status: 400, error: problem };
  const t = TABLE[kind];
  const [row] = await database.select({ publicationState: t.publicationState, publishAt: t.publishAt }).from(t).where(and(eq(t.id, id), notDeleted(t.id)));
  if (!row) return { ok: false, status: 404, error: "not_found" };
  const from = isPublicationState(row.publicationState) ? row.publicationState : "published";
  if (from === state) return { ok: true, state, publishAt: row.publishAt?.toISOString() ?? null, changed: false };
  if (!canTransition(from, state)) return { ok: false, status: 409, error: "invalid_transition" };
  if (state === "published" || state === "scheduled") {
    const issues = await writingPublicationIssues(kind, id, database);
    if (issues.length) return { ok: false, status: 409, error: "not_ready", issues };
  }
  await database.update(t).set({ publicationState: state, publishAt } as never).where(and(eq(t.id, id), notDeleted(t.id)));
  await recordAudit({
    actorUserId, action: "content.updated", targetType: kind === "prompt" ? "writing_prompt" : `writing_${kind.replace("-", "_")}`, targetId: id,
    metadata: { from, to: state, publishAt: publishAt ? publishAt.toISOString() : null, live: isLive({ publicationState: state, publishAt }) },
  }, database);
  return { ok: true, state, publishAt: publishAt ? publishAt.toISOString() : null, changed: true };
}

/** Content-library totals for the non-prompt Writing kinds (prompts are counted by the library page itself). */
export async function writingContentTotals(database: Database = db, now = new Date()): Promise<{ total: number; live: number }> {
  let total = 0; let live = 0;
  for (const kind of ["lesson", "translation", "model-text", "pattern"] as const) {
    const t = TABLE[kind];
    const rows = await database.select({ publicationState: t.publicationState, publishAt: t.publishAt }).from(t);
    total += rows.length;
    live += rows.filter((r) => isLive(r, now)).length;
  }
  return { total, live };
}
