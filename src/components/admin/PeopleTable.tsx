"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS, type AccountStatus } from "@/lib/auth/account-status";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import type { PersonRow } from "@/lib/data/people";
import type { Locale } from "@/lib/i18n";
import { Label } from "@/components/ui/Input";
import { ConfirmAction, ConfirmSelect } from "@/components/interaction/InteractionPrimitives";
import { apiErrorMessage } from "@/lib/api-error-message";

function peoplePageHref(
  filters: { q: string; role?: Role; status?: AccountStatus },
  page: number,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.role) params.set("role", filters.role);
  if (filters.status) params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/people?${query}` : "/admin/people";
}

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
  filters,
  page,
  pageSize,
  total,
  totalPages,
  actorId,
  actorRole,
  grantableRoles,
}: {
  dict: Dictionary;
  locale: Locale;
  people: PersonRow[];
  filters: { q: string; role?: Role; status?: AccountStatus };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  actorId: string;
  actorRole: Role;
  grantableRoles: Role[];
}) {
  const requestResponse = useScopedResponse(25000);

  const t = dict.people;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const rangeLabel = t.showingRange
    .replace("{start}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{end}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  async function changeRole(person: PersonRow, role: Role): Promise<void> {
    setBusyId(person.id);
    setError(null);
    try {
      const res = await requestResponse(`/api/admin/users/${person.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
    if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`${t.failed} ${apiErrorMessage(data.error, res.status, dict)}`);
        throw new Error("role_change_failed");
      }
      router.refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === "role_change_failed")) setError(t.failed);
      throw error;
    } finally {
      setBusyId(null);
    }
  }

  async function changeStatus(person: PersonRow, status: AccountStatus): Promise<void> {
    setBusyId(person.id);
    setError(null);
    try {
      const res = await requestResponse(`/api/admin/users/${person.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reason.trim() || null }),
      });
    if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`${t.failed} ${apiErrorMessage(data.error, res.status, dict)}`);
        throw new Error("status_change_failed");
      }
      setReason("");
      setPendingStatusId(null);
      router.refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === "status_change_failed")) setError(t.failed);
      throw error;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-band-bad">{error}</p>}

      <form action="/admin/people" method="get" className="panel flex flex-wrap items-end gap-3" data-people-search-form>
        <div className="min-w-[min(100%,16rem)] flex-1">
          <Label htmlFor="people-search">{t.searchLabel}</Label>
          <input
            id="people-search"
            name="q"
            type="search"
            autoComplete="off"
            maxLength={100}
            defaultValue={filters.q}
            placeholder={t.searchPlaceholder}
            className="input w-full"
          />
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Label htmlFor="people-role">{t.role}</Label>
          <select id="people-role" name="role" className="input w-full" defaultValue={filters.role ?? ""}>
            <option value="">{t.allRoles}</option>
            {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role][locale]}</option>)}
          </select>
        </div>
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <Label htmlFor="people-status">{t.status}</Label>
          <select id="people-status" name="status" className="input w-full" defaultValue={filters.status ?? ""}>
            <option value="">{t.allStatuses}</option>
            {ACCOUNT_STATUSES.map((status) => (
              <option key={status} value={status}>{ACCOUNT_STATUS_LABELS[status][locale]}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">{t.searchAction}</button>
        <Link href="/admin/people" className="btn-secondary">{t.clearFilters}</Link>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500" aria-live="polite">
        <span>{t.resultsCount.replace("{count}", String(total))}</span>
        <span>{rangeLabel}</span>
      </div>
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
            {people.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-ink-500" data-people-empty>
                  {t.noResults}
                </td>
              </tr>
            ) : people.map((person) => (
              <tr
                key={person.id}
                className="border-b border-ink-100/70 last:border-0"
                data-person-id={person.id}
                data-person-role={person.role}
                data-person-status={person.accountStatus}
              >
                <td className="py-2 pr-3">
                  {person.role === "student" ? <Link href={`/admin/people/${person.id}`} className="font-medium text-signal-600 underline underline-offset-4">{person.name}</Link> : <span className="font-medium text-ink-900">{person.name}</span>}
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
                    dict={dict}
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
        {people.length === 0 ? (
          <p className="card text-sm text-ink-500" data-people-empty>{t.noResults}</p>
        ) : people.map((person) => (
          <div
            key={person.id}
            className="card flex flex-col gap-2 p-4"
            data-person-id={person.id}
            data-person-role={person.role}
            data-person-status={person.accountStatus}
          >
            <div>
              <p className="text-sm font-medium text-ink-900">
                {person.role === "student" ? <Link href={`/admin/people/${person.id}`} className="text-signal-600 underline underline-offset-4">{person.name}</Link> : person.name}
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
                dict={dict}
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
      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t.title} data-people-pagination>
          <span className="text-sm text-ink-500">
            {t.pageOf.replace("{page}", String(page)).replace("{total}", String(totalPages))}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={peoplePageHref(filters, page - 1)} className="btn-secondary">
                {t.previousPage}
              </Link>
            )}
            {page < totalPages && (
              <Link href={peoplePageHref(filters, page + 1)} className="btn-secondary">
                {t.nextPage}
              </Link>
            )}
          </div>
        </nav>
      )}
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
  dict,
  onChange,
}: {
  person: PersonRow;
  actorId: string;
  actorRole: Role;
  grantableRoles: Role[];
  busy: boolean;
  locale: Locale;
  dict: Dictionary;
  onChange: (person: PersonRow, role: Role) => Promise<void>;
}) {
  const locked = person.id === actorId || person.role === "owner" || !grantableRoles.length;
  if (locked) {
    return <span className="text-xs text-ink-500">{ROLE_LABELS[person.role][locale]}</span>;
  }
  void actorRole;
  const roles = [...new Set([person.role, ...grantableRoles])];
  return (
    <ConfirmSelect
      className="input w-32 text-xs"
      value={person.role}
      disabled={busy}
      ariaLabel={`${dict.people.role} for ${person.name}`}
      options={roles.map((role) => ({ value: role, label: ROLE_LABELS[role][locale] }))}
      title={dict.people.confirmRoleTitle}
      description={dict.people.confirmRoleBody}
      confirmLabel={dict.common.confirm}
      cancelLabel={dict.common.cancel}
      pendingLabel={dict.loadingPage.label}
      failureMessage={dict.people.failed}
      onConfirm={(value) => onChange(person, value as Role)}
    />
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
  onConfirm: (person: PersonRow, status: AccountStatus) => Promise<void>;
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
          aria-busy={busy || undefined}
          data-interaction-type="destructive"
          onClick={() => { void onConfirm(person, "suspended").catch(() => undefined); }}
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
      <ConfirmAction
        trigger={t.reactivate}
        triggerClassName="btn-secondary text-xs"
        triggerDisabled={busy}
        title={dict.people.confirmStatusTitle}
        description={dict.people.confirmStatusBody}
        confirmLabel={dict.common.confirm}
        cancelLabel={dict.common.cancel}
        pendingLabel={dict.loadingPage.label}
        failureMessage={dict.people.failed}
        onConfirm={() => onConfirm(person, "active")}
      />
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
