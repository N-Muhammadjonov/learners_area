"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
import type { Locale } from "@/lib/i18n";

const overlaySchema = z.object({
  feedbackStyle: z.enum(["concise", "balanced", "step_by_step"]).optional(),
  explanationDepth: z.enum(["simple", "standard", "detailed"]).optional(),
  learnerTone: z.enum(["encouraging", "direct", "coach_explanatory"]).optional(),
  maxStrengths: z.number().int().min(0).max(6).optional(),
  maxWeaknesses: z.number().int().min(0).max(6).optional(),
  maxNextActions: z.number().int().min(0).max(6).optional(),
  exampleCount: z.number().int().min(0).max(4).optional(),
  useMiniIllustrations: z.boolean().optional(),
  prioritizeBandLimitingIssues: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
  includeCorrections: z.boolean().optional(),
  includeReusableRule: z.boolean().optional(),
  showPerAnswerScore: z.boolean().optional(),
  topicSummary: z.boolean().optional(),
  topicSummaryMaxWeaknesses: z.number().int().min(0).max(3).optional(),
  feedbackUnit: z.enum(["per_answer", "per_topic"]).optional(),
}).strict();
const versionSchema = z.object({
  id: z.string().uuid(), policyId: z.string().uuid(), scope: z.string().max(100), version: z.number().int().positive(),
  state: z.enum(["candidate", "approved", "superseded", "rejected"]), overlay: overlaySchema,
  sourceMessageHash: z.string().regex(/^[a-f0-9]{64}$/i), regressionFixtureId: z.string().max(120).nullable(),
  regressionEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(), regressionPassedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().uuid().nullable(), reviewedByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), approvedAt: z.string().datetime().nullable(), active: z.boolean(),
}).strict();
const regressionSchema = z.object({
  fixtureId: z.string().max(120), passed: z.boolean(), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  checks: z.record(z.boolean()), affectedTaskKeys: z.array(z.string().max(100)).max(100),
}).strict();
const pageSchema = z.object({ ok: z.literal(true), versions: z.array(versionSchema).max(100), nextCursor: z.string().max(2048).nullable(), versionCount: z.number().int().nonnegative() }).strict();
const candidateSchema = z.object({ ok: z.literal(true), replay: z.boolean(), candidate: versionSchema }).strict();
const previewSchema = z.object({ ok: z.literal(true), candidate: versionSchema, regression: regressionSchema }).strict();
const approveSchema = z.object({ ok: z.literal(true), replay: z.boolean(), candidate: versionSchema }).strict();

type PolicyVersion = z.infer<typeof versionSchema>;
type Regression = z.infer<typeof regressionSchema>;

function copy(locale: Locale) {
  const uz = locale === "uz";
  return {
    title: uz ? "Baholash siyosati suhbati" : "Assessment policy chat",
    workflow: uz ? "Jarayon: Nomzod yaratish → Regressiyani ko'rib chiqish → Alohida tasdiqlash va faollashtirish." : "Workflow: Create candidate → Preview and run regression → Approve and activate.",
    intro: uz
      ? "Faqat tasdiqlangan taqdimot maydonlari nomzodga aylantiriladi. Xabar matni saqlanmaydi; nomzod regressiya tekshiruvi va egasining alohida tasdig'isiz faollashmaydi."
      : "Only allowlisted teaching-presentation settings become candidates. The message itself is not stored; a candidate stays inactive until regression preview and separate owner approval.",
    placeholder: uz ? "Masalan: Writing Task 2 uchun uchta eng katta zaiflikni ko'rsating, dalilni keltiring, tuzatish va qayta ishlatiladigan qoida bering." : "Example: For Writing Task 2, show the three biggest weaknesses, quote evidence, and include a correction and a reusable rule.",
    create: uz ? "Nomzod yaratish" : "Create candidate",
    creating: uz ? "Nomzod yaratilmoqda…" : "Creating candidate…",
    preview: uz ? "Xavfsiz preview va regressiya" : "Preview and run regression",
    previewing: uz ? "Tekshirilmoqda…" : "Checking…",
    approve: uz ? "Tasdiqlash va faollashtirish" : "Approve and activate",
    approving: uz ? "Tasdiqlanmoqda…" : "Approving…",
    reject: uz ? "Rad etish" : "Reject",
    rejected: uz ? "Rad etildi." : "Rejected.",
    state: uz ? "Holat" : "State",
    scope: uz ? "Ko'lam" : "Scope",
    version: uz ? "Versiya" : "Version",
    active: uz ? "faol" : "active",
    candidate: uz ? "nomzod" : "candidate",
    passed: uz ? "muvaffaqiyatli" : "passed",
    failed: uz ? "muvaffaqiyatsiz" : "failed",
    hash: uz ? "Manba xeshi" : "Source-message digest",
    checks: uz ? "Regressiya invariants" : "Regression invariants",
    keys: uz ? "Ta'sirlanadigan vazifalar" : "Affected task contracts",
    history: uz ? "Versiyalar va ko'rib chiqish tarixi" : "Versions and review history",
    loading: uz ? "Yuklanmoqda…" : "Loading…",
    loadMore: uz ? "Oldingi versiyalarni yuklash" : "Load earlier versions",
    error: uz ? "Amal xavfsiz yakunlanmadi. Qayta urinib ko'ring." : "The action could not be completed safely. Please retry.",
    empty: uz ? "Hali siyosat versiyalari yo'q." : "No policy versions yet.",
    regressionNeeded: uz ? "Tasdiqlashdan oldin regressiya preview talab qilinadi." : "A regression preview is required before approval.",
    confirmed: uz ? "Preview muvaffaqiyatli. Endi alohida tasdiqlashingiz mumkin." : "Preview passed. You can now approve this candidate separately.",
    replay: uz ? "Bu xabar avvalgi nomzod bilan bir xil; yangi versiya ochilmadi." : "This message matches an existing candidate; no duplicate version was created.",
    policyLabel: uz ? "Owner siyosati" : "Owner policy",
    selectVersion: uz ? "Ko'rib chiqiladigan versiyani tanlang" : "Select a version to review",
    perPage: uz ? "Ko'proq tarix mavjud." : "More version history is available.",
  };
}

function appendUnique(current: PolicyVersion[], incoming: PolicyVersion[]) {
  const ids = new Set(current.map((version) => version.id));
  return [...current, ...incoming.filter((version) => !ids.has(version.id))];
}

export function OwnerAssessmentPolicyPanel({ locale }: { locale: Locale }) {
  const text = copy(locale);
  const requestResponse = useScopedResponse(20_000);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [versionCount, setVersionCount] = useState(0);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regression, setRegression] = useState<Regression | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pageFailed, setPageFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const historyLock = useRef(false);
  const selected = versions.find((version) => version.id === selectedId) ?? null;

  useEffect(() => {
    mounted.current = true;
    void loadPage(null, false);
    return () => { mounted.current = false; requestSequence.current += 1; };
    // Initial load is intentionally once per mounted owner panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPage(cursor: string | null, append: boolean) {
    if (historyLock.current) return;
    historyLock.current = true;
    const requestId = ++requestSequence.current;
    setLoadingHistory(true);
    setPageFailed(false);
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const response = await requestResponse(`/api/riwi/owner/assessment-policies?${query.toString()}`, { method: "GET", headers: { Accept: "application/json" } });
      if (!response || !mounted.current || requestSequence.current !== requestId) return;
      if (response.status === 401 || response.status === 403) { setVersions([]); setNextCursor(null); setVersionCount(0); setError(text.error); return; }
      const parsed = pageSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) { setPageFailed(true); setError(text.error); return; }
      setVersions((current) => append ? appendUnique(current, parsed.data.versions) : parsed.data.versions);
      setNextCursor(parsed.data.nextCursor);
      setVersionCount(parsed.data.versionCount);
      setError("");
    } catch {
      if (mounted.current && requestSequence.current === requestId) { setPageFailed(true); setError(text.error); }
    } finally {
      historyLock.current = false;
      if (mounted.current && requestSequence.current === requestId) setLoadingHistory(false);
    }
  }

  async function submitCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim()) return;
    setBusy(true); setError(""); setNotice(""); setRegression(null);
    try {
      const response = await requestResponse("/api/riwi/owner/assessment-policies", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ message }),
      });
      if (!response || !mounted.current) return;
      const body = await response.json().catch(() => null);
      const parsed = candidateSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        setError(text.error);
        return;
      }
      setVersions((current) => [parsed.data.candidate, ...current.filter((item) => item.id !== parsed.data.candidate.id)]);
      setSelectedId(parsed.data.candidate.id);
      setMessage("");
      setNotice(parsed.data.replay ? text.replay : text.regressionNeeded);
    } catch { if (mounted.current) setError(text.error); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function previewSelected() {
    if (!selected || busy || selected.state !== "candidate") return;
    setBusy(true); setError(""); setNotice(""); setRegression(null);
    try {
      const response = await requestResponse(`/api/riwi/owner/assessment-policies/${selected.id}/preview`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}",
      });
      if (!response || !mounted.current) return;
      const parsed = previewSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) { setError(text.error); return; }
      setRegression(parsed.data.regression);
      setVersions((current) => current.map((item) => item.id === parsed.data.candidate.id ? parsed.data.candidate : item));
      setNotice(parsed.data.regression.passed ? text.confirmed : text.error);
    } catch { if (mounted.current) setError(text.error); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function approveSelected() {
    if (!selected || busy || selected.state !== "candidate" || !regression?.passed || regression.evidenceHash !== selected.regressionEvidenceHash) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await requestResponse(`/api/riwi/owner/assessment-policies/${selected.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ confirmRegression: true }),
      });
      if (!response || !mounted.current) return;
      const parsed = approveSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !parsed.success) { setError(text.error); return; }
      setVersions((current) => [parsed.data.candidate, ...current.filter((item) => item.id !== parsed.data.candidate.id).map((item) => item.policyId === parsed.data.candidate.policyId && item.active ? { ...item, active: false, state: "superseded" as const } : item)]);
      setRegression(null);
      setNotice(parsed.data.replay ? text.replay : text.active);
    } catch { if (mounted.current) setError(text.error); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function rejectSelected() {
    if (!selected || busy || selected.state !== "candidate") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await requestResponse(`/api/riwi/owner/assessment-policies/${selected.id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ reason: "Owner rejected during explicit assessment-policy review." }),
      });
      if (!response || !mounted.current) return;
      if (!response.ok) { setError(text.error); return; }
      setVersions((current) => current.map((item) => item.id === selected.id ? { ...item, state: "rejected", active: false, reviewedByUserId: item.reviewedByUserId } : item));
      setRegression(null); setNotice(text.rejected);
    } catch { if (mounted.current) setError(text.error); }
    finally { if (mounted.current) setBusy(false); }
  }

  function selectVersion(version: PolicyVersion) {
    setSelectedId(version.id);
    // A fresh preview is required in this UI session so the owner sees the
    // actual current invariant checks before the separate approval action.
    setRegression(null);
    setNotice(""); setError("");
  }

  return (
    <section className="rounded-2xl border border-signal-200 bg-white p-5 shadow-card" aria-labelledby="assessment-policy-title" data-owner-assessment-policy>
      <div>
        <h2 id="assessment-policy-title" className="font-display text-lg font-semibold text-ink-900">{text.title}</h2>
        <p className="mt-1 max-w-4xl text-sm text-ink-500">{text.intro}</p>
        <p className="mt-2 rounded-lg bg-signal-50 px-3 py-2 text-xs font-medium text-signal-800">{text.workflow}</p>
      </div>
      <form onSubmit={submitCandidate} className="mt-4 flex flex-col gap-3">
        <label htmlFor="assessment-policy-message" className="text-sm font-medium text-ink-700">{text.policyLabel}</label>
        <textarea id="assessment-policy-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={3} placeholder={text.placeholder} className="w-full rounded-xl border border-ink-200 bg-white p-3 text-sm text-ink-900 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !message.trim()} className="rounded-lg bg-signal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? text.creating : text.create}</button>
          <span className="self-center text-xs text-ink-500">{message.length}/2000</span>
        </div>
      </form>
      {(error || notice) && <p className={`mt-3 rounded-lg p-3 text-sm ${error ? "bg-band-bad/10 text-band-bad" : "bg-band-good/10 text-band-good"}`} role="status">{error || notice}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <h3 className="font-semibold text-ink-800">{text.history} <span className="text-xs font-normal text-ink-500">({versionCount})</span></h3>
          {loadingHistory && versions.length === 0 && <p className="mt-3 text-sm text-ink-500">{text.loading}</p>}
          {!loadingHistory && versions.length === 0 && !pageFailed && <p className="mt-3 text-sm text-ink-500">{text.empty}</p>}
          <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto" aria-label={text.history}>
            {versions.map((version) => (
              <li key={version.id}>
                <button type="button" onClick={() => selectVersion(version)} aria-current={selectedId === version.id ? "true" : undefined} className={`w-full rounded-xl border p-3 text-left ${selectedId === version.id ? "border-signal-600 bg-signal-50" : "border-ink-100 hover:bg-ink-50"}`}>
                  <span className="block truncate text-sm font-medium text-ink-900">{version.scope}</span>
                  <span className="mt-1 block text-xs text-ink-500">{text.version} {version.version} · {version.state}{version.active ? ` · ${text.active}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {pageFailed && <p className="mt-2 text-sm text-band-bad" role="alert">{text.error}</p>}
          {nextCursor && <button type="button" disabled={loadingHistory} onClick={() => void loadPage(nextCursor, true)} className="mt-3 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 disabled:opacity-50">{loadingHistory ? text.loading : text.loadMore}</button>}
        </div>

        <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-4">
          {!selected && <p className="text-sm text-ink-500">{text.selectVersion}</p>}
          {selected && <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink-900">{selected.scope} · v{selected.version}</h3>
                <p className="mt-1 text-xs text-ink-500">{text.state}: {selected.state}{selected.active ? ` · ${text.active}` : ""}</p>
              </div>
              {selected.state === "candidate" && <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void previewSelected()} className="rounded-lg border border-signal-600 px-3 py-2 text-sm font-medium text-signal-800 disabled:opacity-50">{busy ? text.previewing : text.preview}</button>
                <button type="button" disabled={busy || !regression?.passed || regression.evidenceHash !== selected.regressionEvidenceHash} onClick={() => void approveSelected()} className="rounded-lg bg-band-good px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? text.approving : text.approve}</button>
                <button type="button" disabled={busy} onClick={() => void rejectSelected()} className="rounded-lg border border-band-bad/40 px-3 py-2 text-sm text-band-bad disabled:opacity-50">{text.reject}</button>
              </div>}
            </div>
            <dl className="mt-4 space-y-2 text-xs text-ink-600">
              <div><dt className="inline font-semibold">{text.hash}: </dt><dd className="inline break-all font-mono">{selected.sourceMessageHash}</dd></div>
              <div><dt className="inline font-semibold">{text.scope}: </dt><dd className="inline">{selected.scope}</dd></div>
            </dl>
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-white p-3 text-xs text-ink-700">{JSON.stringify(selected.overlay, null, 2)}</pre>
            {regression && <div className="mt-4 rounded-lg border border-band-good/30 bg-white p-3">
              <p className="text-sm font-semibold text-ink-900">{text.checks}: {regression.passed ? text.passed : text.failed}</p>
              {regression.affectedTaskKeys.length > 0 && <p className="mt-2 text-xs text-ink-600"><strong>{text.keys}: </strong>{regression.affectedTaskKeys.join(", ")}</p>}
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {Object.entries(regression.checks).map(([name, passed]) => <li key={name} className={`text-xs ${passed ? "text-band-good" : "text-band-bad"}`}>{passed ? "✓" : "×"} {name}</li>)}
              </ul>
              {regression.evidenceHash && <p className="mt-2 break-all font-mono text-[10px] text-ink-400">SHA-256 {regression.evidenceHash}</p>}
            </div>}
          </>}
        </div>
      </div>
    </section>
  );
}
