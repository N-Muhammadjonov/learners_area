"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

export function ListeningTestActions({ id, title, dict }: { id: string; title: string; dict: Dictionary }) {
  const router = useRouter();
  const request = useScopedResponse(12000);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(remove = false) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await request(`/api/admin/listening/tests/${id}`, { method: remove ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, body: remove ? undefined : JSON.stringify({ title: name.trim() }) });
      if (!response) return;
      if (!response.ok) throw new Error();
      setEditing(false); setDeleting(false); router.refresh();
    } catch { setError(dict.errors.unknown); }
    finally { setPending(false); }
  }
  return <div className="space-y-2" data-listening-test-actions>
    <details className="self-end"><summary className="cursor-pointer text-right text-xl" aria-label={`${dict.common.edit}: ${title}`}>⋯</summary><div className="flex gap-2 py-2"><button type="button" className="btn-secondary" disabled={pending} onClick={() => { setEditing(true); setDeleting(false); }}>{dict.common.edit}</button><button type="button" className="btn-secondary" disabled={pending} onClick={() => { setDeleting(true); setEditing(false); }}>{dict.common.delete}</button></div></details>
    {editing && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(); }}><input className="input" aria-label={title} maxLength={200} required value={name} onChange={event => setName(event.target.value)} /><button type="submit" className="btn-primary" disabled={pending}>{dict.common.save}</button><button type="button" className="btn-secondary ml-2" disabled={pending} onClick={() => setEditing(false)}>{dict.common.cancel}</button></form>}
    {deleting && <div className="space-y-2"><p>{dict.common.delete}: {title}?</p><button type="button" className="btn-primary" disabled={pending} onClick={() => void save(true)}>{dict.common.delete}</button><button type="button" className="btn-secondary ml-2" disabled={pending} onClick={() => setDeleting(false)}>{dict.common.cancel}</button></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
