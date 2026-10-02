import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db/client";
import { liveWhere } from "@/lib/services/cms/publication";
import {
  writingPrompts,
  writingSubmissions,
  writingFeedback,
  typingRuns,
  resourceBlocks,
} from "@/db/schema";
import { toResourceBlockView, type ResourceBlockView } from "@/lib/data/resources";

/**
 * Every prompt, whatever its publication state — for the admin list, where a
 * draft has to be visible so that it can be published.
 */
export function listAllPrompts() {
  return db.query.writingPrompts.findMany({ orderBy: desc(writingPrompts.createdAt) });
}

export function listActivePrompts() {
  return db.query.writingPrompts.findMany({
    // Only prompts that are live right now: drafts wait, schedules open on time.
    where: liveWhere({
      publicationState: writingPrompts.publicationState,
      publishAt: writingPrompts.publishAt,
    }),
    orderBy: (p, { asc }) => [asc(p.taskType), asc(p.category)],
  });
}

/** One query for the live prompts and their attached material map. */
type ActiveWritingPrompt = Pick<
  typeof writingPrompts.$inferSelect,
  "id" | "category" | "taskType" | "prompt" | "targetWordCount"
>;

export async function listActivePromptsWithResources(): Promise<{
  prompts: ActiveWritingPrompt[];
  materials: Map<string, ResourceBlockView[]>;
}> {
  const rows = await db
    .select({ prompt: {
      id: writingPrompts.id,
      category: writingPrompts.category,
      taskType: writingPrompts.taskType,
      prompt: writingPrompts.prompt,
      targetWordCount: writingPrompts.targetWordCount,
    }, resource: resourceBlocks })
    .from(writingPrompts)
    .leftJoin(
      resourceBlocks,
      and(
        eq(resourceBlocks.ownerType, "writing"),
        eq(resourceBlocks.ownerId, writingPrompts.id),
      ),
    )
    .where(liveWhere({
      publicationState: writingPrompts.publicationState,
      publishAt: writingPrompts.publishAt,
    }))
    .orderBy(asc(writingPrompts.taskType), asc(writingPrompts.category), asc(resourceBlocks.position));

  const prompts: ActiveWritingPrompt[] = [];
  const materials = new Map<string, ResourceBlockView[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const prompt = row.prompt;
    if (!seen.has(prompt.id)) {
      prompts.push(prompt);
      seen.add(prompt.id);
    }
    if (row.resource) {
      const existing = materials.get(prompt.id) ?? [];
      existing.push(toResourceBlockView([row.resource])[0]!);
      materials.set(prompt.id, existing);
    }
  }
  return { prompts, materials };
}

export async function getSubmissionDetail(submissionId: string, userId: string) {
  const submission = await db.query.writingSubmissions.findFirst({
    where: and(eq(writingSubmissions.id, submissionId), eq(writingSubmissions.userId, userId)),
  });
  if (!submission) return null;

  const [prompt, feedback] = await Promise.all([
    db.query.writingPrompts.findFirst({ where: eq(writingPrompts.id, submission.promptId) }),
    db.query.writingFeedback.findFirst({
      where: eq(writingFeedback.submissionId, submissionId),
      orderBy: desc(writingFeedback.createdAt),
    }),
  ]);

  return { submission, prompt: prompt!, feedback: feedback ?? null };
}

export function listUserSubmissions(userId: string) {
  return db
    .select({ submission: writingSubmissions, prompt: writingPrompts })
    .from(writingSubmissions)
    .innerJoin(writingPrompts, eq(writingSubmissions.promptId, writingPrompts.id))
    .where(eq(writingSubmissions.userId, userId))
    .orderBy(desc(writingSubmissions.updatedAt));
}

/** A student's timed typing runs, newest first. Aggregates only. */
export function listTypingRuns(userId: string, limit = 10) {
  return db.query.typingRuns.findMany({
    where: eq(typingRuns.userId, userId),
    orderBy: desc(typingRuns.createdAt),
    limit,
  });
}

/**
 * Typing statistics from the student's own runs. `numeric` columns come back as
 * strings from the driver, so they are parsed here once instead of at every
 * call site.
 */
export async function typingSummary(userId: string) {
  const [summary] = await db
    .select({
      count: count(),
      bestWpm: max(typingRuns.wpm),
      bestAccuracy: max(typingRuns.accuracy),
    })
    .from(typingRuns)
    .where(eq(typingRuns.userId, userId));
  const total = Number(summary?.count ?? 0);
  return {
    count: total,
    bestWpm: total > 0 && summary?.bestWpm != null ? Number(summary.bestWpm) : null,
    bestAccuracy: total > 0 && summary?.bestAccuracy != null ? Number(summary.bestAccuracy) : null,
  };
}

/** Attached materials (Task 1 chart/map/process images etc.) for specific prompts. */
export async function resourceBlocksForPrompts(promptIds: string[]): Promise<Map<string, ResourceBlockView[]>> {
  const out = new Map<string, ResourceBlockView[]>();
  if (!promptIds.length) return out;
  const rows = await db.select().from(resourceBlocks)
    .where(and(eq(resourceBlocks.ownerType, "writing"), inArray(resourceBlocks.ownerId, promptIds)))
    .orderBy(asc(resourceBlocks.position));
  for (const row of rows) {
    const list = out.get(row.ownerId) ?? [];
    list.push(toResourceBlockView([row])[0]!);
    out.set(row.ownerId, list);
  }
  return out;
}
