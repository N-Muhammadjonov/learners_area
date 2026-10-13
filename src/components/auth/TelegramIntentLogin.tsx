"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

type IntentPurpose = "login" | "register" | "link";

type IntentResponse = {
  intentId: string;
  token: string;
  browserNonce: string;
  expiresAt: string;
  botUsername?: string;
  purpose?: IntentPurpose;
};

type ExchangeResponse = {
  accountStatus?: string;
  onboarded?: boolean;
  outcome?: string;
};

/**
 * Website Telegram sign-in or registration.
 *
 * The browser asks for one purpose. The server stores that purpose and will
 * not let a later request change it. Cancel calls the server so a confirmed
 * intent cannot still be exchanged.
 */
export function TelegramIntentLogin({
  dict,
  configured,
  botUsername,
  purpose,
}: {
  dict: Dictionary;
  configured: boolean;
  botUsername?: string;
  purpose: IntentPurpose;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const pending = useRef<{ intentId: string; browserNonce: string } | null>(null);
  const known = {
    telegram_already_linked: dict.auth.telegramConflict,
    no_linked_account: dict.auth.telegramNoAccount,
    already_signed_in: dict.auth.telegramAlreadySignedIn,
    already_consumed: dict.auth.telegramExpired,
    expired: dict.auth.telegramExpired,
    intent_not_confirmed: dict.auth.telegramExpired,
  };

  useEffect(() => () => stop.current?.abort(), []);

  if (!configured || !botUsername) {
    return (
      <div>
        <button type="button" disabled className="btn-secondary w-full opacity-50">
          {purpose === "register" ? dict.auth.continueWithTelegramRegister : dict.auth.continueWithTelegram}
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
    const created = await requestJson<IntentResponse>("/api/auth/telegram/intent", {
      body: { purpose },
      signal: controller.signal,
    });
    if (!created.ok || !created.data.token || !created.data.botUsername || created.data.purpose !== purpose) {
      setWaiting(false);
      setError(failureMessage(created.ok ? { ok: false, status: 400, kind: "http", error: created.ok ? "telegram_not_configured" : null } : created, dict.auth, known));
      return;
    }
    pending.current = { intentId: created.data.intentId, browserNonce: created.data.browserNonce };
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

      const exchanged = await requestJson<ExchangeResponse>("/api/auth/telegram/intent/exchange", {
        body: { intentId: created.data.intentId, browserNonce: created.data.browserNonce },
        signal: controller.signal,
      });
      if (!exchanged.ok) {
        setWaiting(false);
        setError(failureMessage(exchanged, dict.auth, known));
        return;
      }
      const outcome = exchanged.data.outcome;
      const accountStatus = exchanged.data.accountStatus;
      if (purpose === "link") {
        router.push("/app/profile");
        router.refresh();
        setWaiting(false);
        setLink(null);
        return;
      }
      if (outcome === "suspended" || accountStatus === "suspended") {
        setError(dict.auth.telegramSuspended);
        router.push("/pending");
        router.refresh();
        return;
      }
      if (purpose === "register" && (outcome === "pending" || outcome === "reopened" || outcome === "already_pending" || accountStatus !== "active")) {
        setError(outcome === "already_pending" ? dict.auth.telegramAlreadyPending : dict.auth.telegramRegisterPending);
        router.push("/pending");
        router.refresh();
        return;
      }
      if (purpose === "register" && outcome === "already_active") {
        setError(dict.auth.telegramAlreadyActive);
      }
      const next = safeNextPath(searchParams.get("next"));
      router.push(next ?? (exchanged.data.onboarded ? "/app" : "/onboarding"));
      router.refresh();
      return;
    }
    if (!controller.signal.aborted) {
      setWaiting(false);
      setError(dict.auth.telegramExpired);
    }
  }

  async function cancel() {
    const current = pending.current;
    stop.current?.abort();
    setWaiting(false);
    setLink(null);
    if (!current) return;
    await requestJson("/api/auth/telegram/intent/cancel", { body: current });
    pending.current = null;
  }

  const label = purpose === "link" ? dict.auth.telegramLink : purpose === "register" ? dict.auth.continueWithTelegramRegister : dict.auth.continueWithTelegram;
  const waitingLabel = purpose === "register" ? dict.auth.telegramRegisterWaiting : dict.auth.telegramWaiting;

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={start} disabled={waiting}>
        {waiting ? waitingLabel : label}
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
