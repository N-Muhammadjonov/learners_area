/**
 * Evaluation attribution — two audiences, never mixed (owner rule, 2026-10-03).
 *
 *  - PUBLIC (learners, learner APIs, learner HTML): always "Checked by RIWI". A
 *    fixed constant — not configuration — so no env value, provider id, vendor
 *    name or model can reach a learner surface.
 *  - INTERNAL (staff/owner audit): the truthful provenance stored on the
 *    evaluation row at evaluation time — actual provider id/name/type, model,
 *    provider/prompt/rubric versions, fallback usage and timestamp. External AI is
 *    never relabelled internally, and RIWI branding never erases traceability.
 */
export const PUBLIC_CHECKED_BY = "RIWI" as const;

export type InternalProvenance = {
  evaluationId?: string;
  evaluationType?: "writing" | "speaking" | "grammar" | "vocabulary" | "assignment";
  correlationId?: string;
  validationStatus?: "validated";
  providerId: string;
  providerDisplayName: string;
  providerType: "internal" | "external";
  providerVersion: string;
  model: string | null;
  promptVersion: string;
  rubricVersion: string;
  fallbackUsed: boolean;
  fallbackFrom: string | null;
  createdAt: Date;
};

export function internalProvenance(row: InternalProvenance): InternalProvenance {
  const { evaluationId, evaluationType, correlationId, validationStatus,
    providerId, providerDisplayName, providerType, providerVersion, model, promptVersion, rubricVersion,
    fallbackUsed, fallbackFrom, createdAt } = row;
  return {
    ...(evaluationId ? { evaluationId } : {}), ...(evaluationType ? { evaluationType } : {}),
    ...(correlationId ? { correlationId } : {}), ...(validationStatus ? { validationStatus } : {}),
    providerId, providerDisplayName, providerType, providerVersion, model, promptVersion, rubricVersion,
    fallbackUsed, fallbackFrom, createdAt,
  };
}

/** One-line audit label for staff surfaces only. */
export function staffProvenanceLabel(p: Omit<InternalProvenance, "createdAt">): string {
  return [
    `${p.providerDisplayName} (${p.providerId}, ${p.providerType})`,
    p.model ? `model ${p.model}` : null,
    `v${p.providerVersion} · prompt ${p.promptVersion} · rubric ${p.rubricVersion}`,
    p.fallbackUsed ? `fallback${p.fallbackFrom ? ` from ${p.fallbackFrom}` : ""}` : null,
  ].filter(Boolean).join(" · ");
}
