import { NextRequest } from "next/server";
import { RULES } from "@/lib/http/rate-limit";
import { ownerAiStatus } from "@/lib/services/coach/owner-control";
import { listLearningSignals } from "@/lib/services/riwi/learning";
import { getActiveConflictCount, listKnowledgeSources } from "@/lib/services/riwi/knowledge";
import { enforceRiwiOwnerRate, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { readRiwiRollout } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp,
  });
  if (limited) return limited;
  try {
    const actor = { id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus };
    const [ai, sources, signals, openConflicts] = await Promise.all([
      ownerAiStatus(), listKnowledgeSources(actor), listLearningSignals(actor, 200), getActiveConflictCount(),
    ]);
    return ownerJson({
      ok: true,
      rollout: readRiwiRollout(),
      providerReadiness: ai.providers.map(({ id, displayName, type, capabilities, secretsPresent, missingSecretNames }) => ({
        id, displayName, type, capabilities, credentialConfigured: secretsPresent, missingSecretNames,
      })),
      aiPolicy: {
        deploymentCeiling: ai.deploymentCeiling,
        ownerSwitch: ai.owner.externalEnabled,
        configuredPrimaryProvider: ai.owner.providerId,
        configuredModel: ai.owner.model,
        effectivePrimaryProvider: ai.effective.providerId,
        effectiveModel: ai.effective.model,
        fallback: ai.effective.fallback,
        enabled: ai.effective.externalEnabled,
        ready: ai.effective.ready,
      },
      effectiveProvider: {
        enabled: ai.effective.externalEnabled, providerId: ai.effective.providerId,
        external: ai.effective.providerIsExternal, ready: ai.effective.ready,
      },
      configIssues: ai.configIssues.map(({ index, reason }) => ({ index, reason })),
      governance: {
        openConflicts,
        pendingKnowledgeCandidates: sources.filter((source) => source.state === "candidate").length,
        approvedKnowledgeSources: sources.filter((source) => source.state === "approved").length,
        pendingLearningReviews: signals.filter((signal) => signal.state === "candidate" || signal.state === "in_review").length,
      },
      safety: {
        arbitraryEndpointsAccepted: false, rawSecretsReturned: false,
        sourceTextShownOnlyToOwner: true, providerAgreementMeansTruth: false,
        automaticActivationOfUnverifiedKnowledge: false,
      },
    });
  } catch {
    return ownerJson({ error: { code: "riwi_diagnostics_unavailable" } }, 503);
  }
}
