"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReadingTryout } from "@/components/import/ReadingTryout";
import { generalReadingBundle } from "@/lib/reading/import-schema";
import type { Dictionary } from "@/lib/i18n/en";

import { READING_SOURCE_ACCEPT, readReadingSource, type ReadingSource } from "@/lib/import/reading-source";
import { requestJson } from "@/lib/http/client-request";

type Result = { setId: string; created: boolean; dryRun: boolean; passages: { passageNo: number; resolved: number; unresolved: number }[] };

export function ReadingImport({ dict }: { dict: Dictionary }) {
  const t = dict.readingImport;
  const active = useRef<AbortController | null>(null);
  const flight = useRef(false);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const [source, setSource] = useState<ReadingSource | null>(null);
  const [bundle, setBundle] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function pick(file: File) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(new DOMException("Source timeout", "TimeoutError")), 30_000);
    setBusy(true); setError(""); setResult(null); setBundle(null); setSource(null); setName(file.name);
    try {
      const parsed = await readReadingSource(file, controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      setSource(parsed);
      if (parsed.kind === "structured") setBundle(parsed.bundle);
    } catch {
      if (active.current === controller) setError(controller.signal.reason?.name === "TimeoutError" ? t.errors.unknown : t.errors.invalid_bundle);
    } finally {
      clearTimeout(timer);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  async function send(dryRun: boolean) {
    if (!bundle || busy || flight.current) return;
    flight.current = true;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const res = await requestJson<Result>("/api/admin/reading/import", { body: { bundle: { ...generalReadingBundle.parse(bundle), publish: !dryRun }, dryRun }, signal: controller.signal });
      if (active.current !== controller || controller.signal.aborted) return;
      if (!res.ok) {
        const code = String(res.error ?? "unknown") as keyof typeof t.errors;
        setError(t.errors[code] ?? t.errors.unknown);
        return;
      }
      const data = res.data;
      setResult(data as Result);
    } catch {
      setError(t.errors.unknown);
    } finally {
      flight.current = false;
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  return (
    <div className="card space-y-4" data-reading-import>
      <h1 className="font-display text-xl">{t.title}</h1>
      <p>{t.intro}</p>
      <label className="block">
        {t.fileLabel}
        <input className="mt-2 block" type="file" accept={READING_SOURCE_ACCEPT} disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
      </label>
      {name && <p className="text-sm">{name}</p>}
      {source?.kind === "supplemental" && <div role="status" className="space-y-2"><p>{t.supplemental}</p><Link className="btn-secondary" href="/app/admin/materials">{t.manageMaterials}</Link>{source.textPreview && <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{source.textPreview}</pre>}</div>}
      {source?.kind === "structured" && <ReadingTryout dict={dict} key={name} bundle={source.bundle} />}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11" disabled={!bundle || busy || !!result || !generalReadingBundle.safeParse(bundle).success} onClick={() => void send(false)}>{t.import}</button>
      </div>
      {result && (
        <div role="status" data-reading-import-result>
          <p>{result.dryRun ? t.checked : result.created ? t.created : t.exists}</p>
          <ul className="text-sm">
            {result.passages.map((p) => (
              <li key={p.passageNo}>{t.passageLine.replace("{n}", String(p.passageNo)).replace("{resolved}", String(p.resolved)).replace("{unresolved}", String(p.unresolved))}</li>
            ))}
          </ul>
          {!result.dryRun && <Link className="btn-secondary" href="/app/admin/reading">{t.backToList}</Link>}
        </div>
      )}
    </div>
  );
}
