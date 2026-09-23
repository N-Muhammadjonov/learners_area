"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function ResetRequestForm({ dict }: { dict: Dictionary }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch("/api/auth/reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setPending(false);
    setDone(true);
    if (data.devResetUrl) setDevUrl(data.devResetUrl);
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
    </form>
  );
}
