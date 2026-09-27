"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";

/**
 * Starts an ownership transfer. The password is sent once to the website API
 * and is never shown again. Roles change only after the linked Telegram account
 * approves the opaque challenge.
 */
export function OwnershipTransferForm({
  dict,
  ownerEmail,
}: {
  dict: Dictionary;
  ownerEmail: string;
}) {
  const t = dict.owner;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepRole, setKeepRole] = useState<"admin" | "teacher" | "student">("admin");
  const [includeBotHandover, setIncludeBotHandover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState<{ challengeId: string; browserNonce: string } | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);

  function messageFor(code: string | undefined) {
    if (code === "telegram_not_linked") return t.transferTelegramRequired;
    if (code === "telegram_bot_not_started") return t.transferBotNotStarted;
    if (code === "bot_owner_mismatch") return t.transferBotMismatch;
    if (code === "target_telegram_missing") return t.transferTargetTelegramMissing;
    if (code === "invalid_credentials") return t.transferFailed;
    return `${t.transferFailed}${code ? ` (${code})` : ""}`;
  }

  useEffect(() => {
    if (!pending) return;
    let stop = false;
    async function tick() {
      const current = pending;
      if (!current) return;
      const res = await fetch(`/api/owner/transfer?challengeId=${encodeURIComponent(current.challengeId)}`, {
        headers: { "x-owner-challenge-nonce": current.browserNonce },
      });
      if (stop) return;
      const data = await res.json().catch(() => ({}));
      if (data.status === "consumed") {
        setDone(true);
        setPending(null);
        router.refresh();
        return;
      }
      if (data.status === "rejected") setPendingNote(t.transferRejected);
      if (data.status === "expired") setPendingNote(t.transferExpired);
      if (data.status === "cancelled") setPendingNote(t.transferCancelled);
      if (data.status && data.status !== "pending") setPending(null);
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [pending, router, t.transferCancelled, t.transferExpired, t.transferRejected]);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/owner/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, keepRole, includeBotHandover }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setPassword("");
    if (res.status === 202 && data.status === "pending" && data.challengeId && data.browserNonce) {
      setPending({ challengeId: data.challengeId, browserNonce: data.browserNonce });
      setPendingNote(t.transferPending);
      return;
    }
    setError(messageFor(data.error));
  }

  async function cancel() {
    if (!pending) return;
    setBusy(true);
    const res = await fetch(`/api/owner/transfer?challengeId=${encodeURIComponent(pending.challengeId)}`, {
      method: "DELETE",
      headers: { "x-owner-challenge-nonce": pending.browserNonce },
    });
    setBusy(false);
    if (res.ok) {
      setPending(null);
      setPendingNote(t.transferCancelled);
      return;
    }
    setError(t.transferFailed);
  }

  if (done) {
    return <Card className="text-sm text-band-good">{t.transferDone}</Card>;
  }

  if (pending) {
    return (
      <Card className="flex flex-col gap-3 text-sm">
        <p>{pendingNote ?? t.transferPending}</p>
        <p className="text-xs text-ink-300">{t.transferWaiting}</p>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void cancel()}>
          {t.transferCancel}
        </button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <Label htmlFor="transfer-email">{t.transferTarget}</Label>
        <Input
          id="transfer-email"
          type="email"
          autoComplete="off"
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="transfer-role">{t.roleAfterTransfer}</Label>
        <select
          id="transfer-role"
          className="input"
          value={keepRole}
          disabled={busy}
          onChange={(event) => setKeepRole(event.target.value as "admin" | "teacher" | "student")}
        >
          <option value="admin">{dict.people.role}: Admin</option>
          <option value="teacher">{dict.people.role}: Teacher</option>
          <option value="student">{dict.people.role}: Student</option>
        </select>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={includeBotHandover}
          disabled={busy}
          onChange={(event) => setIncludeBotHandover(event.target.checked)}
        />
        <span>
          {t.transferIncludeBot}
          <span className="mt-1 block text-xs text-ink-300">{t.transferIncludeBotHint}</span>
        </span>
      </label>

      <div>
        <Label htmlFor="transfer-password">{t.passwordLabel}</Label>
        <Input
          id="transfer-password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="mt-1 text-xs text-ink-300">{ownerEmail}</p>
      </div>

      {error && <p className="text-xs text-band-bad">{error}</p>}
      {pendingNote && <p className="text-xs text-ink-300">{pendingNote}</p>}

      <button
        type="button"
        className="btn-primary"
        disabled={busy || !email.trim() || !password}
        onClick={() => void submit()}
      >
        {busy ? dict.common.saving : t.transferConfirm}
      </button>
    </Card>
  );
}
