import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { db } from "@/db/client";
import { assignments } from "@/db/schema";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { listAssignmentResponses } from "@/lib/data/coach-artifacts";
import { AssignmentBoard } from "@/components/coach/AssignmentBoard";
import { listResourceBlocksForOwners } from "@/lib/data/resources";
import { timed } from "@/lib/observability/timing";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

export const dynamic = "force-dynamic";

/** The assignment rows are core; feedback, responses, and materials are scoped adjuncts. */
async function AssignmentsContent({ user, dict }: {
  user: CurrentUser;
  dict: ReturnType<typeof getDictionary>;
}) {
  const rows = await timed("assignments.entry.core", () => db
    .select({
      id: assignments.id,
      title: assignments.title,
      description: assignments.description,
      status: assignments.status,
      dueAt: assignments.dueAt,
    })
    .from(assignments)
    .where(eq(assignments.targetUserId, user.id))
    .orderBy(desc(assignments.createdAt)));
  const ids = rows.map((row) => row.id);

  const [evaluationsResult, responsesResult, materialsResult] = await Promise.allSettled([
    timed("assignments.entry.evaluations", () => findEvaluationsForSources({ sourceType: "assignment", sourceIds: ids })),
    timed("assignments.entry.responses", () => listAssignmentResponses(ids, user.id)),
    timed("assignments.entry.materials", () => listResourceBlocksForOwners("assignment", ids)),
  ]);

  const evaluationsUnavailable = evaluationsResult.status === "rejected";
  const responsesUnavailable = responsesResult.status === "rejected";
  const materialsUnavailable = materialsResult.status === "rejected";
  const evaluations = evaluationsResult.status === "fulfilled" ? evaluationsResult.value : new Map();
  const responseByAssignment = new Map(
    (responsesResult.status === "fulfilled" ? responsesResult.value : []).map((response) => [response.assignmentId, response]),
  );
  const materialMap = materialsResult.status === "fulfilled" ? materialsResult.value : new Map();

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
    <div className="flex flex-col gap-3" data-assignment-content data-async-content="assignments">
      {evaluationsUnavailable && <RegionFailureNotice region="assignment-evaluations" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      {responsesUnavailable && <RegionFailureNotice region="assignment-responses" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      {materialsUnavailable && <RegionFailureNotice region="assignment-materials" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      <AssignmentBoard
        dict={dict}
        assignments={cards}
        materials={Object.fromEntries(materialMap)}
        metadataUnavailable={evaluationsUnavailable || responsesUnavailable}
      />
    </div>
  );
}

function AssignmentsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3" data-async-loading="assignments">
      {[0, 1, 2].map((row) => <div key={row} className="h-28 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function AssignmentsPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-route-usable="assignments">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.assignments.title}</h1>
        <p className="text-sm text-ink-500">{dict.assignments.subtitle}</p>
      </div>
      <Suspense fallback={<AssignmentsSkeleton />}>
        <AssignmentsContent user={user} dict={dict} />
      </Suspense>
    </div>
  );
}
