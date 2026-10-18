"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";
import { Card } from "@/components/ui/Card";

/**
 * THE AUTHORING WORKSPACE (§AA).
 *
 * One screen over the content bank, the revision history, the native preview and the
 * publication workflow. It is a CLIENT of the existing services and never a second
 * CMS: every button here calls an admin route that calls the authoring registry, the
 * version store, the preview projection or the publication service. The screen has no
 * write path of its own and no visibility rule of its own.
 *
 * The flow it implements, in the order the services require it:
 *
 *   content → module → content type → create (registered author's template) or import
 *   → validate → preview → save draft → revise → publish / schedule / archive
 *
 * Two things it deliberately refuses to do:
 *   • it never renders the canonical snapshot as markup — preview parts are rendered as
 *     TEXT, so a block that contains markup is shown, not executed;
 *   • it never claims a revision is learner-visible from its own knowledge: the state
 *     shown is the state the bank aggregates, and openability stays with the service
 *     that can prove it (`/api/assignments/assignable`, the learner reads).
 */

type BankRow = {
  key: string;
  module: string;
  contentType: string;
  sourceRef: string;
  title: string;
  track: string;
  versions: number;
  latestVersionNo: number;
  latestVersionId: string;
  latestState: string;
  states: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  hasPublishedRevision: boolean;
};

type BankFacets = { value: string; count: number }[];
type BankResponse = {
  ok: true;
  rows: BankRow[];
  total: number;
  limit: number;
  offset: number;
  facets: { module: BankFacets; contentType: BankFacets; state: BankFacets; track: BankFacets };
};

type VersionRow = {
  id: string;
  versionNo: number;
  status: string;
  publicationState: string;
  title: string;
  track: string;
  targetType: string | null;
  targetId: string | null;
};

type PreviewPart = { key: string; label?: string; status?: string; items?: { label: string; value: string }[]; note?: string };
type PreviewResponse = {
  ok: true;
  preview: {
    identity: { module: string; contentType: string; sourceRef: string; versionIdentity: string; versionNo: number; status: string; publicationState: string; title: string };
    canonical: unknown;
    parts: PreviewPart[];
    answerKeyVisible: boolean;
    problems: string[];
    status: string;
  };
};

type ModuleCapability = {
  module: string;
  label: string;
  contentTypes: { contentType: string; authorable: boolean; importable: boolean; label: string | null }[];
};
type CapabilitiesResponse = { modules: ModuleCapability[] };

const PAGE_SIZE = 25;

/**
 * Where a package is imported today. These are the two package-import surfaces the
 * repository has; a content type that is importable but has no surface yet is reported
 * as importable-and-validate-only rather than linked to a page that does not exist.
 */
const IMPORT_PATHS: Record<string, string> = {
  reading: "/app/admin/reading/import",
  listening: "/app/admin/listening/import",
};

/** The four states, in workflow order — the same vocabulary `dict.admin.publication` labels. */
const PUBLICATION_STATE_KEYS = ["draft", "scheduled", "published", "archived"] as const;

/**
 * Publication state as a pill. The class comes from the ONE place that names these
 * states — `dict.admin.publication.states` — so the label a staff member reads here is the
 * label the rest of the admin uses, and the colour only distinguishes the four.
 */
const stateClass = (state: string): string =>
  state === "published"
    ? "badge-done"
    : state === "scheduled"
      ? "badge bg-signal-100 text-signal-700"
      : state === "archived"
        ? "badge-locked"
        : "badge bg-band-warn/10 text-band-warn";

function StatePill({ state, label }: { state: string; label: string }) {
  return <span className={stateClass(state)} data-state={state}>{label}</span>;
}

const stamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");
};

export function ContentWorkspace({ dict, canPublish }: { dict: Dictionary; canPublish: boolean }) {
  const t = dict.admin.contentWorkspace;
  const states = dict.admin.publication.states;

  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const track = useRef(false);

  const [capabilities, setCapabilities] = useState<ModuleCapability[]>([]);
  const [filters, setFilters] = useState({ module: "", contentType: "", state: "", hasState: "", track: "", sourceRef: "", title: "", q: "", versionNo: "", from: "", to: "" });
  const [offset, setOffset] = useState(0);
  const [bank, setBank] = useState<BankResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<BankRow | null>(null);

  const query = useCallback(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filters.module) params.set("module", filters.module);
    if (filters.contentType) params.set("contentType", filters.contentType);
    if (filters.state) params.set("state", filters.state);
    if (filters.hasState) params.set("hasState", filters.hasState);
    if (filters.track) params.set("track", filters.track);
    if (filters.sourceRef) params.set("sourceRef", filters.sourceRef);
    if (filters.title) params.set("title", filters.title);
    if (filters.q) params.set("q", filters.q);
    if (filters.versionNo) params.set("versionNo", filters.versionNo);
    if (filters.from) params.set("from", new Date(filters.from).toISOString());
    if (filters.to) params.set("to", new Date(filters.to).toISOString());
    return params.toString();
  }, [filters, offset]);

  const load = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const res = await requestJson<BankResponse>(`/api/admin/content/bank?${query()}`, { method: "GET", signal: controller.signal });
      if (active.current !== controller) return;
      if (!res.ok) { setError(t.errorUnknown); return; }
      setBank(res.data);
    } catch {
      if (active.current === controller) setError(t.errorUnknown);
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }, [query, t.errorUnknown]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let live = true;
    void requestJson<CapabilitiesResponse>("/api/admin/content/authoring-capabilities", { method: "GET" }).then((res) => {
      if (live && res.ok) setCapabilities(res.data.modules);
    });
    return () => { live = false; };
  }, []);

  const setFilter = (patch: Partial<typeof filters>) => { setOffset(0); setFilters((current) => ({ ...current, ...patch })); };
  const modules = capabilities.length > 0 ? capabilities : [];
  const contentTypes = modules.find((entry) => entry.module === filters.module)?.contentTypes ?? modules.flatMap((entry) => entry.contentTypes.map((type) => ({ ...type, module: entry.module })));
  const total = bank?.total ?? 0;
  const shown = (bank?.rows ?? []).length;

  return (
    <div className="space-y-6" data-content-workspace>
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted">{t.hint}</p>
          </div>
          <NewItemButton dict={dict} modules={modules} onCreated={() => void load()} />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">{t.bankTitle}</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Field label={t.filterModule}>
            <select className="w-full" data-bank-module value={filters.module} onChange={(event) => setFilter({ module: event.target.value, contentType: "" })}>
              <option value="">{t.any}</option>
              {modules.map((module) => <option key={module.module} value={module.module}>{module.label}</option>)}
            </select>
          </Field>
          <Field label={t.filterType}>
            <select className="w-full" data-bank-type value={filters.contentType} onChange={(event) => setFilter({ contentType: event.target.value })}>
              <option value="">{t.any}</option>
              {contentTypes.map((type) => (
                <option key={`${"module" in type ? type.module : filters.module}:${type.contentType}`} value={type.contentType}>
                  {typeof type.label === "string" ? type.label : type.contentType}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.filterState}>
            <select className="w-full" data-bank-state value={filters.state} onChange={(event) => setFilter({ state: event.target.value })}>
              <option value="">{t.any}</option>
              {PUBLICATION_STATE_KEYS.map((value) => <option key={value} value={value}>{states[value]}</option>)}
            </select>
          </Field>
          <Field label={t.filterHasState}>
            <select className="w-full" data-bank-has-state value={filters.hasState} onChange={(event) => setFilter({ hasState: event.target.value })}>
              <option value="">{t.any}</option>
              {PUBLICATION_STATE_KEYS.map((value) => <option key={value} value={value}>{states[value]}</option>)}
            </select>
          </Field>
          <Field label={t.filterIdentity}>
            <input className="w-full" data-bank-identity value={filters.sourceRef} onChange={(event) => setFilter({ sourceRef: event.target.value })} placeholder="reading:general_set:harbour-2024" />
          </Field>
          <Field label={t.filterTitle}>
            <input className="w-full" data-bank-title value={filters.title} onChange={(event) => setFilter({ title: event.target.value })} />
          </Field>
          <Field label={t.filterQuery}>
            <input className="w-full" data-bank-query value={filters.q} onChange={(event) => setFilter({ q: event.target.value })} />
          </Field>
          <Field label={t.filterVersion}>
            <input className="w-full" data-bank-version inputMode="numeric" value={filters.versionNo} onChange={(event) => setFilter({ versionNo: event.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label={t.filterTrack}>
            <input className="w-full" data-bank-track value={filters.module === "listening" && filters.track === "academic" ? dict.listening.academic.title : filters.track} onChange={(event) => setFilter({ track: filters.module === "listening" && event.target.value.toLowerCase() === dict.listening.academic.title.toLowerCase() ? "academic" : event.target.value })} placeholder={filters.module === "listening" ? dict.listening.academic.title : "academic"} />
          </Field>
          <Field label={t.filterFrom}>
            <input className="w-full" type="date" data-bank-from value={filters.from} onChange={(event) => setFilter({ from: event.target.value })} />
          </Field>
          <Field label={t.filterTo}>
            <input className="w-full" type="date" data-bank-to value={filters.to} onChange={(event) => setFilter({ to: event.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <button type="button" className="btn-primary" data-bank-search disabled={busy} onClick={() => void load()}>
              {busy ? t.searching : t.search}
            </button>
            <button type="button" className="btn-secondary" data-bank-clear onClick={() => { setFilters({ module: "", contentType: "", state: "", hasState: "", track: "", sourceRef: "", title: "", q: "", versionNo: "", from: "", to: "" }); setOffset(0); }}>
              {t.clear}
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600" data-bank-error>{error}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm" data-bank-table>
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="py-2">{t.columnItem}</th>
                <th className="py-2">{t.columnVersions}</th>
                <th className="py-2">{t.columnState}</th>
                <th className="py-2">{t.columnUpdated}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {(bank?.rows ?? []).map((row) => (
                <tr key={row.key} className="border-t border-border" data-bank-row={row.key}>
                  <td className="py-2">
                    <div className="font-medium">{row.title}</div>
                    <div className="font-mono text-xs text-muted" data-bank-row-identity>{row.module}:{row.contentType}:{row.sourceRef}</div>
                  </td>
                  <td className="py-2">
                    <span data-bank-row-versions>{row.versions}</span>
                    <span className="text-muted"> · v{row.latestVersionNo}</span>
                    <div className="text-xs text-muted">
                      {(["draft", "scheduled", "published", "archived"] as const)
                        .filter((state) => (row.states[state] ?? 0) > 0)
                        .map((state) => `${states[state as keyof typeof states]} ${row.states[state]}`)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="py-2">
                  <StatePill state={row.latestState} label={states[row.latestState as keyof typeof states] ?? row.latestState} />
                </td>
                  <td className="py-2 text-xs text-muted">{stamp(row.updatedAt)}</td>
                  <td className="py-2 text-right">
                    <button type="button" className="btn-secondary" data-bank-row-open onClick={() => setOpen(row)}>{t.open}</button>
                  </td>
                </tr>
              ))}
              {shown === 0 && !busy ? <tr><td colSpan={5} className="py-4 text-sm text-muted" data-bank-empty>{t.empty}</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span data-bank-total>{t.results.replace("{n}", String(total))}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" data-bank-previous disabled={offset === 0 || busy} onClick={() => setOffset((current) => Math.max(current - PAGE_SIZE, 0))}>{t.previous}</button>
            <span data-bank-page>{t.page} {Math.floor(offset / PAGE_SIZE) + 1}</span>
            <button type="button" className="btn-secondary" data-bank-next disabled={offset + PAGE_SIZE >= total || busy} onClick={() => setOffset((current) => current + PAGE_SIZE)}>{t.next}</button>
          </div>
        </div>
      </Card>

      {open ? (
        <ItemPanel
          dict={dict}
          canPublish={canPublish}
          item={open}
          onClose={() => setOpen(null)}
          onChanged={() => { void load(); }}
        />
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function ItemPanel({ dict, canPublish, item, onClose, onChanged }: { dict: Dictionary; canPublish: boolean; item: BankRow; onClose: () => void; onChanged: () => void }) {
  const t = dict.admin.contentWorkspace;
  const states = dict.admin.publication.states;
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [preview, setPreview] = useState<PreviewResponse["preview"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [revising, setRevising] = useState<{ versionId: string; payload: string; sourceRef: string; title: string } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [validity, setValidity] = useState<"valid" | "invalid" | null>(null);

  const path = `/api/admin/content/items/${encodeURIComponent(item.module)}/${encodeURIComponent(item.contentType)}/${encodeURIComponent(item.sourceRef)}`;

  const loadVersions = useCallback(async () => {
    setBusy(true);
    const res = await requestJson<{ versions: VersionRow[] }>(path, { method: "GET" });
    if (res.ok) setVersions(res.data.versions);
    else setError(t.errorUnknown);
    setBusy(false);
  }, [path, t.errorUnknown]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  async function showPreview(versionId: string) {
    setBusy(true);
    setError("");
    const res = await requestJson<PreviewResponse>(`/api/admin/content/versions/${versionId}/preview`, { method: "GET" });
    if (res.ok) setPreview(res.data.preview);
    else setError(t.errorUnknown);
    setBusy(false);
  }

  async function move(versionId: string, to: "draft" | "scheduled" | "published" | "archived") {
    setBusy(true);
    setError("");
    const res = await requestJson<{ ok: boolean }>(
      `/api/admin/content/versions/${versionId}/publication`,
      { body: { to, ...(to === "scheduled" && publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}) } },
    );
    if (!res.ok) setError(res.status === 403 ? t.forbidden : t.errorUnknown);
    else { setPreview(null); await loadVersions(); onChanged(); }
    setBusy(false);
  }

  /** Revise from the canonical snapshot: what is edited is exactly what the store holds. */
  async function startRevise(version: VersionRow) {
    setBusy(true);
    setError("");
    const res = await requestJson<PreviewResponse>(`/api/admin/content/versions/${version.id}/preview`, { method: "GET" });
    setBusy(false);
    if (!res.ok) { setError(t.errorUnknown); return; }
    if (res.data.preview.canonical === null) { setError(t.executable); return; }
    setRevising({ versionId: version.id, payload: JSON.stringify(res.data.preview.canonical, null, 2), sourceRef: item.sourceRef, title: item.title });
    setValidity(null);
  }

  async function validate() {
    if (!revising) return;
    setBusy(true);
    setError("");
    let parsed: unknown;
    try { parsed = JSON.parse(revising.payload); } catch { setBusy(false); setError(t.invalid); setValidity("invalid"); return; }
    const res = await requestJson<{ ok: boolean }>("/api/admin/content/validate", { body: { package: parsed } });
    setBusy(false);
    setValidity(res.ok && (res.data as { ok?: boolean }).ok === true ? "valid" : "invalid");
  }

  async function saveRevision() {
    if (!revising || saving) return;
    setSaving(true);
    setError("");
    let payload: unknown;
    try { payload = JSON.parse(revising.payload); } catch { setSaving(false); setError(t.invalid); return; }
    const res = await requestJson<{ ok: boolean }>("/api/admin/content/drafts", {
      body: { module: item.module, contentType: item.contentType, sourceRef: revising.sourceRef, title: revising.title, payload, note: note || null, versionId: revising.versionId },
    });
    setSaving(false);
    if (!res.ok) { setError(t.errorUnknown); return; }
    setRevising(null);
    setNote("");
    await loadVersions();
    onChanged();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" data-item-title>{item.title}</h2>
          <p className="font-mono text-xs text-muted" data-item-identity>{item.module}:{item.contentType}:{item.sourceRef}</p>
        </div>
        <button type="button" className="btn-secondary" data-item-close onClick={onClose}>{t.close}</button>
      </div>

      {error ? <p className="mt-2 text-sm text-red-600" data-item-error>{error}</p> : null}

      <h3 className="mt-4 text-xs font-semibold uppercase text-muted">{t.versionsTitle}</h3>
      <div className="overflow-x-auto">
      <table className="mt-2 w-full text-sm" data-item-versions>
        <tbody>
          {(versions ?? []).map((version) => (
            <tr key={version.id} className="border-t border-border" data-item-version={version.versionNo}>
              <td className="py-2">v{version.versionNo}</td>
              <td className="py-2"><StatePill state={version.publicationState} label={states[version.publicationState as keyof typeof states] ?? version.publicationState} /></td>
              <td className="py-2 font-mono text-xs text-muted">{version.targetType ?? "—"}</td>
              <td className="py-2 text-right">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  <button type="button" className="btn-secondary" data-version-preview onClick={() => void showPreview(version.id)}>{t.preview}</button>
                  <button type="button" className="btn-secondary" data-version-revise onClick={() => void startRevise(version)}>{t.revise}</button>
                  {version.publicationState !== "published" ? <button type="button" className="btn-primary" data-version-publish disabled={!canPublish || busy} onClick={() => void move(version.id, "published")}>{t.publish}</button> : null}
                  {version.publicationState !== "scheduled" ? <button type="button" className="btn-secondary" data-version-schedule disabled={!canPublish || busy} onClick={() => void move(version.id, "scheduled")}>{t.schedule}</button> : null}
                  {version.publicationState !== "archived" ? <button type="button" className="btn-secondary" data-version-archive disabled={!canPublish || busy} onClick={() => void move(version.id, "archived")}>{t.archive}</button> : null}
                </span>
              </td>
            </tr>
          ))}
          {versions !== null && versions.length === 0 ? <tr><td className="py-3 text-sm text-muted">{t.noVersions}</td></tr> : null}
        </tbody>
      </table>
      </div>

      {canPublish ? (
        <label className="mt-3 block text-xs text-muted">
          <span className="mb-1 block">{t.publishAtHint}</span>
          <input className="w-64" data-item-publish-at type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} />
        </label>
      ) : null}

      {revising ? (
        <div className="mt-4 rounded border border-border p-3" data-revise-panel>
          <h3 className="text-xs font-semibold uppercase text-muted">{t.revise}</h3>
          <p className="mt-1 font-mono text-xs text-muted">{item.module}:{item.contentType}:{revising.sourceRef}</p>
          <textarea className="mt-2 h-56 w-full font-mono text-xs" data-revise-payload value={revising.payload} onChange={(event) => setRevising({ ...revising, payload: event.target.value })} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" data-revise-validate disabled={busy} onClick={() => void validate()}>{busy ? t.validating : t.validate}</button>
            <button type="button" className="btn-primary" data-revise-save disabled={saving} onClick={() => void saveRevision()}>{saving ? t.saving : t.saveDraft}</button>
            <button type="button" className="btn-secondary" onClick={() => setRevising(null)}>{t.closeForm}</button>
            {validity ? <span className={validity === "valid" ? "text-xs text-green-700" : "text-xs text-red-600"} data-revise-validity>{validity === "valid" ? t.valid : t.invalid}</span> : null}
            <input className="w-64" placeholder={dict.admin.publication.changeState} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 rounded border border-border p-3" data-preview-panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase text-muted">{t.previewTitle.replace("{identity}", preview.identity.versionIdentity)}</h3>
            <span className={preview.status === "PREVIEW_READY" ? "badge-done" : preview.status === "PARTIAL" ? "badge bg-band-warn/10 text-band-warn" : "badge-locked"} data-preview-status={preview.status}>
              {preview.status === "PREVIEW_READY" ? t.previewStatus : preview.status === "PARTIAL" ? t.previewPartial : t.previewMissing}
            </span>
          </div>
          {preview.answerKeyVisible ? <p className="mt-2 text-xs text-amber-700" data-preview-answer-key>{t.previewAnswerKey}</p> : null}
          {preview.problems.length > 0 ? (
            <p className="mt-2 text-xs text-red-600" data-preview-problems>{t.previewProblems}: {preview.problems.join(", ")}</p>
          ) : null}
          <h4 className="mt-3 text-xs font-semibold uppercase text-muted">{t.previewParts}</h4>
          <ul className="mt-1 space-y-2 text-sm" data-preview-parts>
            {preview.parts.map((part) => (
              <li key={part.key} className="rounded border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{part.label ?? part.key}</span>
                  {part.status ? <span className="text-xs text-muted">{part.status}</span> : null}
                </div>
                {part.note ? <p className="text-xs text-muted">{part.note}</p> : null}
                {part.items?.length ? (
                  <dl className="mt-1 grid grid-cols-1 gap-1 text-xs md:grid-cols-2">
                    {part.items.map((entry, index) => (
                      <div key={`${part.key}-${index}`}>
                        <dt className="text-muted">{entry.label}</dt>
                        {/* Text only: a preview shows authored material, it never executes it. */}
                        <dd className="whitespace-pre-wrap font-mono">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
          {preview.canonical === null ? <p className="mt-2 text-xs text-amber-700" data-preview-redacted>{t.executable}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

function NewItemButton({ dict, modules, onCreated }: { dict: Dictionary; modules: ModuleCapability[]; onCreated: () => void }) {
  const t = dict.admin.contentWorkspace;
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState("");
  const [contentType, setContentType] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [title, setTitle] = useState("");
  const [track, setTrack] = useState("unspecified");
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const types = modules.find((entry) => entry.module === module)?.contentTypes ?? [];
  const capability = types.find((entry) => entry.contentType === contentType) ?? null;
  const importPath = capability?.importable === true ? (IMPORT_PATHS[module] ?? null) : null;

  async function loadTemplate(kind: "template" | "example") {
    if (!module || !contentType) return;
    setBusy(true);
    setError("");
    const res = await requestJson<Record<string, unknown>>(
      `/api/admin/content/template?module=${encodeURIComponent(module)}&contentType=${encodeURIComponent(contentType)}&kind=${kind}`,
      { method: "GET" },
    );
    setBusy(false);
    if (!res.ok) { setError(t.errorUnknown); return; }
    setPayload(JSON.stringify(res.data, null, 2));
    const candidate = res.data as { sourceRef?: unknown; title?: unknown };
    if (typeof candidate.sourceRef === "string") setSourceRef(candidate.sourceRef);
    if (typeof candidate.title === "string") setTitle(candidate.title);
  }

  async function validate() {
    setBusy(true);
    setError("");
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { setBusy(false); setError(t.invalid); return; }
    const res = await requestJson<{ ok: boolean }>("/api/admin/content/validate", { body: { package: parsed } });
    setBusy(false);
    setError(res.ok && res.data.ok ? "" : t.invalid);
  }

  async function save() {
    setBusy(true);
    setError("");
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { setBusy(false); setError(t.invalid); return; }
    const res = await requestJson<{ ok: boolean }>("/api/admin/content/drafts", {
      body: { module, contentType, sourceRef, title, track, payload: parsed, note: note || null },
    });
    setBusy(false);
    if (!res.ok) { setError(t.errorUnknown); return; }
    setOpen(false);
    setPayload("");
    onCreated();
  }

  return (
    <>
      <button type="button" className="btn-secondary" data-new-item onClick={() => setOpen((current) => !current)}>{t.newItem}</button>
      {open ? (
        <div className="mt-3 w-full rounded border border-border p-3" data-new-item-panel>
          <p className="text-xs text-muted">{t.newHint}</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <Field label={t.newModule}>
              <select className="w-full" data-new-module value={module} onChange={(event) => { setModule(event.target.value); setContentType(""); }}>
                <option value="">—</option>
                {modules.map((entry) => <option key={entry.module} value={entry.module} disabled={entry.contentTypes.length === 0}>{entry.label}</option>)}
              </select>
            </Field>
            <Field label={t.newType}>
              <select className="w-full" data-new-type value={contentType} onChange={(event) => setContentType(event.target.value)}>
                <option value="">—</option>
                {types.map((entry) => (
                  <option key={entry.contentType} value={entry.contentType}>{typeof entry.label === "string" ? entry.label : entry.contentType}</option>
                ))}
              </select>
            </Field>
            <Field label={t.newSourceRef}>
              <input className="w-full font-mono text-xs" data-new-source-ref value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} />
            </Field>
            <Field label={t.newTitle}>
              <input className="w-full" data-new-title value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label={t.newTrack}>
              <select className="w-full" data-new-track value={track} onChange={(event) => setTrack(event.target.value)}>
                {/* Tracks are a fixed vocabulary in the taxonomy; the labels are terms of art. */}
                <option value="unspecified">unspecified</option>
                <option value="academic">{module === "listening" ? dict.listening.academic.title : "academic"}</option>
                <option value="general_training">general_training</option>
              </select>
            </Field>
            <div className="flex items-end gap-2 md:col-span-3">
              <button type="button" className="btn-secondary" data-new-template disabled={!contentType || busy} onClick={() => void loadTemplate("template")}>{t.template}</button>
              <button type="button" className="btn-secondary" data-new-example disabled={!contentType || busy} onClick={() => void loadTemplate("example")}>{t.loadExample}</button>
              {importPath ? (
                <Link className="btn-secondary" href={importPath} data-new-import>{t.importInstead}</Link>
              ) : null}
            </div>
          </div>
          {capability && capability.authorable === false ? <p className="mt-2 text-xs text-muted" data-new-not-authorable>{t.importHint}</p> : null}
          <textarea className="mt-2 h-56 w-full font-mono text-xs" data-new-payload value={payload} onChange={(event) => setPayload(event.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" data-new-validate disabled={busy || !payload} onClick={() => void validate()}>{busy ? t.validating : t.validate}</button>
            <button type="button" className="btn-primary" data-new-save disabled={busy || !payload || !sourceRef || !title || capability?.authorable === false} onClick={() => void save()}>{busy ? t.saving : t.saveDraft}</button>
            <input className="w-64" placeholder={dict.admin.publication.changeState} value={note} onChange={(event) => setNote(event.target.value)} />
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t.closeForm}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
