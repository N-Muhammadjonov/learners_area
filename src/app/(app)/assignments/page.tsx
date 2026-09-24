import { desc, eq } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { db } from "@/db/client";
import { assignments } from "@/db/schema";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { getAssignmentResponse } from "@/lib/data/coach-artifacts";
import { AssignmentBoard } from "@/components/coach/AssignmentBoard";

export const dynamic = "force-dynamic";

/**
 * A student's assignments.
 *
 * Assignments whose writing prompt has been submitted are evaluated by
 * WritingEvaluationService; the rest are submitted as a free-form response and
 * evaluated by whichever provider the resolver selects. Evaluate the response
 * through /api/assignments/:id/evaluate, which is the orchestrator — this page
 * never calls a provider itself.
 */
export default async function AssignmentsPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());

  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.targetUserId, user.id))
    .orderBy(desc(assignments.createdAt));

  const evaluations = await findEvaluationsForSources({
    sourceType: "assignment",
    sourceIds: rows.map((row) => row.id),
  });

  const responses = await Promise.all(
    rows.map(async (row) => [row.id, await getAssignmentResponse(row.id, user.id)] as const)
  );
  const responseByAssignment = new Map(responses);

  const cards = rows.map((row) => {
    const evaluation = evaluations.get(row.id);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      response: responseByAssignment.get(row.id)?.content ?? null,
      evaluation: evaluation
        ? { checkedByName: evaluation.checkedByName, verdict: evaluation.verdict }
        : null,
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.assignments.title}</h1>
        <p className="text-sm text-ink-500">{dict.assignments.subtitle}</p>
      </div>
      <AssignmentBoard dict={dict} assignments={cards} />
    </div>
  );
}
