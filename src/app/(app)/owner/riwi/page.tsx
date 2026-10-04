import { redirect } from "next/navigation";
import { OwnerRiwiControlRoom } from "@/components/riwi/OwnerRiwiControlRoom";
import { requireOwner } from "@/lib/auth/current-user";
import { MODEL_ID, ownerAiStatus } from "@/lib/services/coach/owner-control";
import { listRiwiProviderExperiments } from "@/lib/services/riwi/provider-lab";
import { readRiwiRollout } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";

export default async function OwnerRiwiPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/dashboard");

  const [status, history] = await Promise.all([
    ownerAiStatus(),
    listRiwiProviderExperiments({ id: owner.id, role: owner.role, accountStatus: owner.accountStatus }, 20)
      .then((experiments) => ({ experiments, available: true }))
      .catch(() => ({ experiments: [], available: false })),
  ]);
  const rollout = readRiwiRollout();
  const providers = status.providers
    .filter((provider) => provider.type === "external" && provider.capabilities.includes("riwi-assistant"))
    .map((provider) => ({
      id: provider.id, displayName: provider.displayName, model: provider.model && MODEL_ID.test(provider.model) ? provider.model : null,
      capabilities: provider.capabilities, secretsPresent: provider.secretsPresent, missingSecretNames: provider.missingSecretNames,
    }));
  const enabled = {
    owner: rollout.roles.owner,
    providerLab: rollout.providerLab,
    externalAi: rollout.externalAi && status.effective.externalEnabled,
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl text-ink-900">RIWI control room</h1>
        <p className="mt-1 text-sm text-ink-500">Owner-only rollout, provider readiness, fixed-fixture experiments, and normalized results.</p>
      </header>
      {!history.available && <p className="rounded-xl bg-band-warn/10 p-3 text-sm text-band-warn" role="status">Experiment history is temporarily unavailable. No new provider call has been started by loading this page.</p>}
      <OwnerRiwiControlRoom providers={providers} enabled={enabled} initialExperiments={history.experiments} />
    </main>
  );
}
