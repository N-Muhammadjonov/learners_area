"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";

/**
 * The final step of a business transfer.
 *
 * Two fields must be filled deliberately, and the password is re-verified
 * server-side: an unattended session cannot hand the centre to somebody else.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/owner/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, keepRole }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`${t.transferFailed} (${data.error ?? res.status})`);
      return;
    }
    setDone(true);
    setPassword("");
    router.refresh();
  }

  if (done) {
    return <Card className="text-sm text-band-good">{t.transferDone}</Card>;
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
