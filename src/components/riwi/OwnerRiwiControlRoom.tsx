"use client";

import { useEffect, useState, useRef, type FormEvent } from "react";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
import { z } from "zod";
import type { Dictionary } from "@/lib/i18n/en";

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
const historyPageSchema = z.object({
  ok: z.literal(true), experiments: z.array(experimentSchema).max(50),
  nextCursor: z.string().max(2048).nullable(), experimentCount: z.number().int().nonnegative(),
}).strip();
function appendUniqueExperiments(current: Experiment[], incoming: Experiment[]): Experiment[] {
  const seen = new Set(current.map((item) => item.id));
  const result = [...current];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

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
type RiwiLabCopy = Dictionary["riwiLab"];
type FixtureId = "safe-grammar-explanation-v1" | "knowledge-untrusted-data-v1";

const initialFixture: FixtureId = "safe-grammar-explanation-v1";
const fixtures: readonly FixtureId[] = [initialFixture, "knowledge-untrusted-data-v1"];

function interpolate(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => values[key] ?? "");
}

function fixtureLabel(id: string, text: RiwiLabCopy) {
  return id === "safe-grammar-explanation-v1" ? text.safeGrammarFixture
    : id === "knowledge-untrusted-data-v1" ? text.untrustedKnowledgeFixture
      : text.registeredFixture;
}

function resultLabel(state: string, text: RiwiLabCopy) {
  switch (state) {
    case "succeeded": return text.resultSucceeded;
    case "externally_unverified": return text.resultExternallyUnverified;
    case "capability_missing": return text.resultCapabilityMissing;
    case "timeout": return text.resultTimeout;
    case "invalid_response": return text.resultInvalid;
    case "audit_failed": return text.resultAuditRequestFailed;
    case "result_audit_failed": return text.resultAuditWithheld;
    case "cancelled": return text.resultCancelled;
    default: return text.resultProviderUnavailable;
  }
}

function experimentStateLabel(state: Experiment["state"], text: RiwiLabCopy) {
  switch (state) {
    case "pending": return text.statePending;
    case "running": return text.stateRunning;
    case "completed": return text.stateCompleted;
    case "partial": return text.statePartial;
    case "failed": return text.stateFailed;
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
  initialNextCursor,
  initialExperimentCount,
  text,
}: {
  providers: LabProvider[];
  enabled: LabEnabled;
  initialExperiments: Experiment[];
  initialNextCursor: string | null;
  initialExperimentCount: number;
  text: RiwiLabCopy;
}) {
  const [fixtureId, setFixtureId] = useState<FixtureId>(initialFixture);
  const [providerIds, setProviderIds] = useState<string[]>(() => providers.slice(0, 1).map((provider) => provider.id));
  const [experiments, setExperiments] = useState(initialExperiments);
  const [experimentCursor, setExperimentCursor] = useState(initialNextCursor);
  const [experimentCount, setExperimentCount] = useState(initialExperimentCount);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPageFailed, setHistoryPageFailed] = useState(false);
  const requestResponse = useScopedResponse(35_000);
  const historyLoadingRef = useRef(false);
  const historyRequestSequence = useRef(0);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingIdempotency = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      historyRequestSequence.current += 1;
    };
  }, []);

  function toggleProvider(id: string) {
    setProviderIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length >= 2 ? current : [...current, id];
    });
  }

  function clearOwnerHistory() {
    historyRequestSequence.current += 1;
    historyLoadingRef.current = false;
    setExperiments([]);
    setExperimentCursor(null);
    setExperimentCount(0);
    setHistoryPageFailed(false);
    setHistoryLoading(false);
    setError(text.requestFailed);
  }

  async function loadMoreExperiments() {
    const cursor = experimentCursor;
    if (!cursor || historyLoadingRef.current) return;
    const requestId = ++historyRequestSequence.current;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    setHistoryPageFailed(false);
    try {
      const response = await requestResponse(
        `/api/riwi/owner/provider-lab?limit=20&cursor=${encodeURIComponent(cursor)}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      if (!response || !mounted.current || historyRequestSequence.current !== requestId) return;
      if (response.status === 401 || response.status === 403) {
        clearOwnerHistory();
        return;
      }
      const parsed = historyPageSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) {
        setHistoryPageFailed(true);
        return;
      }
      setExperiments((current) => appendUniqueExperiments(current, parsed.data.experiments));
      setExperimentCursor(parsed.data.nextCursor);
      setExperimentCount(parsed.data.experimentCount);
    } catch {
      if (mounted.current && historyRequestSequence.current === requestId) setHistoryPageFailed(true);
    } finally {
      if (mounted.current && historyRequestSequence.current === requestId) {
        historyLoadingRef.current = false;
        setHistoryLoading(false);
      }
    }
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
      if (response.status === 401 || response.status === 403) {
        clearOwnerHistory();
        return;
      }
      const parsed = apiResponseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) {
        setError(response.status === 429 ? text.rateLimited : text.requestFailed);
        return;
      }
      const { experiment } = parsed.data;
      setExperiments((current) => [experiment, ...current.filter((item) => item.id !== experiment.id)]);
      if (!parsed.data.replay) setExperimentCount((current) => current + 1);
      pendingIdempotency.current = null;
      setNotice(parsed.data.replay ? text.noticeReplay : text.noticeRecorded);
    } catch {
      setError(text.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  const mayRun = enabled.owner && enabled.providerLab && providerIds.length > 0 && providerIds.length <= 2;
  return (
    <div className="flex flex-col gap-5" data-riwi-owner-control-room>
      <section className="card flex flex-col gap-4 p-5" aria-labelledby="riwi-lab-title">
        <div>
          <h2 id="riwi-lab-title" className="font-display text-xl text-ink-900">{text.title}</h2>
          <p className="mt-1 text-sm text-ink-500">{text.intro}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3" aria-label={text.readiness}>
          <Readiness label={text.ownerRollout} enabled={enabled.owner} text={text} />
          <Readiness label={text.providerLab} enabled={enabled.providerLab} text={text} />
          <Readiness label={text.externalAi} enabled={enabled.externalAi} text={text} />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 border-t border-ink-100 pt-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">
            {text.fixedFixture}
            <select className="w-full rounded-xl border border-ink-100 bg-paper-sunken px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-signal-600" value={fixtureId} onChange={(event) => setFixtureId(event.target.value as FixtureId)} disabled={busy}>
              {fixtures.map((fixture) => <option key={fixture} value={fixture}>{fixtureLabel(fixture, text)}</option>)}
            </select>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-700">{text.registeredProviders}</legend>
            {providers.length === 0 && <p className="text-sm text-ink-500">{text.noProviders}</p>}
            {providers.map((provider) => {
              const checked = providerIds.includes(provider.id);
              const disabled = busy || (!checked && providerIds.length >= 2);
              const successfulFixtureEvidence = experiments.some((experiment) =>
                experiment.results.some((result) => result.providerId === provider.id && result.state === "succeeded"));
              return (
                <label key={provider.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 p-3 text-sm">
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleProvider(provider.id)} />
                  <span className="font-medium text-ink-800">{provider.displayName}</span>
                  <span className="font-mono text-xs text-ink-500">{provider.id}{provider.model ? ` · ${provider.model}` : ""}</span>
                  <span className={`ml-auto badge ${provider.secretsPresent ? "bg-band-good/10 text-band-good" : "bg-band-warn/10 text-band-warn"}`}>
                    {provider.secretsPresent ? text.credentialConfigured : text.externallyUnverified}
                  </span>
                  {!provider.secretsPresent && provider.missingSecretNames.length > 0 && (
                    <span className="w-full text-xs text-ink-500">{interpolate(text.missingEnvironmentNames, { names: provider.missingSecretNames.join(", ") })}</span>
                  )}
                  <span className="w-full text-xs text-ink-500">{interpolate(text.capabilities, { names: provider.capabilities.join(", ") || "—" })}</span>
                  <span className="w-full text-xs text-ink-500">
                    {provider.secretsPresent
                      ? successfulFixtureEvidence ? text.successfulFixtureEvidence : text.configuredNoLiveSuccess
                      : text.credentialUnavailable}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={!mayRun || busy || providerIds.length === 0}>
              {busy ? text.runBounded : text.runFixed}
            </button>
            {!enabled.providerLab && <span className="text-xs text-band-warn">{text.providerLabOff}</span>}
            {enabled.providerLab && !enabled.externalAi && <span className="text-xs text-band-warn">{text.externalAiOff}</span>}
          </div>
        </form>
        <p className="rounded-xl bg-paper-sunken p-3 text-xs leading-5 text-ink-500">{text.resourceBounds}</p>
        {notice && <p className="text-sm text-band-good" role="status">{notice}</p>}
        {error && <p className="text-sm text-band-bad" role="alert">{error}</p>}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="riwi-experiment-history-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="riwi-experiment-history-title" className="font-display text-xl text-ink-900">{text.historyTitle}</h2>
            <p className="text-xs text-ink-500">{text.historyHint}</p>
          </div>
          <span className="badge bg-paper-sunken text-ink-600" aria-label={text.historyTitle}>
            {interpolate(text.historyCount, { loaded: String(experiments.length), total: String(experimentCount) })}
          </span>
        </div>
        {experiments.length === 0 && <div className="card p-5 text-sm text-ink-500">{text.noExperiments}</div>}
        {experiments.map((experiment) => (
          <article key={experiment.id} className="card flex flex-col gap-3 p-5" data-experiment={experiment.id}>
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-ink-900">{fixtureLabel(experiment.fixtureId, text)}</p>
                <p className="text-xs text-ink-500">{new Date(experiment.createdAt).toLocaleString()} · {experiment.providers.join(" vs ")}</p>
              </div>
              <span className={`badge ${stateTone(experiment.state)}`}>{experimentStateLabel(experiment.state, text)}</span>
            </header>
            {experiment.comparison && (
              <div className="rounded-xl bg-paper-sunken p-3 text-sm" aria-label={text.comparisonAria}>
                <p className="font-medium text-ink-800">{text.comparisonTitle}</p>
                {experiment.comparison.status === "not_comparable" ? (
                  <p className="mt-1 text-ink-600">{text.notComparable}</p>
                ) : (
                  <p className="mt-1 text-ink-600">
                    {experiment.comparison.exactAnswerMatch ? text.exactMatch : text.answersDiffer}
                  </p>
                )}
                <p className="mt-1 text-xs text-ink-500">{text.comparisonLimit}</p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {experiment.results.map((result) => (
                <div key={result.providerId} className="rounded-xl border border-ink-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-800">{result.providerId}{result.model ? ` · ${result.model}` : ""}</span>
                    <span className={`badge ${stateTone(result.state)}`}>{resultLabel(result.state, text)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{result.durationMs > 0 ? `${result.durationMs} ms` : text.providerCallNotMade} · {text.inputOutputTokens} {result.inputTokens === null && result.outputTokens === null ? text.notReported : `${result.inputTokens ?? text.unknownCount}/${result.outputTokens ?? text.unknownCount}`} · {text.cost} {result.estimatedCostMicros === null ? text.unknown : text.estimated}</p>
                  {result.safeErrorCode && <p className="mt-2 text-xs text-ink-500">{interpolate(text.safeStatus, { code: result.safeErrorCode })}</p>}
                  {result.normalizedResult && (
                    <div className="mt-3 border-t border-ink-100 pt-3 text-sm text-ink-700">
                      <p className="whitespace-pre-wrap">{result.normalizedResult.answer}</p>
                      {result.normalizedResult.uncertainty && <p className="mt-2 text-xs text-band-warn">{interpolate(text.uncertainty, { text: result.normalizedResult.uncertainty })}</p>}
                      {result.normalizedResult.citations.length > 0 && <p className="mt-2 text-xs text-ink-500">{interpolate(text.citations, { items: result.normalizedResult.citations.join(", ") })}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-300">{interpolate(text.reportedCost, {
              amount: experiment.results.length > 0 && experiment.results.every((result) => result.estimatedCostMicros !== null)
                ? `${experiment.results.reduce((sum, result) => sum + (result.estimatedCostMicros ?? 0), 0)} ${text.microUnits}`
                : text.unknownCostNote,
            })}</p>
          </article>
        ))}
        {experimentCursor && <div className="flex flex-wrap items-center gap-3" aria-busy={historyLoading}>
          <button type="button" className="btn-secondary self-start" disabled={busy || historyLoading} onClick={() => void loadMoreExperiments()}>
            {historyLoading ? text.loadingMoreHistory : historyPageFailed ? text.retryHistory : text.loadMoreHistory}
          </button>
          {historyPageFailed && <p className="text-sm text-band-bad" role="alert">{text.historyPageFailed}</p>}
        </div>}
      </section>
    </div>
  );
}

function Readiness({ label, enabled, text }: { label: string; enabled: boolean; text: RiwiLabCopy }) {
  return <div className={`rounded-xl px-3 py-2 text-xs ${enabled ? "bg-band-good/10 text-band-good" : "bg-ink-100 text-ink-500"}`}>
    {label}: {enabled ? text.readinessEnabled : text.readinessOff}
  </div>;
}
