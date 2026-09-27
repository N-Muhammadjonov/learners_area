"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

type IntentResponse = {
  intentId: string;
  token: string;
  browserNonce: string;
  expiresAt: string;
  botUsername?: string;
};

/**
 * Website Telegram sign-in.
 *
 * The browser creates a short-lived intent and opens the bot with that intent
 * token only. The session cookie is issued later, by the exchange route, after
 * the bot confirms. The deep link never carries a session.
 */
export function TelegramIntentLogin({
  dict,
  configured,
  botUsername,
}: {
  dict: Dictionary;
  configured: boolean;
  botUsername?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => () => stop.current?.abort(), []);

  if (!configured || !botUsername) {
    return (
      <div>
        <button type="button" disabled className="btn-secondary w-full opacity-50">
          {dict.auth.continueWithTelegram}
        </button>
        <p className="mt-1.5 text-xs text-ink-300">{dict.auth.telegramUnavailable}</p>
      </div>
    );
  }

  async function start() {
    setError("");
    setWaiting(true);
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    const created = await requestJson<IntentResponse>("/api/auth/telegram/intent", { signal: controller.signal });
    if (!created.ok || !created.data.token || !created.data.botUsername) {
      setWaiting(false);
      setError(failureMessage(created.ok ? { ok: false, status: 400, kind: "http", error: "telegram_not_configured" } : created, dict.auth));
      return;
    }
    const deepLink = `https://t.me/${created.data.botUsername}?start=${encodeURIComponent(created.data.token)}`;
    setLink(deepLink);
    window.open(deepLink, "_blank", "noopener,noreferrer");

    const deadline = Date.now() + 5 * 60_000;
    while (!controller.signal.aborted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (controller.signal.aborted) return;
      const status = await requestJson<{ status: string; expired: boolean }>(
        `/api/auth/telegram/intent/status?id=${encodeURIComponent(created.data.intentId)}&nonce=${encodeURIComponent(created.data.browserNonce)}`,
        { method: "GET", signal: controller.signal }
      );
      if (!status.ok) continue;
      if (status.data.status === "cancelled") {
        setWaiting(false);
        return;
      }
      if (status.data.expired || status.data.status === "expired") {
        setWaiting(false);
        setError(dict.auth.telegramExpired);
        return;
      }
      if (status.data.status !== "confirmed") continue;

      const exchanged = await requestJson<{ accountStatus?: string; onboarded?: boolean }>(
        "/api/auth/telegram/intent/exchange",
        { body: { intentId: created.data.intentId, browserNonce: created.data.browserNonce }, signal: controller.signal }
      );
      if (!exchanged.ok) {
        setWaiting(false);
        if (exchanged.error === "telegram_already_linked") setError(dict.auth.telegramConflict);
        else if (exchanged.error === "no_linked_account") setError(dict.auth.telegramNoAccount);
        else setError(failureMessage(exchanged, dict.auth));
        return;
      }
      if (exchanged.data.accountStatus && exchanged.data.accountStatus !== "active") {
        router.push("/pending");
        router.refresh();
        return;
      }
      const next = safeNextPath(searchParams.get("next"));
      router.push(next ?? (exchanged.data.onboarded ? "/dashboard" : "/onboarding"));
      router.refresh();
      return;
    }
    if (!controller.signal.aborted) {
      setWaiting(false);
      setError(dict.auth.telegramExpired);
    }
  }

  async function cancel() {
    stop.current?.abort();
    setWaiting(false);
    setLink(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={start} disabled={waiting}>
        {waiting ? dict.auth.telegramWaiting : dict.auth.continueWithTelegram}
      </Button>
      {link ? (
        <a className="text-center text-sm text-signal-600 hover:underline" href={link} target="_blank" rel="noreferrer">
          {dict.auth.telegramOpen}
        </a>
      ) : null}
      {waiting ? (
        <button type="button" className="text-xs text-ink-400 hover:underline" onClick={cancel}>
          {dict.auth.telegramCancel}
        </button>
      ) : null}
      {error ? <p className="text-xs text-band-bad">{error}</p> : null}
    </div>
  );
}
