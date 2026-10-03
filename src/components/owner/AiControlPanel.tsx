"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

/** Serializable mirror of OwnerAiStatus (dates as ISO strings). No secret values exist in it. */
export type AiControlStatus = {
  deploymentCeiling: boolean;
  owner: { externalEnabled: boolean; providerId: string | null; model: string | null; fallback: "riwi" | "none"; updatedAt: string | null; source: "owner" | "default" | "unavailable" };
  effective: { externalEnabled: boolean; providerId: string; providerIsExternal: boolean; ready: boolean; model: string | null; fallback: "riwi" | "none" };
  providers: Array<{ id: string; displayName: string; type: "internal" | "external"; model: string | null; capabilities: string[]; secretsPresent: boolean; missingSecretNames: string[] }>;
  configIssues: Array<{ index: number; reason: string }>;
};

export function AiControlPanel({ dict, initial }: { dict: Dictionary; initial: AiControlStatus }) {
  const requestResponse = useScopedResponse(25000);

  const t = dict.aiControl;
  const [status, setStatus] = useState(initial);
  const [enabled, setEnabled] = useState(initial.owner.externalEnabled);
  const [providerId, setProviderId] = useState<string>(initial.owner.providerId ?? initial.effective.providerId);
  const [model, setModel] = useState(initial.owner.model ?? "");
  const [fallback, setFallback] = useState<"riwi" | "none">(initial.owner.fallback);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const res = await requestResponse("/api/owner/ai-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalEnabled: enabled, providerId, model: model.trim() || null, fallback }),
      });
    if (!res) return;
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ tone: "bad", text: data?.error?.code === "unknown_provider" ? t.unknownProvider : data?.error?.code === "invalid_model" ? t.invalidModel : t.failed });
        return;
      }
      setStatus({ ...data, owner: { ...data.owner, updatedAt: data.owner.updatedAt ? String(data.owner.updatedAt) : null } });
      setMessage({ tone: "good", text: t.saved });
    } catch {
      setMessage({ tone: "bad", text: t.failed });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4" data-ai-control>
      <div>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="text-sm text-ink-500">{t.subtitle}</p>
        <p className="text-xs text-ink-500">{t.learnerLabel}</p>
      </div>
      <p className="text-sm" data-ai-ceiling={String(status.deploymentCeiling)}>
        {t.ceiling}: <strong>{status.deploymentCeiling ? t.on : t.off}</strong>
        {!status.deploymentCeiling && <span className="block text-xs text-band-warn">{t.ceilingOffNote}</span>}
      </p>
      {status.owner.source === "unavailable" && <p className="text-sm text-band-bad" role="alert">{t.unavailable}</p>}
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="text-sm font-semibold text-ink-700">{t.master}</legend>
        <label className="flex items-center gap-1 text-sm"><input type="radio" name="ai-master" checked={enabled} onChange={() => setEnabled(true)} /> {t.on}</label>
        <label className="flex items-center gap-1 text-sm"><input type="radio" name="ai-master" checked={!enabled} onChange={() => setEnabled(false)} /> {t.off}</label>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-ink-700">{t.provider}</span>
        <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)} data-ai-provider-select>
          {status.providers.map((p) => (
            <option key={p.id} value={p.id}>{p.type === "internal" ? t.riwiOnly : `${p.displayName} (${p.id})`}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-ink-700">{t.modelLabel}</span>
        <input className="input" value={model} maxLength={100} onChange={(e) => setModel(e.target.value)} placeholder={t.modelPlaceholder} data-ai-model-input />
        <span className="text-xs text-ink-500">{t.modelHint}</span>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-semibold text-ink-700">{t.fallbackLabel}</legend>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="ai-fallback" checked={fallback === "riwi"} onChange={() => setFallback("riwi")} /> {t.fallbackRiwi}</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="ai-fallback" checked={fallback === "none"} onChange={() => setFallback("none")} /> {t.fallbackStrict}</label>
      </fieldset>
      <ul className="flex flex-col gap-1 text-xs text-ink-500">
        {status.providers.filter((p) => p.type === "external").map((p) => (
          <li key={p.id} data-ai-provider={p.id}>
            <strong className="text-ink-700">{p.displayName}</strong> · {t.model}: {p.model ?? "—"} · {p.secretsPresent ? t.secretsOk : `${t.secretsMissing}: ${p.missingSecretNames.join(", ")}`}
          </li>
        ))}
      </ul>
      {status.configIssues.length > 0 && (
        <div className="text-xs text-band-warn">
          {t.configIssues}: {status.configIssues.map((i) => `#${i.index + 1} ${i.reason}`).join("; ")}
        </div>
      )}
      <p className="text-sm" data-ai-effective={status.effective.ready ? "ready" : "off"}>
        {t.effective}: <strong>{status.effective.ready ? t.ready : t.notReady}</strong>
        {status.effective.ready && <span className="block text-xs text-ink-500">{t.model}: {status.effective.model ?? "—"} · {status.effective.fallback === "none" ? t.fallbackStrict : t.fallbackRiwi}</span>}
      </p>
      <p className="text-xs text-ink-500">
        {t.lastChange}: {status.owner.updatedAt ? new Date(status.owner.updatedAt).toLocaleString() : t.neverChanged}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? t.saving : t.save}</button>
        {message && <span className={`text-sm ${message.tone === "good" ? "text-band-good" : "text-band-bad"}`} role="status">{message.text}</span>}
      </div>
    </section>
  );
}
