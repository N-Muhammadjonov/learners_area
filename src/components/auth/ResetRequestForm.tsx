"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

export function ResetRequestForm({ dict }: { dict: Dictionary }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await requestJson<{ devResetUrl?: string }>("/api/auth/reset/request", { body: { email } });
      // The screen answers the same way whether or not the address exists — that
      // is deliberate, so this form must not turn a transport failure into a
      // "check your email" message it cannot back up.
      if (!result.ok) {
        setDevUrl(null);
        setError(failureMessage(result, dict.auth, { reset_unavailable: dict.auth.resetUnavailable }));
        return;
      } else if (result.data?.devResetUrl) {
        setDevUrl(result.data.devResetUrl);
      }
      setDone(true);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-ink-700">
          {dict.auth.resetSubtitle}
        </p>
        {devUrl && (
          <Link href={devUrl} className="btn-secondary justify-center">
            Open reset link (dev)
          </Link>
        )}
        <Link href="/login" className="text-center text-sm font-medium text-white underline underline-offset-2">
          {dict.auth.loginCta}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="email">{dict.auth.email}</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? dict.common.loading : dict.auth.resetSend}
      </Button>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      <Link href="/login" className="text-center text-sm font-medium text-white underline underline-offset-2">
        {dict.auth.loginCta}
      </Link>
    </form>
  );
}
