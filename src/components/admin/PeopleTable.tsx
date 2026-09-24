"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from "@/lib/auth/account-status";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import type { PersonRow } from "@/lib/data/people";
import type { Locale } from "@/lib/i18n";

/**
 * Role and status controls for one person.
 *
 * The client never decides anything: it renders only the actions the actor's
 * role may grant and posts them; the server re-checks rank, target and actor on
 * every call (see /api/admin/users/[id]/role and /status).
 */
export function PeopleTable({
  dict,
  locale,
  people,
  actorId,
  actorRole,
  grantableRoles,
}: {
  dict: Dictionary;
  locale: "uz" | "en";
  people: PersonRow[];
  actorId: string;
  actorRole: Role;
  grantableRoles: Role[];
}) {
  const t = dict.people;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function changeRole(person: PersonRow, role: Role) {
    setBusyId(person.id);
    setError(null);
    const res = await fetch(`/api/admin/users/${person.id}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`${t.failed} (${data.error ?? res.status})`);
      return;
    }
    router.refresh();
  }

  async function changeStatus(person: PersonRow, status: AccountStatus) {
    setBusyId(person.id);
    setError(null);
    const res = await fetch(`/api/admin/users/${person.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reason: reason.trim() || null }),
    });
    setBusyId(null);
    setReason("");
    setPendingStatusId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`${t.failed} (${data.error ?? res.status})`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-band-bad">{error}</p>}

      {/* Desktop: a real table. Below md it becomes one card per person, so no
          column is ever clipped or scrolled sideways. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-300">
              <th className="py-2 pr-3">{t.name}</th>
              <th className="py-2 pr-3">{t.role}</th>
              <th className="py-2 pr-3">{t.status}</th>
              <th className="py-2 pr-3">{t.created}</th>
              <th className="py-2">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr
                key={person.id}
                className="border-b border-ink-100/70 last:border-0"
                data-person-id={person.id}
                data-person-role={person.role}
                data-person-status={person.accountStatus}
              >
                <td className="py-2 pr-3">
                  <span className="font-medium text-ink-900">{person.name}</span>
                  {person.id === actorId && (
                    <span className="ml-2 badge bg-signal-100 text-signal-700">{t.you}</span>
                  )}
                  <span className="block text-xs text-ink-300">
                    {person.email ?? (person.telegramLinked ? "Telegram" : "—")}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <RoleControl
                    person={person}
                    actorId={actorId}
                    actorRole={actorRole}
                    grantableRoles={grantableRoles}
                    busy={busyId === person.id}
                    locale={locale}
                    onChange={changeRole}
                  />
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={person.accountStatus} locale={locale} />
                  {person.statusReason && (
                    <span className="block text-xs text-ink-300">{person.statusReason}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-ink-500">
                  {person.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="py-2">
                  <StatusControl
                    person={person}
                    actorId={actorId}
                    busy={busyId === person.id}
                    onAsk={(id) => setPendingStatusId(id)}
                    onConfirm={changeStatus}
                    pendingStatusId={pendingStatusId}
                    reason={reason}
                    setReason={setReason}
                    dict={dict}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {people.map((person) => (
          <div
            key={person.id}
            className="card flex flex-col gap-2 p-4"
            data-person-id={person.id}
            data-person-role={person.role}
            data-person-status={person.accountStatus}
          >
            <div>
              <p className="text-sm font-medium text-ink-900">
                {person.name}
                {person.id === actorId && (
                  <span className="ml-2 badge bg-signal-100 text-signal-700">{t.you}</span>
                )}
              </p>
              <p className="text-xs text-ink-300">
                {person.email ?? (person.telegramLinked ? "Telegram" : "—")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RoleControl
                person={person}
                actorId={actorId}
                actorRole={actorRole}
                grantableRoles={grantableRoles}
                busy={busyId === person.id}
                locale={locale}
                onChange={changeRole}
              />
              <StatusBadge status={person.accountStatus} locale={locale} />
            </div>
            <StatusControl
              person={person}
              actorId={actorId}
              busy={busyId === person.id}
              onAsk={(id) => setPendingStatusId(id)}
              onConfirm={changeStatus}
              pendingStatusId={pendingStatusId}
              reason={reason}
              setReason={setReason}
              dict={dict}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleControl({
  person,
  actorId,
  actorRole,
  grantableRoles,
  busy,
  locale,
  onChange,
}: {
  person: PersonRow;
  actorId: string;
  actorRole: Role;
  grantableRoles: Role[];
  busy: boolean;
  locale: Locale;
  onChange: (person: PersonRow, role: Role) => void;
}) {
  const locked = person.id === actorId || person.role === "owner" || !grantableRoles.length;
  if (locked) {
    return <span className="text-xs text-ink-500">{ROLE_LABELS[person.role][locale]}</span>;
  }
  void actorRole;
  return (
    <select
      className="input w-32 text-xs"
      value={person.role}
      disabled={busy}
      aria-label={`role for ${person.name}`}
      onChange={(event) => onChange(person, event.target.value as Role)}
    >
      {[...new Set([person.role, ...grantableRoles])].map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role][locale]}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ status, locale }: { status: AccountStatus; locale: string }) {
  const meta = ACCOUNT_STATUS_LABELS[status];
  const tone =
    meta.tone === "good"
      ? "bg-band-good/10 text-band-good"
      : meta.tone === "bad"
        ? "bg-band-bad/10 text-band-bad"
        : meta.tone === "warn"
          ? "bg-band-warn/10 text-band-warn"
          : "bg-ink-100 text-ink-500";
  return (
    <span className={`badge ${tone}`} data-account-status={status}>
      {locale === "uz" ? meta.uz : meta.en}
    </span>
  );
}

function StatusControl({
  person,
  actorId,
  busy,
  onAsk,
  onConfirm,
  pendingStatusId,
  reason,
  setReason,
  dict,
}: {
  person: PersonRow;
  actorId: string;
  busy: boolean;
  onAsk: (id: string | null) => void;
  onConfirm: (person: PersonRow, status: AccountStatus) => void;
  pendingStatusId: string | null;
  reason: string;
  setReason: (value: string) => void;
  dict: Dictionary;
}) {
  const t = dict.people;
  if (person.id === actorId || person.role === "owner") {
    return <span className="text-xs text-ink-300">{t.cannotChangeSelf}</span>;
  }

  if (pendingStatusId === person.id) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-40 text-xs"
          placeholder={t.reason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={busy}
          onClick={() => onConfirm(person, "suspended")}
        >
          {t.suspend}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => onAsk(null)}>
          {dict.common.cancel}
        </button>
      </div>
    );
  }

  if (person.accountStatus === "suspended" || person.accountStatus === "rejected") {
    return (
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={busy}
        onClick={() => onConfirm(person, "active")}
      >
        {t.reactivate}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      disabled={busy}
      onClick={() => onAsk(person.id)}
    >
      {t.suspend}
    </button>
  );
}
