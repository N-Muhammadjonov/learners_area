"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label, FieldError } from "@/components/ui/Input";
import { TelegramButton } from "./TelegramButton";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

export function LoginForm({
  dict,
  telegramConfigured,
  telegramBotUsername,
  googleConfigured = false,
  diagnostics = false,
}: {
  dict: Dictionary;
  telegramConfigured: boolean;
  telegramBotUsername?: string;
  googleConfigured?: boolean;
  diagnostics?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const googleError = searchParams.get("error");
  const googleMessages: Record<string, string> = {
    google_unavailable: dict.auth.googleUnavailable,
    google_state: dict.auth.googleFailed,
    google_failed: dict.auth.googleFailed,
    google_unverified: dict.auth.googleUnverified,
    google_link_required: dict.auth.googleLinkRequired,
  };
  const [error, setError] = useState(googleError && googleMessages[googleError] ? googleMessages[googleError] : "");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{ accountStatus?: string; onboarded?: boolean; role?: string }>(
        "/api/auth/login",
        { body: { email, password } }
      );
      if (!result.ok) {
        if (diagnostics) {
          // Fixed categories only: never credentials, response bodies or driver messages.
          const code = ["service_unavailable", "invalid_credentials", "timeout", "aborted"].includes(result.error ?? "")
            ? result.error : null;
          console.info(`[qa-auth] ${JSON.stringify({ event: "loginFailure", status: result.status, kind: result.kind, code, reason: result.reason ?? null })}`);
        }
        setError(failureMessage(result, dict.auth, { invalid_credentials: dict.auth.errorInvalidCredentials }));
        return;
      }
      const data = result.data;
      // Where to go next is decided by the account's state, not by a guess:
      // anything that is not ACTIVE belongs in the waiting room (the middleware
      // would send it there anyway, but landing on the right screen immediately
      // is the difference between "waiting for approval" and "the button did
      // nothing").
      if (data.accountStatus && data.accountStatus !== "active") {
        router.push("/pending");
        router.refresh();
        return;
      }

      // `next` comes from the address bar, so only a path inside this app is honoured
      // — a crafted `?next=https://…` must not turn sign-in into an open redirect.
      const next = safeNextPath(searchParams.get("next"));
      router.push(next ?? (data.onboarded ? "/app" : "/onboarding"));
      router.refresh();
    } finally {
      setPending(false);
    }
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
        <Link href="/reset-password" className="btn-secondary ">
          {dict.auth.forgotPassword}
        </Link>
      </div>
      <div className="relative py-1 text-center text-xs text-ink-300">
        <span className="relative bg-paper-raised px-2">{dict.auth.or}</span>
        <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-ink-100" />
      </div>
      {googleConfigured && (
        // A plain top-level navigation: the OIDC redirect chain must not be prefetched or fetched.
        <a href="/api/auth/google/start" className="btn-secondary w-full justify-center" data-google-login>
          {dict.auth.continueWithGoogle}
        </a>
      )}
      <TelegramButton
        label={dict.auth.continueWithTelegram}
        unavailableLabel={dict.auth.telegramUnavailable}
        configured={telegramConfigured}
        botUsername={telegramBotUsername}
      />
    </form>
  );
}
