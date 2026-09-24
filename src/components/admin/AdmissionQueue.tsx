"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { AccessRequestRow } from "@/lib/data/admission";

/**
 * Approve / reject one access request.
 *
 * The decision is posted to a route that re-reads the actor's role from the
 * database; the applicant is identified by the request id, never by anything the
 * browser supplies, so a student cannot approve themselves by editing a payload.
 */
export function AdmissionQueue({
  dict,
  requests,
}: {
  dict: Dictionary;
  requests: AccessRequestRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/admin/admission/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: note[id]?.trim() || null }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`${dict.people.failed} (${data.error ?? res.status})`);
      return;
    }
    router.refresh();
  }

  if (requests.length === 0) {
    return <p className="text-sm text-ink-500">{dict.admission.reviewEmpty}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-band-bad">{error}</p>}
      {requests.map((request) => (
        <div
          key={request.id}
          className="card flex flex-col gap-3 p-4"
          data-access-request={request.id}
          data-applicant={request.applicantEmail ?? request.applicantName}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-ink-900">{request.applicantName}</p>
              <p className="text-xs text-ink-300">
                {request.applicantEmail ?? "—"} ·{" "}
                {dict.admission.requestedOn} {request.createdAt.toISOString().slice(0, 10)}
              </p>
            </div>
            <span className="badge bg-band-warn/10 text-band-warn">{dict.admission.statusPending}</span>
          </div>

          {request.message && (
            <p className="rounded-sm bg-paper-sunken p-3 text-xs text-ink-500">{request.message}</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input flex-1 text-xs"
              placeholder={dict.admission.notePlaceholder}
              value={note[request.id] ?? ""}
              onChange={(event) => setNote({ ...note, [request.id]: event.target.value })}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={busy === request.id}
                onClick={() => void decide(request.id, "approve")}
              >
                {dict.admission.approve}
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={busy === request.id}
                onClick={() => void decide(request.id, "reject")}
              >
                {dict.admission.reject}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
