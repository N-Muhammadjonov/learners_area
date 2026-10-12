"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import type { Dictionary } from "@/lib/i18n/en";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
export function ProfilePhoto({ userId, dict, initialPresent = true }: { userId: string; dict: Dictionary; initialPresent?: boolean }) {
  // `initialPresent` comes from the server, which already knows whether a photo row exists. The
  // default stays `true` so any caller that has not been given the answer behaves exactly as
  // before: mount the image and recover through `onError`.
  const [version, setVersion] = useState(0), [present, setPresent] = useState(initialPresent), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const flight = useRef(false), request = useScopedResponse(12000);
  const t = dict.profile.photo;
  async function upload(file: File) {
    if (flight.current) return;
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) { setMessage(t.failed); return; }
    flight.current = true; setBusy(true); setMessage("");
    const url = URL.createObjectURL(file);
    try {
      const source = document.createElement("img"); source.src = url; await source.decode();
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext("2d"); if (!context) throw new Error();
      const side = Math.min(source.naturalWidth, source.naturalHeight);
      context.beginPath(); context.arc(128, 128, 128, 0, Math.PI * 2); context.clip();
      context.drawImage(source, (source.naturalWidth - side) / 2, (source.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error()), "image/png"));
      const form = new FormData(); form.set("photo", blob, "profile.png");
      const result = await request("/api/profile/photo", { method: "POST", body: form });
      if (!result?.ok) throw new Error();
      setPresent(true); setVersion(value => value + 1); setMessage(t.saved);
      window.dispatchEvent(new CustomEvent("profile-photo-changed", { detail: { userId, present: true } }));
    } catch { setMessage(t.failed); }
    finally { URL.revokeObjectURL(url); flight.current = false; setBusy(false); }
  }
  async function remove() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage("");
    try {
      const result = await request("/api/profile/photo", { method: "DELETE" });
      if (!result?.ok) { setMessage(t.failed); return; }
      setPresent(false); setMessage(t.saved);
      window.dispatchEvent(new CustomEvent("profile-photo-changed", { detail: { userId, present: false } }));
    } finally { flight.current = false; setBusy(false); }
  }
  return <section className="card flex flex-wrap items-center gap-5 p-5"><div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-signal-50 text-4xl">{present ? <Image key={version} src={`/api/profile/photo/${userId}?v=${version}`} alt={t.title} width={112} height={112} unoptimized onError={() => setPresent(false)} className="h-full w-full object-cover" /> : "🎓"}</div><div className="flex flex-col gap-3"><h2 className="font-display text-lg">{t.title}</h2><label className="btn-secondary cursor-pointer">{busy ? dict.profile.saving : t.upload}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label><button type="button" disabled={busy} className="btn-ghost" onClick={() => void remove()}>{t.remove}</button>{message && <p role="status">{message}</p>}</div></section>;
}
