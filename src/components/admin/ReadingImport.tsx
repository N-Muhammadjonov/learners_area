"use client";
import { useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";

type Result = { setId: string; created: boolean; dryRun: boolean; passages: { passageNo: number; resolved: number; unresolved: number }[] };

export function ReadingImport({ t }: { t: Dictionary["readingImport"] }) {
  const [bundle, setBundle] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function pick(file: File) {
    setError("");
    setResult(null);
    setBundle(null);
    setName(file.name);
    try {
      setBundle(JSON.parse(await file.text()));
    } catch {
      setError(t.errors.not_json);
    }
  }

  async function send(dryRun: boolean) {
    if (!bundle || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/reading/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = String(data.error ?? "unknown") as keyof typeof t.errors;
        const detail = typeof data.detail === "string" ? ` — ${data.detail}` : "";
        const ref = typeof data.correlationId === "string" ? ` (ref ${data.correlationId.slice(0, 16)})` : "";
        setError((t.errors[code] ?? t.errors.unknown) + detail + ref);
        return;
      }
      setResult(data as Result);
    } catch {
      setError(t.errors.unknown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4" data-reading-import>
      <h1 className="font-display text-xl">{t.title}</h1>
      <p>{t.intro}</p>
      <label className="block">
        {t.fileLabel}
        <input className="mt-2 block" type="file" accept=".json,application/json" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
      </label>
      {name && <p className="text-sm">{name}</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary min-h-11" disabled={!bundle || busy} onClick={() => void send(true)}>{t.check}</button>
        <button type="button" className="btn-primary min-h-11" disabled={!bundle || busy || !result?.dryRun} onClick={() => void send(false)}>{t.import}</button>
      </div>
      {result && (
        <div role="status" data-reading-import-result>
          <p>{result.dryRun ? t.checked : result.created ? t.created : t.exists}</p>
          <ul className="text-sm">
            {result.passages.map((p) => (
              <li key={p.passageNo}>{t.passageLine.replace("{n}", String(p.passageNo)).replace("{resolved}", String(p.resolved)).replace("{unresolved}", String(p.unresolved))}</li>
            ))}
          </ul>
          {!result.dryRun && <Link className="btn-secondary" href="/admin/reading">{t.backToList}</Link>}
        </div>
      )}
    </div>
  );
}
