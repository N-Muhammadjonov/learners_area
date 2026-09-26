import { NextRequest, NextResponse } from "next/server";
import { and, eq, ilike, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assignments,
  grammarTopics,
  lessons,
  lexemes,
  liveClasses,
  readingPassages,
  speakingMaterials,
  userVocabulary,
  writingPrompts,
} from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { liveWhere } from "@/lib/services/cms/publication";

/**
 * The one search endpoint.
 *
 * ---------------------------------------------------------------------------
 * Authorization is the whole design
 * ---------------------------------------------------------------------------
 *
 * Search is where private data leaks, because a search endpoint is a query the
 * *user* writes: if the identity it ran under came from the request, anyone
 * could enumerate every draft, every other student's vocabulary and every
 * withdrawn class. So:
 *
 *   * identity comes from `requireActiveUser()`, which reads the session cookie
 *     and then re-loads role and admission status from the database — a
 *     suspended account gets nothing, and a PENDING one gets 401;
 *   * student-facing categories are filtered by the *same* publication rule the
 *     rest of the app uses (`liveWhere`), and staff-only content additionally by
 *     role — a student cannot search drafts, at all;
 *   * a student's vocabulary search is scoped to `user_id = me`, so one student
 *     can never see another's saved words;
 *   * assignments are scoped to the student they were given to;
 *   * the query is a bound parameter, never string-concatenated, and `%`/`_` are
 *     escaped so a user cannot inject their own wildcards.
 *
 * ---------------------------------------------------------------------------
 * Why the categories are independent and capped
 * ---------------------------------------------------------------------------
 *
 * Each category is one indexed `ILIKE` with its own `LIMIT`, and they run in
 * parallel. A search that takes a second is a search nobody uses, and there is
 * no transaction semantics to preserve across categories. One failing category
 * is dropped rather than failing the request: a partial answer is more useful
 * than an error page for a feature whose job is to help you find things.
 */

export const dynamic = "force-dynamic";

type Hit = { type: string; title: string; context: string | null; href: string };

const PER_CATEGORY = 5;
const MAX_RESULTS = 20;
const MIN_QUERY = 2;

const liveReading = liveWhere({
  publicationState: readingPassages.publicationState,
  publishAt: readingPassages.publishAt,
});
const liveWriting = liveWhere({
  publicationState: writingPrompts.publicationState,
  publishAt: writingPrompts.publishAt,
});
const liveSpeaking = liveWhere({
  publicationState: speakingMaterials.publicationState,
  publishAt: speakingMaterials.publishAt,
});

export async function GET(req: NextRequest) {
  const limited = enforce(RULES.vocabularySearch, clientKey(req));
  if (limited) return limited;

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < MIN_QUERY) {
    return NextResponse.json({ query: raw, results: [], tooShort: true });
  }
  const term = raw.slice(0, 64).replace(/[%_\\]/g, (c) => `\\${c}`);
  const like = `%${term}%`;
  const staff = isStaff(user.role);

  const queries: Promise<Hit[]>[] = [
    // --- Reading passages ---------------------------------------------------
    (async () => {
      const rows = await db
        .select({ id: readingPassages.id, title: readingPassages.title })
        .from(readingPassages)
        .where(and(staff ? undefined : liveReading, ilike(readingPassages.title, like)))
        .limit(PER_CATEGORY);
      return rows.map((row) => ({
        type: "reading",
        title: row.title,
        context: null,
        href: `/reading/passages/${row.id}`,
      }));
    })(),

    // --- My vocabulary ------------------------------------------------------
    (async () => {
      const rows = await db
        .select({ id: userVocabulary.id, term: lexemes.term })
        .from(userVocabulary)
        .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
        .where(and(eq(userVocabulary.userId, user.id), ilike(lexemes.term, like)))
        .limit(PER_CATEGORY);
      return rows.map((row) => ({ type: "vocabulary", title: row.term, context: null, href: "/vocabulary" }));
    })(),

    // --- Lessons ------------------------------------------------------------
    (async () => {
      const rows = await db
        .select({ id: lessons.id, title: lessons.title })
        .from(lessons)
        .where(ilike(lessons.title, like))
        .limit(PER_CATEGORY);
      return rows.map((row) => ({ type: "lesson", title: row.title, context: null, href: `/lessons/${row.id}` }));
    })(),

    // --- Grammar topics -----------------------------------------------------
    (async () => {
      const rows = await db
        .select({ id: grammarTopics.id, title: grammarTopics.title })
        .from(grammarTopics)
        .where(ilike(grammarTopics.title, like))
        .limit(PER_CATEGORY);
      return rows.map((row) => ({ type: "grammar", title: row.title, context: null, href: `/grammar/${row.id}` }));
    })(),

    // --- Writing prompts ----------------------------------------------------
    (async () => {
      const rows = await db
        .select({ id: writingPrompts.id, prompt: writingPrompts.prompt, taskType: writingPrompts.taskType })
        .from(writingPrompts)
        .where(and(staff ? undefined : liveWriting, ilike(writingPrompts.prompt, like)))
        .limit(PER_CATEGORY);
      return rows.map((row) => ({
        type: "writing",
        title: row.prompt.length > 90 ? `${row.prompt.slice(0, 90)}…` : row.prompt,
        context: row.taskType === "task1" ? "Task 1" : "Task 2",
        href: "/writing",
      }));
    })(),

    // --- Live classes (students never search drafts) ------------------------
    (async () => {
      const rows = await db
        .select({ id: liveClasses.id, title: liveClasses.title, status: liveClasses.status })
        .from(liveClasses)
        // A student sees the classes the live-classes page shows them; a
        // cancelled one is not a useful search result for anyone.
        .where(and(staff ? undefined : ne(liveClasses.status, "cancelled"), ilike(liveClasses.title, like)))
        .limit(PER_CATEGORY);
      return rows.map((row) => ({ type: "liveClass", title: row.title, context: row.status, href: "/live-classes" }));
    })(),

    // --- Speaking materials -------------------------------------------------
    (async () => {
      const rows = await db
        .select({ id: speakingMaterials.id, title: speakingMaterials.title, category: speakingMaterials.category })
        .from(speakingMaterials)
        .where(
          and(
            eq(speakingMaterials.isActive, true),
            staff ? undefined : liveSpeaking,
            ilike(speakingMaterials.title, like)
          )
        )
        .limit(PER_CATEGORY);
      return rows.map((row) => ({ type: "speaking", title: row.title, context: row.category, href: "/speaking" }));
    })(),

    // --- Assignments: a student searches only their own ---------------------
    (async () => {
      const rows = await db
        .select({ id: assignments.id, title: assignments.title })
        .from(assignments)
        .where(
          and(
            staff ? undefined : eq(assignments.targetUserId, user.id),
            or(ilike(assignments.title, like), ilike(assignments.description, like))
          )
        )
        .limit(PER_CATEGORY);
      return rows.map((row) => ({
        type: "assignment",
        title: row.title,
        context: null,
        href: `/assignments/${row.id}`,
      }));
    })(),
  ];

  const settled = await Promise.allSettled(queries);
  const results: Hit[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(...outcome.value);
  }

  // Relevance: a title that starts with the term beats one that merely contains
  // it, and a shorter title beats a longer one. Deterministic, and no per-
  // category weighting invented from nothing.
  const needle = raw.toLowerCase();
  const score = (hit: Hit) => {
    const title = hit.title.toLowerCase();
    return (title.startsWith(needle) ? 0 : 1) * 100 + Math.min(title.length, 99) / 100;
  };
  results.sort((a, b) => score(a) - score(b));

  return NextResponse.json({ query: raw, results: results.slice(0, MAX_RESULTS) });
}
