"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { grammarBundleSchema } from "@/lib/grammar/import-schema";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { apiErrorMessage } from "@/lib/api-error-message";
import { Button } from "@/components/ui/Button";
export function GrammarImport({dict}: {dict: Dictionary}) {
  const t = dict.grammar;
  const router = useRouter();
  const request = useScopedRequest();
  const flight = useRef(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  async function submit(dryRun: boolean) {
    if (flight.current || (!dryRun && preview !== text)) return;
    let parsed;
    try {parsed = grammarBundleSchema.safeParse(JSON.parse(text));} catch {setMessage(dict.apiErrors.invalid); return;}
    if (!parsed.success) {setMessage(dict.apiErrors.invalid); return;}
    flight.current = true; setPending(true); setMessage("");
    const result = await request<{topics: number; exercises: number}>("/api/admin/grammar/import", {body: {dryRun, bundle: parsed.data}});
    flight.current = false;
    if (!result) return;
    setPending(false);
    if (!result.ok) {setPreview(null); setMessage(apiErrorMessage(result.error, result.status, dict)); return;}
    setPreview(dryRun ? text : null);
    setMessage((dryRun ? t.importPreview : t.importSaved).replace("{topics}", String(result.data.topics)).replace("{exercises}", String(result.data.exercises)));
    if (!dryRun) {setText(""); router.refresh();}
  }
  return <section className="card space-y-3 p-4" data-grammar-import>
    <h2 className="font-display text-lg">{t.importTitle}</h2>
    <p className="text-sm text-ink-500">{t.importHelp} <a href="/content/grammar-foundation-original.json" download className="underline">{t.importExample}</a></p>
    <label className="flex flex-col gap-1 text-sm">{t.importSource}
      <textarea className="input min-h-32" value={text} maxLength={500000} onChange={event => {setText(event.target.value); setPreview(null); setMessage("");}} disabled={pending} />
    </label>
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={pending || !text.trim()} onClick={() => void submit(true)}>{pending ? dict.common.saving : t.importValidate}</Button>
      {preview === text && <Button disabled={pending} onClick={() => void submit(false)}>{t.importApply}</Button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
