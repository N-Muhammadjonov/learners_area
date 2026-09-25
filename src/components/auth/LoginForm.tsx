"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label, FieldError } from "@/components/ui/Input";
import { TelegramButton } from "./TelegramButton";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import type { Dictionary } from "@/lib/i18n/en";

export function LoginForm({
  dict,
  telegramConfigured,
  telegramBotUsername,
}: {
  dict: Dictionary;
  telegramConfigured: boolean;
  telegramBotUsername?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(dict.auth.errorInvalidCredentials);
      return;
    }
    // Where to go next is decided by the account's state, not by a guess:
    // anything that is not ACTIVE belongs in the waiting room (the middleware would
    // send it there anyway, but landing on the right screen immediately is the
    // difference between "waiting for approval" and "the button did nothing").
    const pending = data.accountStatus && data.accountStatus !== "active";
    if (pending) {
      router.push("/pending");
      router.refresh();
      return;
    }

    // `next` comes from the address bar, so only a path inside this app is honoured
    // — a crafted `?next=https://…` must not turn sign-in into an open redirect.
    const next = safeNextPath(searchParams.get("next"));
    router.push(next ?? (data.onboarded ? "/dashboard" : "/onboarding"));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="email">{dict.auth.email}</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="password">{dict.auth.password}</Label>
        <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" disabled={pending}>
        {pending ? dict.common.loading : dict.auth.loginCta}
      </Button>
      <div className="text-right text-sm">
        <Link href="/reset-password" className="text-signal-600 hover:underline">
          {dict.auth.forgotPassword}
        </Link>
      </div>
      <div className="relative py-1 text-center text-xs text-ink-300">
        <span className="relative bg-paper-raised px-2">or</span>
        <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-ink-100" />
      </div>
      <TelegramButton
        label={dict.auth.continueWithTelegram}
        unavailableLabel={dict.auth.telegramUnavailable}
        configured={telegramConfigured}
        botUsername={telegramBotUsername}
      />
    </form>
  );
}
