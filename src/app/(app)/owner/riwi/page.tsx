import { redirect } from "next/navigation";
import { AiControlPanel } from "@/components/owner/AiControlPanel";
import { OwnerRiwiControlRoom } from "@/components/riwi/OwnerRiwiControlRoom";
import { OwnerRiwiGovernance } from "@/components/riwi/OwnerRiwiGovernance";
import { OwnerAssessmentPolicyPanel } from "@/components/riwi/OwnerAssessmentPolicyPanel";
import { requireOwner } from "@/lib/auth/current-user";
import { MODEL_ID, ownerAiStatus } from "@/lib/services/coach/owner-control";
import { countRiwiProviderExperiments, listRiwiProviderExperimentPage } from "@/lib/services/riwi/provider-lab";
import { readRiwiRollout } from "@/lib/services/riwi/rollout";
import { getDictionary, getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function OwnerRiwiPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/dashboard");

  const [status, history, locale] = await Promise.all([
    ownerAiStatus(),
    Promise.all([
      listRiwiProviderExperimentPage({ id: owner.id, role: owner.role, accountStatus: owner.accountStatus }, { limit: 20 }),
      countRiwiProviderExperiments({ id: owner.id, role: owner.role, accountStatus: owner.accountStatus }),
    ]).then(([page, experimentCount]) => ({ ...page, experimentCount, available: true }))
      .catch(() => ({ experiments: [], nextCursor: null, experimentCount: 0, available: false })),
    getLocale(),
  ]);
  const dict = getDictionary(locale);
  const rollout = readRiwiRollout();
  const aiInitial = { ...status, owner: { ...status.owner, updatedAt: status.owner.updatedAt?.toISOString() ?? null } };
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
    <main className="mx-auto flex max-w-6xl flex-col gap-5 pb-8">
      <header>
        <h1 className="font-display text-2xl text-ink-900">{dict.owner.riwi}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">{dict.riwiLab.pageDescription}</p>
      </header>
      <AiControlPanel dict={dict} initial={aiInitial} />
      {!history.available && <p className="rounded-xl bg-band-warn/10 p-3 text-sm text-band-warn" role="status">{dict.riwiLab.historyUnavailable}</p>}
      <OwnerRiwiControlRoom
        key={owner.id}
        providers={providers}
        enabled={enabled}
        initialExperiments={history.experiments}
        initialNextCursor={history.nextCursor}
        initialExperimentCount={history.experimentCount}
        text={dict.riwiLab}
      />
      <OwnerRiwiGovernance locale={locale} />
      <OwnerAssessmentPolicyPanel key={owner.id} locale={locale} />
    </main>
  );
}
