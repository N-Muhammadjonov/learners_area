"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";
import { formatDate } from "@/lib/time";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import type { ResourceBlockView } from "@/lib/data/resources";
import { apiErrorMessage } from "@/lib/api-error-message";

export type AssignmentCard = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  response: string | null;
  evaluation: { checkedByName: string; verdict: string | null } | null;
};

/**
 * Submitting an assignment hands the work to AssignmentEvaluationService, which
 * decides which specialised evaluator (if any) should look at it. The label at
 * the bottom names whoever actually produced the feedback.
 */
export function AssignmentBoard({
  dict,
  assignments,
  materials,
  metadataUnavailable = false,
}: {
  dict: Dictionary;
  assignments: AssignmentCard[];
  metadataUnavailable?: boolean;
  /**
   * Material attached to each assignment by an administrator, keyed by id.
   * Injected rather than fetched here: the page already has every assignment in
   * one query, and a client component has no business reading the database.
   */
  materials: Record<string, ResourceBlockView[]>;
}) {
  const t = dict.assignments;
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(assignments.map((a) => [a.id, a.response ?? ""]))
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(assignment: AssignmentCard) {
    const response = (drafts[assignment.id] ?? "").trim();
    if (response.length < 20) {
      setErrors((prev) => ({ ...prev, [assignment.id]: t.tooShort }));
      return;
    }
    setBusyId(assignment.id);
    setErrors((prev) => ({ ...prev, [assignment.id]: "" }));
    const res = await fetch(`/api/assignments/${assignment.id}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrors((prev) => ({ ...prev, [assignment.id]: apiErrorMessage(data.error, res.status, dict) }));
      return;
    }
    router.refresh();
  }

  if (assignments.length === 0) {
    return <Card><p className="text-sm text-ink-500">{t.empty}</p></Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {assignments.map((assignment) => (
        <Card key={assignment.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink-900">{assignment.title}</p>
            <span className="badge">{t.status[assignment.status as "not_started" | "completed"] ?? assignment.status}</span>
          </div>
          {assignment.description && (
            <p className="text-sm text-ink-500">{assignment.description}</p>
          )}
          {assignment.dueAt && (
            <p className="text-xs text-ink-300">
              {t.due} {formatDate(assignment.dueAt)}
            </p>
          )}

          <ResourceBlocks dict={dict} blocks={materials[assignment.id] ?? []} />

          {metadataUnavailable ? (
            <p className="text-xs text-band-warn" role="status" data-assignment-metadata-unavailable>
              {dict.errors.unknown}
            </p>
          ) : assignment.evaluation ? (
            <p className="text-xs text-ink-500" data-checked-by={assignment.evaluation.checkedByName}>
              {dict.coach.checkedBy} {assignment.evaluation.checkedByName}
              {assignment.evaluation.verdict
                ? ` · ${(dict.coach.verdicts as Record<string, string>)[assignment.evaluation.verdict]}`
                : ""}
            </p>
          ) : (
            <>
              <label htmlFor={`response-${assignment.id}`} className="text-sm font-medium text-ink-700">
                {t.responseLabel}
              </label>
              <textarea
                id={`response-${assignment.id}`}
                className="input min-h-[120px]"
                value={drafts[assignment.id] ?? ""}
                disabled={busyId === assignment.id}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [assignment.id]: e.target.value }))}
              />
              {errors[assignment.id] && (
                <p className="text-xs text-band-bad">{errors[assignment.id]}</p>
              )}
              <div>
                <Button
                  disabled={busyId === assignment.id}
                  onClick={() => void submit(assignment)}
                >
                  {busyId === assignment.id ? dict.common.saving : t.submit}
                </Button>
              </div>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
