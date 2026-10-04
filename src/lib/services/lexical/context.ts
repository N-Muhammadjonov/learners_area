import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { generalMembership } from "@/lib/data/general-reading";
import { db } from "@/db/client";
import { lexicalOccurrences, lexemes, lexicalUnitPronunciations, lexicalUnits, readingAttempts, readingPassages } from "@/db/schema";
import { fullListeningDetail, listeningExamState } from "@/lib/data/full-listening";
import { lexicalAssistanceAllowed } from "@/lib/listening/lexical-policy";
import { sentenceAt } from "./listening-occurrences";
import { isStaff, type Role } from "@/lib/auth/roles";
import { readingLexicalAssistanceAllowed, type ReadingExamState, type ReadingMode } from "@/lib/reading/lexical-policy";
import { isLive } from "@/lib/services/cms/publication";

export type VocabularySourceSnapshot = {
  occurrenceId: string;
  lexemeId: string;
  sourceTitle: string;
  surfaceForm: string;
  sentenceText: string;
  /* 0029 — revisit data. Optional: snapshots written before 0029 lack them. */
  sourceType?: "reading" | "listening" | "video";
  videoLessonId?: string | null;
  /** Reading: the learner's own attempt the word was met in (revisit target). */
  attemptId?: string | null;
  passageId?: string | null;
  /** 0030 General Reading (learning mode): the set + passage slot the word was met in. No attempt exists. */
  readingMode?: "academic" | "general_practice";
  generalSetId?: string | null;
  passageNo?: number | null;
  /** Listening: test + section; audio time only when the source has word timing. */
  listeningTestId?: string | null;
  sectionNumber?: number | null;
  startMs?: number | null;
  endMs?: number | null;
};

/** Where "go back to this source" leads; null when no learner-reachable page exists. */
export function sourceRevisitHref(snapshot: Partial<VocabularySourceSnapshot> | null | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.sourceType === "video" && snapshot.videoLessonId) return `/video-lessons/${snapshot.videoLessonId}`;
  if (snapshot.sourceType === "listening" && snapshot.listeningTestId) {
    const section = snapshot.sectionNumber && snapshot.sectionNumber >= 1 && snapshot.sectionNumber <= 4 ? `?section=${snapshot.sectionNumber}` : "";
    return `/listening/tests/${snapshot.listeningTestId}/study${section}`;
  }
  if (snapshot.sourceType === "reading" && snapshot.generalSetId) {
    const passage = snapshot.passageNo && snapshot.passageNo >= 1 && snapshot.passageNo <= 3 ? `?passage=${snapshot.passageNo}` : "";
    return `/reading/general/${snapshot.generalSetId}${passage}`;
  }
  if (snapshot.attemptId) return `/reading/attempts/${snapshot.attemptId}`;
  return null;
}

/** Resolve authority afresh on lookup AND save. A guessed occurrence is not access. */
/** `allowDraft` (staff only) finds an unpublished passage; the mode/permission decision still follows. */
export async function resolveReadingOccurrence(userId: string, sourceId: string, occurrenceId: string, allowDraft = false, database: typeof db = db) {
  const attempt = await database.query.readingAttempts.findFirst({ where: and(eq(readingAttempts.id, sourceId), eq(readingAttempts.userId, userId)) });
  const passage = await database.query.readingPassages.findFirst({ where: eq(readingPassages.id, attempt?.passageId ?? sourceId) });
  if (!passage || (!attempt && !allowDraft && !isLive(passage))) return null;
  const [row] = await database.select({ occurrence: lexicalOccurrences, lexeme: lexemes }).from(lexicalOccurrences)
    .innerJoin(lexemes, eq(lexemes.id, lexicalOccurrences.lexemeId))
    .where(and(eq(lexicalOccurrences.id, occurrenceId), eq(lexicalOccurrences.passageId, passage.id)));
  if (!row) return null;
  const occurrence = row.occurrence;
  if (occurrence.startChar < 0 || occurrence.endChar <= occurrence.startChar
    || passage.bodyText.slice(occurrence.startChar, occurrence.endChar).toLowerCase() !== occurrence.surfaceForm.toLowerCase()) return null;
  // Retain only a short authentic excerpt, not the entire learning material.
  const suppliedSentence = occurrence.sentenceText?.trim();
  const sentenceText = suppliedSentence && passage.bodyText.includes(suppliedSentence) && suppliedSentence.length <= 600
    ? suppliedSentence : passage.bodyText.slice(Math.max(0, occurrence.startChar - 160), occurrence.endChar + 160);
  return { lexeme: row.lexeme, snapshot: {
    occurrenceId: occurrence.id, lexemeId: row.lexeme.id, sourceTitle: passage.title.slice(0, 240),
    surfaceForm: occurrence.surfaceForm, sentenceText,
    sourceType: "reading", attemptId: attempt?.id ?? null, passageId: passage.id,
  } satisfies VocabularySourceSnapshot };
}

// ---------------------------------------------------------------------------
// Listening (0029) — the same occurrence-first rule as Reading.
// ---------------------------------------------------------------------------

export type OccurrenceResolution =
  | { status: "resolved"; lexeme: typeof lexemes.$inferSelect; snapshot: VocabularySourceSnapshot }
  /** Content exists and is accessible, but the learner's mode forbids lexical help (Listening/Reading exam not submitted or open). */
  | { status: "locked"; lexeme: null; snapshot: null }
  /** The span is known but no sense has been checked for it. Never paired with a meaning. */
  | { status: "unresolved"; lexeme: null; snapshot: Omit<VocabularySourceSnapshot, "lexemeId"> & { lexemeId: null } };


/**
 * Resolve a Listening transcript occurrence for THIS learner, re-checking access
 * (live test, or staff) and that the offsets still point at the same characters
 * of the CURRENT transcript. A stale or foreign occurrence is not a meaning.
 */
export async function resolveListeningOccurrence(user: { id: string; role: Role }, testId: string, occurrenceId: string, database: typeof db = db): Promise<OccurrenceResolution | null> {
  const detail = await fullListeningDetail(testId, user.role, database);
  if (!detail) return null;
  // Exam integrity: occurrence data may exist before the exam; revealing it may not.
  if (!lexicalAssistanceAllowed("REVIEW_CONTROL", await listeningExamState(user, testId, database))) return { status: "locked", lexeme: null, snapshot: null };
  const occurrence = await database.query.lexicalOccurrences.findFirst({
    where: and(eq(lexicalOccurrences.id, occurrenceId), eq(lexicalOccurrences.listeningTestId, testId), eq(lexicalOccurrences.sourceType, "listening")),
  });
  if (!occurrence || occurrence.sectionNumber === null) return null;
  const transcript = detail.pkg.payload.sections.find((section) => section.number === occurrence.sectionNumber)?.transcript ?? "";
  if (occurrence.startChar < 0 || occurrence.endChar <= occurrence.startChar
    || transcript.slice(occurrence.startChar, occurrence.endChar).toLowerCase() !== occurrence.surfaceForm.toLowerCase()) return null;
  const base = {
    occurrenceId: occurrence.id, sourceTitle: detail.test.title.slice(0, 240), surfaceForm: occurrence.surfaceForm,
    sentenceText: sentenceAt(transcript, occurrence.startChar, occurrence.endChar),
    sourceType: "listening" as const, listeningTestId: testId, sectionNumber: occurrence.sectionNumber,
    startMs: occurrence.startMs, endMs: occurrence.endMs,
  };
  if (occurrence.resolutionStatus !== "resolved" || !occurrence.lexemeId) return { status: "unresolved", lexeme: null, snapshot: { ...base, lexemeId: null } };
  const lexeme = await database.query.lexemes.findFirst({ where: eq(lexemes.id, occurrence.lexemeId) });
  if (!lexeme) return { status: "unresolved", lexeme: null, snapshot: { ...base, lexemeId: null } };
  return { status: "resolved", lexeme, snapshot: { ...base, lexemeId: lexeme.id } };
}

/**
 * Reading mode of a lookup source and the learner's exam state for its passage.
 * An owned attempt id: in progress → ACADEMIC_EXAM, submitted → ACADEMIC_REVIEW.
 * A bare passage id: every current passage is an Academic test, so it is treated
 * as ACADEMIC_REVIEW — open only after a submitted attempt (closes the bypass of
 * calling the endpoint with the passage id during an exam).
 */
export async function readingLexicalAccess(user: { id: string; role: Role }, sourceId: string, passageId: string, database: typeof db = db) {
  // The mode comes from persisted classification only (0030), never from the request.
  const general = await generalMembership(passageId, database);
  if (general) {
    const state: ReadingExamState = { submitted: false, examInProgress: false, staff: isStaff(user.role) };
    // A withdrawn set is not a learning source for students.
    return { mode: (isLive(general.set) || state.staff ? "GENERAL_READING" : "ACADEMIC_EXAM") as ReadingMode, state, general };
  }
  const attempts = await database.select({ id: readingAttempts.id, status: readingAttempts.status }).from(readingAttempts)
    .where(and(eq(readingAttempts.userId, user.id), eq(readingAttempts.passageId, passageId)));
  const own = attempts.find((attempt) => attempt.id === sourceId);
  const mode: ReadingMode = own?.status === "in_progress" ? "ACADEMIC_EXAM" : "ACADEMIC_REVIEW";
  const state: ReadingExamState = {
    submitted: attempts.some((attempt) => attempt.status === "completed"),
    examInProgress: attempts.some((attempt) => attempt.status === "in_progress"),
    staff: isStaff(user.role),
  };
  return { mode, state, general: null };
}

/**
 * VD-001: a Reading save that carries NO occurrence (the learner's own meaning for an
 * unresolved word) still obeys the Reading mode policy and needs a real source:
 * this learner's attempt, or a passage they may see. Never decided by the request.
 */
export async function readingSourceAccess(user: { id: string; role: Role }, sourceId: string): Promise<"allowed" | "locked" | "not_found"> {
  const attempt = await db.query.readingAttempts.findFirst({ where: and(eq(readingAttempts.id, sourceId), eq(readingAttempts.userId, user.id)) });
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, attempt?.passageId ?? sourceId) });
  if (!passage) return "not_found";
  const { mode, state, general } = await readingLexicalAccess(user, sourceId, passage.id);
  if (!attempt && !isLive(passage) && !(general && state.staff)) return "not_found";
  if (general && mode !== "GENERAL_READING") return "not_found";
  return readingLexicalAssistanceAllowed(mode, state) ? "allowed" : "locked";
}

/**
 * A Reading occurrence that is known (offsets proven against the body) but has no
 * checked sense — e.g. "river bank" where only the financial bank was authored.
 * Same source validation as resolveReadingOccurrence; never paired with a meaning.
 */
async function unresolvedReadingOccurrence(userId: string, sourceId: string, occurrenceId: string, allowDraft = false, database: typeof db = db) {
  const attempt = await database.query.readingAttempts.findFirst({ where: and(eq(readingAttempts.id, sourceId), eq(readingAttempts.userId, userId)) });
  const passage = await database.query.readingPassages.findFirst({ where: eq(readingPassages.id, attempt?.passageId ?? sourceId) });
  if (!passage || (!attempt && !allowDraft && !isLive(passage))) return null;
  const occurrence = await database.query.lexicalOccurrences.findFirst({ where: and(eq(lexicalOccurrences.id, occurrenceId), eq(lexicalOccurrences.passageId, passage.id), isNull(lexicalOccurrences.lexemeId)) });
  if (!occurrence || occurrence.startChar < 0 || occurrence.endChar <= occurrence.startChar
    || passage.bodyText.slice(occurrence.startChar, occurrence.endChar).toLowerCase() !== occurrence.surfaceForm.toLowerCase()) return null;
  return { passageId: passage.id, snapshot: {
    occurrenceId: occurrence.id, sourceTitle: passage.title.slice(0, 240), surfaceForm: occurrence.surfaceForm,
    sentenceText: occurrence.sentenceText ?? passage.bodyText.slice(Math.max(0, occurrence.startChar - 160), occurrence.endChar + 160),
    sourceType: "reading" as const, attemptId: attempt?.id ?? null, passageId: passage.id,
  } };
}

/** One entry point for every source type that has occurrences. */
export async function resolveOccurrence(user: { id: string; role: Role }, sourceType: string, sourceId: string, occurrenceId: string, database: typeof db = db): Promise<OccurrenceResolution | null> {
  if (sourceType === "listening") return resolveListeningOccurrence(user, sourceId, occurrenceId, database);
  if (sourceType === "reading") {
    const staff = isStaff(user.role);
    const reading = await resolveReadingOccurrence(user.id, sourceId, occurrenceId, staff, database);
    const pending = reading ? null : await unresolvedReadingOccurrence(user.id, sourceId, occurrenceId, staff, database);
    if (!reading && !pending) return null;
    // Exam integrity: the occurrence is valid data, but an open Academic attempt
    // (this one or another of the same passage) may not reveal it. General Reading
    // is decided by the passage's persisted classification.
    const passageId = (reading?.snapshot.passageId ?? pending?.passageId)!;
    const { mode, state, general } = await readingLexicalAccess(user, sourceId, passageId, database);
    if (!readingLexicalAssistanceAllowed(mode, state)) return { status: "locked", lexeme: null, snapshot: null };
    const generalContext = general ? { readingMode: "general_practice" as const, generalSetId: general.setId, passageNo: general.passageNo } : {};
    if (!reading) return { status: "unresolved", lexeme: null, snapshot: { ...pending!.snapshot, ...generalContext, lexemeId: null } };
    return { status: "resolved", lexeme: reading.lexeme, snapshot: { ...reading.snapshot, ...generalContext } };
  }
  return null;
}

/** Display data of the sense's lexeme: lemma, type, POS and a pronunciation only if one is stored. */
export async function lexicalDetailFor(lexeme: { lexicalUnitId: string | null }, database: typeof db = db) {
  if (!lexeme.lexicalUnitId) return null;
  const unit = await database.query.lexicalUnits.findFirst({ where: eq(lexicalUnits.id, lexeme.lexicalUnitId) });
  if (!unit) return null;
  const pronunciation = await database.query.lexicalUnitPronunciations.findFirst({ where: eq(lexicalUnitPronunciations.lexicalUnitId, unit.id) });
  return { lemma: unit.lemma, lexicalType: unit.lexicalType, partOfSpeech: unit.partOfSpeech || null, ipa: pronunciation?.ipa ?? null };
}
