"use client";

import { useState, useRef, type FormEvent } from "react";
import { z } from "zod";

const normalizedSchema = z.object({
  answer: z.string().max(6000), uncertainty: z.string().max(600).nullable(), citations: z.array(z.string().regex(/^K[1-5]$/)).max(5),
}).strict().nullable();
const experimentSchema = z.object({
  id: z.string().uuid(), taskProfile: z.string().max(60), fixtureId: z.string().max(120),
  providers: z.array(z.string().max(60)).max(2), state: z.enum(["pending", "running", "completed", "partial", "failed"]),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  comparison: z.object({
    method: z.literal("normalized_exact_answer_text"), status: z.enum(["compared", "not_comparable"]),
    providerIds: z.array(z.string().max(60)).max(2), exactAnswerMatch: z.boolean().nullable(),
  }).strict().nullable(),
  results: z.array(z.object({
    providerId: z.string().max(60), model: z.string().max(120).nullable(), state: z.string().max(24),
    normalizedResult: normalizedSchema, durationMs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(), safeErrorCode: z.string().max(60).nullable(),
  }).strict()).max(2),
}).strict();
const apiResponseSchema = z.object({ ok: z.literal(true), replay: z.boolean(), experiment: experimentSchema }).strict();

type LabProvider = {
  id: string;
  displayName: string;
  model: string | null;
  capabilities: string[];
  secretsPresent: boolean;
  missingSecretNames: string[];
};
type Experiment = z.infer<typeof experimentSchema>;
type LabEnabled = { owner: boolean; providerLab: boolean; externalAi: boolean };

const fixtures = [
  { id: "safe-grammar-explanation-v1", label: "Safe grammar explanation" },
  { id: "knowledge-untrusted-data-v1", label: "Untrusted knowledge excerpt" },
] as const;

function resultLabel(state: string) {
  switch (state) {
    case "succeeded": return "Succeeded";
    case "externally_unverified": return "Externally unverified";
    case "capability_missing": return "Capability unavailable";
    case "timeout": return "Timed out";
    case "invalid_response": return "Invalid normalized response";
    case "audit_failed": return "Audit unavailable; request not sent";
    case "result_audit_failed": return "Audit unavailable; result withheld";
    case "cancelled": return "Cancelled";
    default: return "Provider unavailable";
  }
}

function stateTone(state: string) {
  if (state === "succeeded" || state === "completed") return "bg-band-good/10 text-band-good";
  if (state === "externally_unverified" || state === "partial" || state === "running") return "bg-band-warn/10 text-band-warn";
  return "bg-band-bad/10 text-band-bad";
}

export function OwnerRiwiControlRoom({
  providers,
  enabled,
  initialExperiments,
}: {
  providers: LabProvider[];
  enabled: LabEnabled;
  initialExperiments: Experiment[];
}) {
  const [fixtureId, setFixtureId] = useState<(typeof fixtures)[number]["id"]>(fixtures[0].id);
  const [providerIds, setProviderIds] = useState<string[]>(() => providers.slice(0, 1).map((provider) => provider.id));
  const [experiments, setExperiments] = useState(initialExperiments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingIdempotency = useRef<{ fingerprint: string; key: string } | null>(null);

  function toggleProvider(id: string) {
    setProviderIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length >= 2 ? current : [...current, id];
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || providerIds.length < 1 || providerIds.length > 2) return;
    setBusy(true);
    setError("");
    setNotice("");
    const fingerprint = `${fixtureId}:${providerIds.join(",")}`;
    const key = pendingIdempotency.current?.fingerprint === fingerprint
      ? pendingIdempotency.current.key
      : crypto.randomUUID();
    pendingIdempotency.current = { fingerprint, key };
    try {
      const response = await fetch("/api/riwi/owner/provider-lab", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ fixtureId, providerIds, idempotencyKey: key }),
      });
      const parsed = apiResponseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) {
        const code = response.status === 429 ? "Rate limit reached. Wait before running another fixed fixture." : "The experiment could not be completed safely.";
        throw new Error(code);
      }
      const { experiment } = parsed.data;
      setExperiments((current) => [experiment, ...current.filter((item) => item.id !== experiment.id)].slice(0, 20));
      pendingIdempotency.current = null;
      setNotice(parsed.data.replay ? "This idempotency key already has a recorded experiment; it was not called again." : "The fixed-fixture experiment was recorded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The experiment could not be completed safely.");
    } finally {
      setBusy(false);
    }
  }

  const mayRun = enabled.owner && enabled.providerLab && providerIds.length > 0 && providerIds.length <= 2;
  return (
    <div className="flex flex-col gap-5" data-riwi-owner-control-room>
      <section className="card flex flex-col gap-4 p-5" aria-labelledby="riwi-lab-title">
        <div>
          <h2 id="riwi-lab-title" className="font-display text-xl text-ink-900">Fixed-fixture provider lab</h2>
          <p className="mt-1 text-sm text-ink-500">Only registered providers and built-in sanitized fixtures are accepted. Learner text, prompts, URLs, model names, keys, and arbitrary payloads are never sent by this form.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3" aria-label="RIWI rollout readiness">
          <Readiness label="Owner rollout" enabled={enabled.owner} />
          <Readiness label="Provider lab" enabled={enabled.providerLab} />
          <Readiness label="External AI" enabled={enabled.externalAi} />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 border-t border-ink-100 pt-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">
            Fixed fixture
            <select className="w-full rounded-xl border border-ink-100 bg-paper-sunken px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-signal-600" value={fixtureId} onChange={(event) => setFixtureId(event.target.value as typeof fixtureId)} disabled={busy}>
              {fixtures.map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.label}</option>)}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-700">Registered external providers (maximum two)</legend>
            {providers.length === 0 && <p className="text-sm text-ink-500">No registered RIWI assistant providers are available.</p>}
            {providers.map((provider) => {
              const checked = providerIds.includes(provider.id);
              const disabled = busy || (!checked && providerIds.length >= 2);
              return (
                <label key={provider.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 p-3 text-sm">
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleProvider(provider.id)} />
                  <span className="font-medium text-ink-800">{provider.displayName}</span>
                  <span className="font-mono text-xs text-ink-500">{provider.id}{provider.model ? ` · ${provider.model}` : ""}</span>
                  <span className={`ml-auto badge ${provider.secretsPresent ? "bg-band-good/10 text-band-good" : "bg-band-warn/10 text-band-warn"}`}>
                    {provider.secretsPresent ? "Credential configured" : "Externally unverified"}
                  </span>
                  {!provider.secretsPresent && provider.missingSecretNames.length > 0 && (
                    <span className="w-full text-xs text-ink-500">Missing environment-variable names only: {provider.missingSecretNames.join(", ")}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={!mayRun || busy || providerIds.length === 0}>
              {busy ? "Running bounded test…" : "Run fixed fixture"}
            </button>
            {!enabled.providerLab && <span className="text-xs text-band-warn">RIWI_PROVIDER_LAB_ENABLED is off; external calls are not available.</span>}
            {enabled.providerLab && !enabled.externalAi && <span className="text-xs text-band-warn">External AI is off; runs will be recorded as externally unverified.</span>}
          </div>
        </form>
        <p className="rounded-xl bg-paper-sunken p-3 text-xs leading-5 text-ink-500">
          The hard resource bounds are one active experiment per owner, at most two active experiments globally, four runs per owner per hour, twelve runs globally per hour, at most two registered providers per run, one fixed request per provider, a 1,200-token output ceiling per request, and one 25-second experiment-wide provider-call deadline. Token counts are shown only when reported by the provider. Monetary spend remains unknown because no pricing telemetry or enforceable vendor-side spend ceiling is available; bounded requests are not represented as free.
        </p>
        {notice && <p className="text-sm text-band-good" role="status">{notice}</p>}
        {error && <p className="text-sm text-band-bad" role="alert">{error}</p>}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="riwi-experiment-history-title">
        <div>
          <h2 id="riwi-experiment-history-title" className="font-display text-xl text-ink-900">Experiment history</h2>
          <p className="text-xs text-ink-500">Normalized results only; no raw vendor response bodies or fixture prompt payloads are stored.</p>
        </div>
        {experiments.length === 0 && <div className="card p-5 text-sm text-ink-500">No provider experiments have been recorded.</div>}
        {experiments.map((experiment) => (
          <article key={experiment.id} className="card flex flex-col gap-3 p-5" data-experiment={experiment.id}>
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-ink-900">{fixtures.find((fixture) => fixture.id === experiment.fixtureId)?.label ?? "Registered fixture"}</p>
                <p className="text-xs text-ink-500">{new Date(experiment.createdAt).toLocaleString()} · {experiment.providers.join(" vs ")}</p>
              </div>
              <span className={`badge ${stateTone(experiment.state)}`}>{experiment.state}</span>
            </header>
            {experiment.comparison && (
              <div className="rounded-xl bg-paper-sunken p-3 text-sm" aria-label="Literal provider answer comparison">
                <p className="font-medium text-ink-800">Literal normalized-answer comparison</p>
                {experiment.comparison.status === "not_comparable" ? (
                  <p className="mt-1 text-ink-600">Not comparable: two successful normalized answers are required.</p>
                ) : (
                  <p className="mt-1 text-ink-600">
                    {experiment.comparison.exactAnswerMatch ? "Exact normalized answer text matches." : "Normalized answer text differs; review both outputs."}
                  </p>
                )}
                <p className="mt-1 text-xs text-ink-500">Text comparison only—not semantic equivalence, factual accuracy, or model quality.</p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {experiment.results.map((result) => (
                <div key={result.providerId} className="rounded-xl border border-ink-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-800">{result.providerId}{result.model ? ` · ${result.model}` : ""}</span>
                    <span className={`badge ${stateTone(result.state)}`}>{resultLabel(result.state)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{result.durationMs > 0 ? `${result.durationMs} ms` : "Provider call not made"} · input/output tokens {result.inputTokens === null && result.outputTokens === null ? "not reported" : `${result.inputTokens ?? "?"}/${result.outputTokens ?? "?"}`} · cost {result.estimatedCostMicros === null ? "unknown" : "estimated"}</p>
                  {result.safeErrorCode && <p className="mt-2 text-xs text-ink-500">Safe status: {result.safeErrorCode}</p>}
                  {result.normalizedResult && (
                    <div className="mt-3 border-t border-ink-100 pt-3 text-sm text-ink-700">
                      <p className="whitespace-pre-wrap">{result.normalizedResult.answer}</p>
                      {result.normalizedResult.uncertainty && <p className="mt-2 text-xs text-band-warn">Uncertainty: {result.normalizedResult.uncertainty}</p>}
                      {result.normalizedResult.citations.length > 0 && <p className="mt-2 text-xs text-ink-500">Citations: {result.normalizedResult.citations.join(", ")}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-300">Reported monetary cost: {experiment.results.length > 0 && experiment.results.every((result) => result.estimatedCostMicros !== null)
              ? `${experiment.results.reduce((sum, result) => sum + (result.estimatedCostMicros ?? 0), 0)} micro-units`
              : "unknown (not zero or free; provider pricing telemetry is unavailable)"}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function Readiness({ label, enabled }: { label: string; enabled: boolean }) {
  return <div className={`rounded-xl px-3 py-2 text-xs ${enabled ? "bg-band-good/10 text-band-good" : "bg-ink-100 text-ink-500"}`}>
    {label}: {enabled ? "enabled" : "off"}
  </div>;
}
