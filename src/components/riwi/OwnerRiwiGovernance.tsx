"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
import type { Locale } from "@/lib/i18n";

const sourceSchema = z.object({
  id: z.string().uuid(), sourceType: z.string().max(60), title: z.string().max(200),
  provenance: z.string().max(500), rightsClass: z.string().max(40), authority: z.number().int().min(0).max(100),
  scope: z.enum(["global", "role", "user"]), scopeRole: z.string().nullable(), scopeUserId: z.string().uuid().nullable(),
  supersedesSourceId: z.string().uuid().nullable(), version: z.number().int().positive(),
  state: z.enum(["draft", "parsed", "analyzed", "candidate", "approved", "active", "superseded", "rejected", "quarantined"]),
  unitCount: z.number().int().nonnegative(), checksum: z.string().regex(/^[a-f0-9]{64}$/i), parserVersion: z.string().max(80),
  regressionFixtureId: z.string().max(120).nullable(), regressionEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  regressionPassedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), approvedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
}).strip();
const conflictSchema = z.object({
  id: z.string().uuid(), state: z.enum(["open", "resolved", "accepted", "rejected"]), reason: z.string().max(1000),
  candidateText: z.string().max(1600), candidateHeading: z.string().max(240).nullable(), activeTitle: z.string().max(200),
  activeVersion: z.number().int().positive(), activeSourceId: z.string().uuid(), activeUnitId: z.string().uuid(),
}).strip();
const unitSchema = z.object({
  id: z.string().uuid(), ordinal: z.number().int().nonnegative(), heading: z.string().max(240).nullable(),
  content: z.string().max(1600), contentHash: z.string().regex(/^[a-f0-9]{64}$/i), characterCount: z.number().int().nonnegative(),
}).strip();
const sourceDetailSchema = sourceSchema.extend({
  createdByUserId: z.string().uuid().nullable(), reviewedByUserId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime(), regressionFixtureId: z.string().max(120).nullable(),
  units: z.array(unitSchema).max(200), conflicts: z.array(conflictSchema).max(500),
}).strip();
const sourceListResponseSchema = z.object({ ok: z.literal(true), sources: z.array(sourceSchema).max(200), openConflicts: z.number().int().nonnegative() }).strip();
const sourceDetailResponseSchema = z.object({ ok: z.literal(true), source: sourceDetailSchema }).strip();
const signalSchema = z.object({
  id: z.string().uuid(), type: z.string().max(40), state: z.string().max(24), actorRole: z.string().max(20),
  sourceId: z.string().uuid(), providerId: z.string().max(40).nullable(), model: z.string().max(100).nullable(),
  promptVersion: z.string().max(60).nullable(), rubricVersion: z.string().max(60).nullable(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/i), scope: z.enum(["global", "user"]), createdAt: z.string().datetime(),
}).strip();
const signalListResponseSchema = z.object({ signals: z.array(signalSchema).max(200) }).strip();
const reviewSchema = z.object({
  id: z.string().uuid(), reviewerUserId: z.string().uuid(), decision: z.enum(["approve", "reject", "request_changes"]),
  reason: z.string().max(1000), regressionFixtureId: z.string().max(120).nullable(),
  regressionEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(), regressionPassedAt: z.string().datetime().nullable(),
  resultingSourceId: z.string().uuid().nullable(), createdAt: z.string().datetime(),
}).strip();
const signalDetailResponseSchema = z.object({
  signal: z.object({
    id: z.string().uuid(), signalType: z.string().max(40), state: z.string().max(24), candidateClaim: z.string().max(4000),
    evidenceSummary: z.string().max(1200), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/i), sourceId: z.string().uuid(),
    providerId: z.string().max(40).nullable(), model: z.string().max(100).nullable(), promptVersion: z.string().max(60).nullable(),
    rubricVersion: z.string().max(60).nullable(), actorRole: z.string().max(20), scope: z.enum(["global", "user"]),
    createdAt: z.string().datetime(),
  }).strip(),
  reviews: z.array(reviewSchema).max(100),
}).strip();
const auditEntrySchema = z.object({
  id: z.string().uuid(), actorUserId: z.string().uuid().nullable(), action: z.string().max(80), targetType: z.string().max(80).nullable(),
  targetId: z.string().max(80).nullable(), metadata: z.record(z.unknown()).nullable(), createdAt: z.string().datetime(),
}).strip();
const auditResponseSchema = z.object({ ok: z.literal(true), entries: z.array(auditEntrySchema).max(100) }).strip();
const diagnosticsSchema = z.object({
  ok: z.literal(true),
  rollout: z.object({ roles: z.record(z.boolean()), providerLab: z.boolean(), externalAi: z.boolean() }).strip(),
  providerReadiness: z.array(z.object({
    id: z.string().max(40), displayName: z.string().max(100), type: z.enum(["internal", "external"]),
    capabilities: z.array(z.string().max(80)).max(50), credentialConfigured: z.boolean(), missingSecretNames: z.array(z.string().max(100)).max(20),
  }).strip()).max(50),
  aiPolicy: z.object({
    deploymentCeiling: z.boolean(), ownerSwitch: z.boolean(), configuredPrimaryProvider: z.string().max(40).nullable(),
    configuredModel: z.string().max(100).nullable(), effectivePrimaryProvider: z.string().max(40), effectiveModel: z.string().max(100).nullable(),
    fallback: z.enum(["riwi", "none"]), enabled: z.boolean(), ready: z.boolean(),
  }).strip(),
  effectiveProvider: z.object({ enabled: z.boolean(), providerId: z.string().max(40), external: z.boolean(), ready: z.boolean() }).strip(),
  configIssues: z.array(z.object({ index: z.number().int().nonnegative(), reason: z.string().max(120) }).strip()).max(50),
  governance: z.object({ openConflicts: z.number().int().nonnegative(), pendingKnowledgeCandidates: z.number().int().nonnegative(), approvedKnowledgeSources: z.number().int().nonnegative(), pendingLearningReviews: z.number().int().nonnegative() }).strip(),
  safety: z.object({ arbitraryEndpointsAccepted: z.literal(false), rawSecretsReturned: z.literal(false), sourceTextShownOnlyToOwner: z.literal(true), providerAgreementMeansTruth: z.literal(false), automaticActivationOfUnverifiedKnowledge: z.literal(false) }).strip(),
}).strip();

const sourceTypes = [
  "owner_instruction", "ielts_rubric", "grammar_material", "vocabulary_material", "speaking_material", "writing_material",
  "dictionary_material", "learning_methodology", "course_document", "policy", "verified_example", "provider_evaluation",
  "teacher_correction", "owner_correction", "regression_fixture",
] as const;
const rightsClasses = ["unknown", "owner_authored", "licensed", "public_domain", "internal_permission", "third_party_reference"] as const;
const roleScopes = ["student", "teacher", "admin", "owner"] as const;
const regressionFixture = "retrieval-active-scope-only-v1";

function words(locale: Locale) {
  const uz = locale === "uz";
  return {
    governance: uz ? "Bilim va o'rganish boshqaruvi" : "Knowledge and learning governance",
    intro: uz ? "Yuklangan matn faqat nomzod bilim bo'ladi. U faqat egasi ko'rib chiqib, tasdiqlab va regressiya tekshiruvidan keyin faollashtiriladi." : "Uploaded material becomes candidate knowledge only. It is not active until an owner reviews, approves, and promotes it after regression checks.",
    providers: uz ? "Provayder boshqaruvi" : "Provider governance",
    upload: uz ? "Bilim manbasini ro'yxatdan o'tkazish" : "Register a knowledge source",
    file: uz ? "Manba fayli" : "Source file",
    title: uz ? "Manba nomi" : "Source title",
    provenance: uz ? "Haqiqiy manba va kelib chiqishi" : "Truthful provenance",
    sourceType: uz ? "Manba turi" : "Source type",
    rights: uz ? "Huquq klassi" : "Rights class",
    scope: uz ? "Ruxsat etilgan ko'lam" : "Allowed scope",
    allRoles: uz ? "Umumiy" : "Global",
    role: uz ? "Rol bo'yicha" : "Role scoped",
    register: uz ? "Tahlil qilish va nomzod sifatida ro'yxatdan o'tkazish" : "Parse, analyze, and register candidate",
    noActive: uz ? "Ro'yxatdan o'tkazish manbani faollashtirmaydi." : "Registration does not activate the source.",
    loading: uz ? "Yuklanmoqda…" : "Loading…",
    refresh: uz ? "Yangilash" : "Refresh",
    sources: uz ? "Bilim manbalari va versiyalar" : "Knowledge sources and versions",
    signals: uz ? "O'rganish signallari va tuzatishlar" : "Learning signals and corrections",
    audit: uz ? "Audit va dalillar" : "Audit and evidence",
    diagnostics: uz ? "Xavfsiz diagnostika" : "Safe diagnostics",
    details: uz ? "Batafsil ko'rish" : "Inspect details",
    review: uz ? "Ko'rib chiqish sababi" : "Review reason",
    approve: uz ? "Tasdiqlash" : "Approve",
    reject: uz ? "Rad etish" : "Reject",
    promote: uz ? "Regressiya tekshiruvi bilan faollashtirish" : "Promote with regression check",
    keep: uz ? "Faol manbani saqlash (nomzodni rad etadi)" : "Keep active (rejects the candidate)",
    accept: uz ? "Nomzodni qabul qilish — faol holat emas" : "Accept candidate (not active)",
    changes: uz ? "Tuzatish so'rash" : "Request changes",
    acceptSignal: uz ? "Dalilni qabul qilish va regressiyani tekshirish" : "Accept evidence and run regression",
    materialize: uz ? "Tasdiqlangan tuzatishdan nomzod yaratish" : "Materialize accepted correction as candidate",
    providerOnly: uz ? "Provayder kelishuvi faqat dalildir: bu haqiqat yoki avtomatik o'qitish emas." : "Provider agreement is evidence only—not truth and not automatic training.",
    noSources: uz ? "Bilim manbalari topilmadi." : "No knowledge sources found.",
    noSignals: uz ? "Ko'rib chiqiladigan signallar topilmadi." : "No learning signals to review.",
    noAudit: uz ? "Audit yozuvlari topilmadi." : "No audit entries found.",
    unsupported: uz ? "Qo'llab-quvvatlanadigan fayllar: TXT, MD, HTML, PDF va DOCX. Skriptlar va makroslar bajarilmaydi." : "Supported files: TXT, MD, HTML, PDF, and DOCX. Scripts and macros are never executed.",
    privateText: uz ? "Fayl mazmuni RIWI tizim ko'rsatmalarini, ruxsatlarini yoki xavfsizlik siyosatini o'zgartira olmaydi." : "File content is inert data and cannot change RIWI system instructions, permissions, or security policy.",
    configuredOnly: uz ? "Sozlangan; muvaffaqiyatli jonli sinov tarixi ko'rsatilmagan." : "Configured; no successful live test appears in retained history.",
    error: uz ? "Amal xavfsiz bajarilmadi. Qayta urinib ko'ring." : "The action could not be completed safely. Please retry.",
    saved: uz ? "Saqlangan." : "Saved.",
  };
}

type Source = z.infer<typeof sourceSchema>;
type Detail = z.infer<typeof sourceDetailSchema>;
type Signal = z.infer<typeof signalSchema>;
type SignalDetail = z.infer<typeof signalDetailResponseSchema>;
type AuditEntry = z.infer<typeof auditEntrySchema>;
type Diagnostics = z.infer<typeof diagnosticsSchema>;

export function OwnerRiwiGovernance({ locale }: { locale: Locale }) {
  const t = words(locale);
  const requestResponse = useScopedResponse(35_000);
  const [sources, setSources] = useState<Source[]>([]);
  const [openConflicts, setOpenConflicts] = useState(0);
  const [selectedSource, setSelectedSource] = useState<Detail | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<SignalDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [provenance, setProvenance] = useState("");
  const [sourceType, setSourceType] = useState<(typeof sourceTypes)[number]>("owner_instruction");
  const [rightsClass, setRightsClass] = useState<(typeof rightsClasses)[number]>("unknown");
  const [scopeKind, setScopeKind] = useState<"global" | "role">("global");
  const [scopeRole, setScopeRole] = useState<(typeof roleScopes)[number]>("student");
  const [sourceReason, setSourceReason] = useState("");
  const [signalReason, setSignalReason] = useState("");
  const [signalType, setSignalType] = useState<"owner_correction" | "manual_qa_finding">("owner_correction");
  const [signalClaim, setSignalClaim] = useState("");
  const [signalEvidence, setSignalEvidence] = useState("");
  const correctionKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const fetchJson = useCallback(async <T,>(path: string, schema: z.ZodType<T>): Promise<T | null> => {
    const response = await requestResponse(path, { method: "GET", headers: { Accept: "application/json" } });
    if (!response) return null;
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) throw new Error("request_failed");
    return parsed.data;
  }, [requestResponse]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      // useScopedResponse intentionally supersedes an older in-flight request.
      // Load distinct scopes sequentially so they do not cancel one another.
      const sourceData = await fetchJson("/api/riwi/owner/knowledge", sourceListResponseSchema).catch(() => null);
      const signalData = await fetchJson("/api/riwi/learning-signals?limit=100", signalListResponseSchema).catch(() => null);
      const auditData = await fetchJson("/api/riwi/owner/audit?limit=30", auditResponseSchema).catch(() => null);
      const diagnosticData = await fetchJson("/api/riwi/owner/diagnostics", diagnosticsSchema).catch(() => null);
      if (sourceData) { setSources(sourceData.sources); setOpenConflicts(sourceData.openConflicts); }
      if (signalData) setSignals(signalData.signals);
      if (auditData) setAudit(auditData.entries);
      if (diagnosticData) setDiagnostics(diagnosticData);
      if (!sourceData || !signalData || !auditData || !diagnosticData) setError(t.error);
    } catch {
      setError(t.error);
    } finally {
      setRefreshing(false);
    }
  }, [fetchJson, t.error]);

  const loadSource = useCallback(async (id: string) => {
    const result = await fetchJson(`/api/riwi/owner/knowledge/${id}`, sourceDetailResponseSchema);
    if (result) setSelectedSource(result.source);
  }, [fetchJson]);

  const loadSignal = useCallback(async (id: string) => {
    const result = await fetchJson(`/api/riwi/learning-signals/${id}`, signalDetailResponseSchema);
    if (result) setSelectedSignal(result);
  }, [fetchJson]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function post(path: string, body: unknown, successText = t.saved) {
    setBusy(path);
    setError("");
    setNotice("");
    try {
      const response = await requestResponse(path, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body),
      });
      if (!response) return false;
      const result = await response.json().catch(() => null) as { error?: { code?: string } } | null;
      if (!response.ok || !result || typeof result !== "object") throw new Error("request_failed");
      setNotice(successText);
      await refresh();
      return true;
    } catch {
      setError(t.error);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function uploadSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size < 1 || file.size > 20 * 1024 * 1024) { setError(t.error); return; }
    setBusy("upload");
    setError("");
    setNotice("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const batch = 0x8000;
      for (let index = 0; index < bytes.length; index += batch) {
        binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + batch, bytes.length)));
      }
      const contentBase64 = btoa(binary);
      const scope = scopeKind === "global" ? { kind: "global" as const } : { kind: "role" as const, role: scopeRole };
      const response = await requestResponse("/api/riwi/owner/knowledge", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ filename: file.name, title, sourceType, provenance, rightsClass, scope, contentBase64 }),
      });
      if (!response) return;
      const data = await response.json().catch(() => null) as { sourceId?: string; error?: { code?: string } } | null;
      if (!response.ok || !data?.sourceId) throw new Error("request_failed");
      setNotice(locale === "uz" ? "Manba tahlil qilindi va nomzod sifatida saqlandi; faol emas." : "The source was parsed, analyzed, and saved as a candidate; it is not active.");
      setFile(null);
      setTitle("");
      setProvenance("");
      await refresh();
      await loadSource(data.sourceId);
    } catch {
      setError(t.error);
    } finally {
      setBusy("");
    }
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !signalClaim.trim() || !signalEvidence.trim()) return;
    const fingerprint = `${signalType}:${signalClaim.trim()}:${signalEvidence.trim()}`;
    const key = correctionKey.current?.fingerprint === fingerprint ? correctionKey.current.key : crypto.randomUUID();
    correctionKey.current = { fingerprint, key };
    const ok = await post("/api/riwi/learning-signals", {
      type: signalType, idempotencyKey: key, candidateClaim: signalClaim.trim(), evidenceSummary: signalEvidence.trim(),
    }, locale === "uz" ? "Tuzatish ko'rib chiqish uchun yuborildi; hali faol emas." : "Correction submitted for review; it is not active knowledge.");
    if (ok) {
      correctionKey.current = null;
      setSignalClaim("");
      setSignalEvidence("");
    }
  }

  async function resolveConflict(conflictId: string, decision: "accept_candidate" | "keep_active") {
    if (!selectedSource || !sourceReason.trim()) return;
    const prompt = decision === "keep_active"
      ? (locale === "uz" ? "Faol manba saqlanadi va butun nomzod rad etiladi. Davom etilsinmi?" : "Keep the active source and reject the entire candidate? Continue?")
      : (locale === "uz" ? "Nomzod ko'rib chiqishga qabul qilinadi, ammo faollashmaydi. Davom etilsinmi?" : "Accept this candidate for review; it will not become active. Continue?");
    if (!window.confirm(prompt)) return;
    const ok = await post(`/api/riwi/owner/knowledge/${selectedSource.id}/conflicts/${conflictId}`, {
      decision, expectedSourceId: selectedSource.id, reason: sourceReason,
    }, locale === "uz" ? "Ziddiyat qarori audit qilindi." : "Conflict decision recorded in the audit trail.");
    if (ok) { setSourceReason(""); await loadSource(selectedSource.id); }
  }

  async function reviewSignal(decision: "approve" | "reject" | "request_changes") {
    const signal = selectedSignal?.signal;
    if (!signal || !signalReason.trim()) return;
    const ok = await post(`/api/riwi/learning-signals/${signal.id}/review`, {
      decision, reason: signalReason, ...(decision === "approve" ? { regressionFixtureId: regressionFixture } : {}),
    }, locale === "uz" ? "Ko'rib chiqish auditi saqlandi." : "Learning review recorded in the audit trail.");
    if (ok) { setSignalReason(""); await loadSignal(signal.id); }
  }

  async function materializeSignal() {
    const signal = selectedSignal?.signal;
    if (!signal || busy) return;
    const path = `/api/riwi/learning-signals/${signal.id}/knowledge`;
    setBusy(path);
    setError("");
    setNotice("");
    try {
      const response = await requestResponse(path, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({}),
      });
      if (!response) return;
      const data = await response.json().catch(() => null) as { sourceId?: string } | null;
      if (!response.ok || !data?.sourceId) throw new Error("request_failed");
      setNotice(locale === "uz" ? "Tuzatish nomzod bilim manbasiga aylantirildi." : "Correction materialized as candidate knowledge.");
      await refresh();
      await loadSignal(signal.id);
      await loadSource(data.sourceId);
    } catch {
      setError(t.error);
    } finally {
      setBusy("");
    }
  }

  async function promoteSource() {
    if (!selectedSource) return;
    if (!window.confirm(locale === "uz"
      ? "Deterministik regressiya testlari bajariladi; muvaffaqiyatli bo'lsa, oldingi versiya superseded bo'lishi mumkin. Faollashtirishni davom ettirasizmi?"
      : "Deterministic regression checks will run; on success an older version may be superseded. Continue with promotion?")) return;
    const accepted = [...new Set(selectedSource.conflicts.filter((conflict) => conflict.state === "accepted").map((conflict) => conflict.activeSourceId))];
    const priorId = accepted.length === 1 ? accepted[0] : undefined;
    const prior = priorId ? sources.find((source) => source.id === priorId) : undefined;
    if (accepted.length > 1) { setError(locale === "uz" ? "Bir nechta faol manba qabul qilingan; versiyalarni alohida ko'rib chiqing." : "Multiple active sources were accepted; review their versions separately."); return; }
    if (priorId && !prior) { setError(t.error); return; }
    if (selectedSource.rightsClass === "unknown" || selectedSource.rightsClass === "third_party_reference") {
      setError(locale === "uz" ? "Huquq klassi faollashtirish uchun mos emas." : "This rights class is not eligible for promotion."); return;
    }
    const ok = await post(`/api/riwi/owner/knowledge/${selectedSource.id}/promote`, {
      regressionFixtureId: regressionFixture,
      expectedVersion: selectedSource.version,
      ...(prior ? { supersedesSourceId: prior.id, expectedSupersedesVersion: prior.version } : {}),
      ...(sourceReason.trim() ? { reason: sourceReason.trim() } : {}),
    }, locale === "uz" ? "Regressiya tekshirildi va yangi versiya faollashtirildi." : "Regression checks passed and the new version was activated.");
    if (ok) await loadSource(selectedSource.id);
  }

  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const eligibleMaterialization = selectedSignal && ["owner_correction", "teacher_correction", "manual_qa_finding"].includes(selectedSignal.signal.signalType);
  const acceptedReview = selectedSignal?.signal.state === "accepted" && selectedSignal.reviews.some((review) => review.decision === "approve");
  const sourceState = selectedSource?.state;

  return (
    <div className="flex flex-col gap-5" data-riwi-governance>
      <section className="card flex flex-col gap-4 p-5" aria-labelledby="riwi-governance-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="riwi-governance-title" className="font-display text-xl text-ink-900">{t.governance}</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-500">{t.intro}</p>
          </div>
          <button type="button" className="btn-secondary" disabled={refreshing || busy !== ""} onClick={() => void refresh()}>{refreshing ? t.loading : t.refresh}</button>
        </div>
        {error && <p className="rounded-xl bg-band-bad/10 p-3 text-sm text-band-bad" role="alert">{error}</p>}
        {notice && <p className="rounded-xl bg-band-good/10 p-3 text-sm text-band-good" role="status">{notice}</p>}
        {diagnostics && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={t.diagnostics}>
            <Readiness label={locale === "uz" ? "Tashqi AI" : "External AI"} value={diagnostics.effectiveProvider.enabled ? (diagnostics.effectiveProvider.ready ? (locale === "uz" ? "Tayyor" : "Ready") : (locale === "uz" ? "Sozlangan emas" : "Not ready")) : (locale === "uz" ? "O'chiq" : "Off")} />
            <Readiness label={locale === "uz" ? "Faol ziddiyatlar" : "Open conflicts"} value={String(openConflicts)} />
            <Readiness label={locale === "uz" ? "Nomzod manbalar" : "Candidate sources"} value={String(diagnostics.governance.pendingKnowledgeCandidates)} />
            <Readiness label={locale === "uz" ? "Kutilayotgan signallar" : "Pending learning reviews"} value={String(diagnostics.governance.pendingLearningReviews)} />
          </div>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-2" aria-labelledby="riwi-knowledge-upload-title">
        <form className="card flex flex-col gap-3 p-5" onSubmit={uploadSource}>
          <div>
            <h3 id="riwi-knowledge-upload-title" className="font-display text-lg text-ink-900">{t.upload}</h3>
            <p className="mt-1 text-xs leading-5 text-ink-500">{t.unsupported} {t.privateText}</p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">{t.file}
            <input type="file" required accept=".txt,.md,.html,.htm,.pdf,.docx" disabled={busy !== ""} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">{t.title}
            <input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy !== ""} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">{t.provenance}
            <input className="input" required maxLength={300} value={provenance} onChange={(event) => setProvenance(event.target.value)} disabled={busy !== ""} placeholder={locale === "uz" ? "Masalan: egasi yozgan; 2026-10-04" : "For example: owner-authored; 2026-10-04"} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">{t.sourceType}
              <select className="input" value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} disabled={busy !== ""}>
                {sourceTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-700">{t.rights}
              <select className="input" value={rightsClass} onChange={(event) => setRightsClass(event.target.value as typeof rightsClass)} disabled={busy !== ""}>
                {rightsClasses.map((rights) => <option key={rights} value={rights}>{rights.replaceAll("_", " ")}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-3 text-sm text-ink-700">
            <legend className="mb-1 font-medium">{t.scope}</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={scopeKind === "global"} onChange={() => setScopeKind("global")} />{t.allRoles}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={scopeKind === "role"} onChange={() => setScopeKind("role")} />{t.role}</label>
            {scopeKind === "role" && <select className="input max-w-48" value={scopeRole} onChange={(event) => setScopeRole(event.target.value as typeof scopeRole)}>{roleScopes.map((role) => <option key={role} value={role}>{role}</option>)}</select>}
          </fieldset>
          {file && <p className="text-xs text-ink-500">{file.name} · {Math.ceil(file.size / 1024)} KB · server validates file signature and parses content in an inert, bounded parser</p>}
          <button className="btn-primary self-start" type="submit" disabled={!file || !title.trim() || !provenance.trim() || busy !== ""}>{busy === "upload" ? t.loading : t.register}</button>
          <p className="text-xs text-ink-500">{t.noActive}</p>
        </form>

        <div className="card flex flex-col gap-3 p-5" aria-labelledby="riwi-provider-governance-title">
          <h3 id="riwi-provider-governance-title" className="font-display text-lg text-ink-900">{t.providers}</h3>
          {!diagnostics && <p className="text-sm text-ink-500">{refreshing ? t.loading : t.error}</p>}
          {diagnostics && <>
            <div className="grid gap-2 sm:grid-cols-2">
            <Readiness label={locale === "uz" ? "Joylashtirishning qattiq cheklovi" : "Deployment hard ceiling"} value={diagnostics.aiPolicy.deploymentCeiling ? "Enabled" : "Off"} />
            <Readiness label={locale === "uz" ? "Egasi tashqi AI kaliti" : "Owner external-AI switch"} value={diagnostics.aiPolicy.ownerSwitch ? "Enabled" : "Off"} />
            <Readiness label={locale === "uz" ? "Sozlangan asosiy provayder" : "Configured primary provider"} value={`${diagnostics.aiPolicy.configuredPrimaryProvider ?? "RIWI"}${diagnostics.aiPolicy.configuredModel ? ` · ${diagnostics.aiPolicy.configuredModel}` : ""}`} />
            <Readiness label={locale === "uz" ? "Amaldagi provayder" : "Effective provider"} value={`${diagnostics.aiPolicy.effectivePrimaryProvider} · ${diagnostics.aiPolicy.fallback} fallback`} />
            <Readiness label={locale === "uz" ? "Samarali tashqi AI" : "Effective external AI"} value={diagnostics.aiPolicy.enabled ? (diagnostics.aiPolicy.ready ? "Ready" : "Not ready") : "Off"} />
            <Readiness label={locale === "uz" ? "Provayder laboratoriyasi" : "Fixed-fixture lab"} value={diagnostics.rollout.providerLab ? "Enabled" : "Off"} />
            </div>
            <p className="text-xs text-ink-500">{t.configuredOnly} External provider live tests are represented only by the fixed-fixture experiment history above.</p>
            <ul className="flex flex-col gap-2">
              {diagnostics.providerReadiness.map((provider) => <li key={provider.id} className="rounded-xl border border-ink-100 p-3 text-xs">
                <p className="font-semibold text-ink-800">{provider.displayName} <span className="font-mono">({provider.id})</span></p>
                <p className="mt-1 text-ink-500">{provider.type} · {provider.credentialConfigured ? t.configuredOnly : (locale === "uz" ? "Kredensial sozlanmagan" : "Credential not configured")}</p>
                <p className="mt-1 text-ink-500">{locale === "uz" ? "Imkoniyatlar" : "Capabilities"}: {provider.capabilities.join(", ") || "—"}</p>
                {provider.missingSecretNames.length > 0 && <p className="mt-1 text-band-warn">{locale === "uz" ? "Yetishmayotgan muhit o'zgaruvchisi nomlari" : "Missing environment-variable names only"}: {provider.missingSecretNames.join(", ")}</p>}
              </li>)}
            </ul>
            {diagnostics.configIssues.length > 0 && <p className="text-xs text-band-warn">Configuration issues: {diagnostics.configIssues.map((issue) => `#${issue.index + 1} ${issue.reason}`).join("; ")}</p>}
            <p className="rounded-xl bg-paper-sunken p-3 text-xs text-ink-500">{t.providerOnly}</p>
          </>}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="card flex flex-col gap-3 p-5" aria-labelledby="riwi-source-list-title">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="riwi-source-list-title" className="font-display text-lg text-ink-900">{t.sources}</h3>
            <span className="badge bg-paper-sunken text-ink-600">{sources.length} · {openConflicts} {locale === "uz" ? "ochiq ziddiyat" : "open conflicts"}</span>
          </header>
          {sources.length === 0 && <p className="text-sm text-ink-500">{t.noSources}</p>}
          <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
            {sources.map((source) => <li key={source.id} className="rounded-xl border border-ink-100 p-3" data-knowledge-state={source.state}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-medium text-ink-900">{source.title}</p><p className="mt-1 text-xs text-ink-500">{source.sourceType.replaceAll("_", " ")} · v{source.version} · {source.scope === "role" ? source.scopeRole : source.scope}</p></div>
                <span className={`badge ${source.state === "active" ? "bg-band-good/10 text-band-good" : source.state === "rejected" || source.state === "quarantined" ? "bg-band-bad/10 text-band-bad" : "bg-band-warn/10 text-band-warn"}`}>{source.state}</span>
              </div>
              <p className="mt-2 text-xs text-ink-500">{source.rightsClass.replaceAll("_", " ")} · authority {source.authority} · {source.unitCount} units · parser {source.parserVersion}</p>
              <p className="mt-1 break-all text-[11px] text-ink-400">SHA-256 {source.checksum}</p>
              <button type="button" className="btn-secondary mt-3" disabled={busy !== ""} onClick={() => void loadSource(source.id)}>{t.details}</button>
            </li>)}
          </ul>
        </div>

        <div className="card flex flex-col gap-3 p-5" aria-labelledby="riwi-learning-signals-title">
          <h3 id="riwi-learning-signals-title" className="font-display text-lg text-ink-900">{t.signals}</h3>
          <p className="text-xs text-ink-500">{t.providerOnly} {locale === "uz" ? "O'qituvchi tuzatishlari faqat tayinlangan o'quvchi ko'lamida qoladi." : "Teacher corrections remain scoped to the assigned learner."}</p>
          <form className="flex flex-col gap-2 border-b border-ink-100 pb-4" onSubmit={submitCorrection}>
            <label className="text-sm font-medium text-ink-700">{locale === "uz" ? "Egasi tuzatishi / QA topilmasi" : "Owner correction / QA finding"}
              <select className="input mt-1" value={signalType} onChange={(event) => setSignalType(event.target.value as typeof signalType)} disabled={busy !== ""}>
                <option value="owner_correction">owner_correction · global owner evidence</option>
                <option value="manual_qa_finding">manual_qa_finding · review evidence</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink-700">{locale === "uz" ? "Tuzatish da'vosi" : "Correction claim"}
              <input className="input mt-1" required maxLength={1000} value={signalClaim} onChange={(event) => setSignalClaim(event.target.value)} disabled={busy !== ""} />
            </label>
            <label className="text-sm font-medium text-ink-700">{locale === "uz" ? "Xavfsiz dalil xulosasi" : "Safe evidence summary"}
              <textarea className="input mt-1 min-h-20" required maxLength={800} value={signalEvidence} onChange={(event) => setSignalEvidence(event.target.value)} disabled={busy !== ""} />
            </label>
            <p className="text-xs text-ink-500">{locale === "uz" ? "Bu signal; modelni o'qitmaydi va faol bilimni o'zgartirmaydi." : "This creates a learning signal only; it does not train a model or change active knowledge."}</p>
            <button className="btn-secondary self-start" disabled={busy !== "" || !signalClaim.trim() || !signalEvidence.trim()}>{locale === "uz" ? "Ko'rib chiqishga yuborish" : "Submit for review"}</button>
          </form>
          {signals.length === 0 && <p className="text-sm text-ink-500">{t.noSignals}</p>}
          <ul className="flex max-h-[24rem] flex-col gap-2 overflow-y-auto">
            {signals.map((signal) => <li key={signal.id} className="rounded-xl border border-ink-100 p-3" data-learning-state={signal.state}>
              <div className="flex items-start justify-between gap-2"><p className="font-medium text-ink-900">{signal.type.replaceAll("_", " ")}</p><span className="badge bg-paper-sunken text-ink-600">{signal.state}</span></div>
              <p className="mt-1 text-xs text-ink-500">{signal.actorRole} · {signal.scope === "global" ? "global" : "scoped learner"} · {new Date(signal.createdAt).toLocaleString()}</p>
              <p className="mt-1 text-xs text-ink-500">{signal.type.startsWith("provider_") ? t.providerOnly : `${locale === "uz" ? "Manba" : "Source"}: ${signal.sourceId}`}</p>
              <button type="button" className="btn-secondary mt-2" disabled={busy !== ""} onClick={() => void loadSignal(signal.id)}>{t.details}</button>
            </li>)}
          </ul>
        </div>
      </section>

      {selectedSource && (
        <section className="card flex flex-col gap-4 p-5" aria-labelledby="riwi-source-detail-title" data-source-detail={selectedSource.id}>
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 id="riwi-source-detail-title" className="font-display text-lg text-ink-900">{selectedSource.title} · v{selectedSource.version}</h3><p className="text-xs text-ink-500">{selectedSource.sourceType} · {selectedSource.state} · authority {selectedSource.authority} · {selectedSource.scope === "role" ? selectedSource.scopeRole : selectedSource.scope}</p></div>
            <button type="button" className="btn-secondary" onClick={() => setSelectedSource(null)}>{locale === "uz" ? "Yopish" : "Close"}</button>
          </header>
          <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <Meta label={locale === "uz" ? "Kelib chiqishi" : "Provenance"} value={selectedSource.provenance} />
            <Meta label={locale === "uz" ? "Huquq klassi" : "Rights class"} value={selectedSource.rightsClass} />
            <Meta label={locale === "uz" ? "Parser" : "Parser version"} value={selectedSource.parserVersion} />
            <Meta label={locale === "uz" ? "Birliklar" : "Units"} value={String(selectedSource.unitCount)} />
            <Meta label="SHA-256" value={selectedSource.checksum} />
            <Meta label={locale === "uz" ? "Regressiya" : "Regression evidence"} value={selectedSource.regressionFixtureId ? `${selectedSource.regressionFixtureId} · ${selectedSource.regressionEvidenceHash ?? "—"}` : (locale === "uz" ? "hali bajarilmagan" : "not run yet")} />
            <Meta label={locale === "uz" ? "Oldingi manba" : "Supersedes"} value={selectedSource.supersedesSourceId ? `${selectedSource.supersedesSourceId} · v${sourceMap.get(selectedSource.supersedesSourceId)?.version ?? "?"}` : "—"} />
          </dl>
          <p className="text-xs text-ink-500">{locale === "uz" ? "Yuklangan matn faqat inert ma'lumot. U hech qachon tizim ko'rsatmalari yoki vosita ruxsatlarini o'zgartirmaydi." : "Uploaded text is inert data; it cannot override system instructions or tool permissions."}</p>
          <div className="grid gap-2 md:grid-cols-2">
            {selectedSource.units.map((unit) => <article key={unit.id} className="rounded-xl border border-ink-100 p-3" data-source-content="inert">
              <p className="text-xs font-semibold text-ink-500">#{unit.ordinal + 1}{unit.heading ? ` · ${unit.heading}` : ""} · {unit.characterCount} chars</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{unit.content}</p>
              <p className="mt-1 break-all text-[10px] text-ink-300">{unit.contentHash}</p>
            </article>)}
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="font-semibold text-ink-800">{locale === "uz" ? "Ziddiyatlarni qo'lda ko'rib chiqish" : "Manual conflict review"}</h4>
            {selectedSource.conflicts.length === 0 && <p className="text-sm text-ink-500">{locale === "uz" ? "Ochiq leksik ziddiyat topilmadi." : "No lexical overlap conflicts were found."}</p>}
            {selectedSource.conflicts.map((conflict) => <article key={conflict.id} className="rounded-xl border border-ink-100 p-4" data-conflict-state={conflict.state}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-ink-800">{conflict.activeTitle} · v{conflict.activeVersion}</p><span className="badge bg-paper-sunken text-ink-600">{conflict.state}</span></div>
              <p className="mt-1 text-xs text-ink-500">{locale === "uz" ? "Amaldagi manba" : "Active source"}: {conflict.activeSourceId} · {conflict.reason}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2"><TextExcerpt label={locale === "uz" ? "Nomzod matni" : "Candidate excerpt"} value={conflict.candidateText} /><TextExcerpt label={locale === "uz" ? "Faol sarlavha" : "Active title"} value={conflict.activeTitle} /></div>
              {conflict.state === "open" && <div className="mt-3 flex flex-col gap-2">
                <label className="text-xs font-medium text-ink-700">{t.review}<textarea className="input mt-1 min-h-16" maxLength={1000} value={sourceReason} onChange={(event) => setSourceReason(event.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={busy !== "" || !sourceReason.trim()} onClick={() => void resolveConflict(conflict.id, "accept_candidate")}>{t.accept}</button>
                  <button type="button" className="btn-secondary" disabled={busy !== "" || !sourceReason.trim()} onClick={() => void resolveConflict(conflict.id, "keep_active")}>{t.keep}</button>
                </div>
              </div>}
            </article>)}
          </div>
          {sourceState === "candidate" && <div className="flex flex-col gap-3 border-t border-ink-100 pt-4">
            <p className="text-sm text-ink-600">{locale === "uz" ? "Nomzod faol emas. Huquq holati, ziddiyatlar va manba ma'lumotlarini tekshiring." : "Candidate is not active. Review rights, conflicts, and source metadata before approval."}</p>
            <label className="text-xs font-medium text-ink-700">{t.review}<textarea className="input mt-1 min-h-16" maxLength={1000} value={sourceReason} onChange={(event) => setSourceReason(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy !== "" || selectedSource.rightsClass === "unknown" || selectedSource.rightsClass === "third_party_reference" || selectedSource.conflicts.some((conflict) => conflict.state === "open")} onClick={async () => { if (!sourceReason.trim()) { setError(t.error); return; } if (window.confirm(locale === "uz" ? "Manbani tasdiqlash; u hali faollashmaydi. Davom etilsinmi?" : "Approve this candidate? Approval does not activate it. Continue?")) { const ok = await post(`/api/riwi/owner/knowledge/${selectedSource.id}/approve`, { reason: sourceReason }); if (ok) await loadSource(selectedSource.id); } }}>{t.approve}</button>
              <button type="button" className="btn-secondary" disabled={busy !== "" || !sourceReason.trim()} onClick={async () => { if (window.confirm(locale === "uz" ? "Butun nomzodni rad etasizmi?" : "Reject this entire candidate?")) { const ok = await post(`/api/riwi/owner/knowledge/${selectedSource.id}/reject`, { reason: sourceReason }); if (ok) await loadSource(selectedSource.id); } }}>{t.reject}</button>
            </div>
          </div>}
          {sourceState === "approved" && <div className="flex flex-col gap-3 border-t border-ink-100 pt-4">
            <p className="text-sm text-ink-600">{locale === "uz" ? "Tasdiqlandi, lekin faol emas. Faollashtirishda deterministik bilim regressiya to'plami serverda bajariladi." : "Approved, not active. Promotion runs the deterministic knowledge regression suite on the server."}</p>
            <label className="text-xs font-medium text-ink-700">{t.review}<textarea className="input mt-1 min-h-16" maxLength={1000} value={sourceReason} onChange={(event) => setSourceReason(event.target.value)} /></label>
            <p className="text-xs text-ink-500">{locale === "uz" ? `Regressiya to'plami: ${regressionFixture}. Qabul qilingan ziddiyat uchun aynan tegishli faol versiya superseded bo'ladi.` : `Regression fixture: ${regressionFixture}. An accepted conflict requires superseding its exact active version.`}</p>
            <button type="button" className="btn-primary self-start" disabled={busy !== "" || selectedSource.rightsClass === "unknown" || selectedSource.rightsClass === "third_party_reference" || selectedSource.conflicts.some((conflict) => conflict.state === "open")} onClick={() => void promoteSource()}>{t.promote}</button>
          </div>}
        </section>
      )}

      {selectedSignal && (
        <section className="card flex flex-col gap-4 p-5" aria-labelledby="riwi-signal-detail-title" data-signal-detail={selectedSignal.signal.id}>
          <header className="flex flex-wrap items-start justify-between gap-2"><div><h3 id="riwi-signal-detail-title" className="font-display text-lg text-ink-900">{selectedSignal.signal.signalType.replaceAll("_", " ")} · {selectedSignal.signal.state}</h3><p className="text-xs text-ink-500">{selectedSignal.signal.actorRole} · {selectedSignal.signal.scope === "global" ? "global" : "scoped learner"} · {locale === "uz" ? "manba" : "source"} {selectedSignal.signal.sourceId}</p></div><button className="btn-secondary" onClick={() => setSelectedSignal(null)}>{locale === "uz" ? "Yopish" : "Close"}</button></header>
          <div className="grid gap-3 md:grid-cols-2"><TextExcerpt label={locale === "uz" ? "Nomzod da'vosi" : "Candidate claim"} value={selectedSignal.signal.candidateClaim} /><TextExcerpt label={locale === "uz" ? "Dalil xulosasi" : "Evidence summary"} value={selectedSignal.signal.evidenceSummary} /></div>
          <p className="break-all text-xs text-ink-400">Evidence SHA-256: {selectedSignal.signal.evidenceHash}</p>
          {selectedSignal.signal.signalType.startsWith("provider_") && <p className="rounded-xl bg-band-warn/10 p-3 text-sm text-band-warn">{t.providerOnly}</p>}
          <div className="flex flex-col gap-2">
            <h4 className="font-semibold text-ink-800">{locale === "uz" ? "Ko'rib chiqish tarixi va regressiya dalili" : "Review history and regression evidence"}</h4>
            {selectedSignal.reviews.length === 0 && <p className="text-sm text-ink-500">{locale === "uz" ? "Hali ko'rib chiqilmagan." : "No review has been recorded yet."}</p>}
            {selectedSignal.reviews.map((review) => <article key={review.id} className="rounded-xl border border-ink-100 p-3">
              <p className="font-medium text-ink-800">{review.decision} · {new Date(review.createdAt).toLocaleString()}</p><p className="mt-1 text-sm text-ink-600">{review.reason}</p>
              <p className="mt-1 break-all text-xs text-ink-500">{review.regressionFixtureId ? `${review.regressionFixtureId} · ${review.regressionEvidenceHash ?? ""}` : (locale === "uz" ? "Regressiya dalili talab qilinmadi." : "No regression evidence required for this decision.")}</p>
              {review.resultingSourceId && <button type="button" className="btn-secondary mt-2" onClick={() => void loadSource(review.resultingSourceId!)}>{locale === "uz" ? `Bog'langan bilim manbasini ko'rish ${review.resultingSourceId}` : `Inspect linked knowledge source ${review.resultingSourceId}`}</button>}
            </article>)}
          </div>
          {(selectedSignal.signal.state === "candidate" || selectedSignal.signal.state === "in_review") && <div className="flex flex-col gap-3 border-t border-ink-100 pt-4">
            <label className="text-xs font-medium text-ink-700">{t.review}<textarea className="input mt-1 min-h-16" maxLength={1000} value={signalReason} onChange={(event) => setSignalReason(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy !== "" || !signalReason.trim()} onClick={() => void reviewSignal("approve")}>{t.acceptSignal}</button>
              <button type="button" className="btn-secondary" disabled={busy !== "" || !signalReason.trim()} onClick={() => void reviewSignal("request_changes")}>{t.changes}</button>
              <button type="button" className="btn-secondary" disabled={busy !== "" || !signalReason.trim()} onClick={() => void reviewSignal("reject")}>{t.reject}</button>
            </div>
          </div>}
          {acceptedReview && eligibleMaterialization && !selectedSignal.reviews.some((review) => review.resultingSourceId) && <div className="flex flex-col gap-2 border-t border-ink-100 pt-4">
            <p className="text-sm text-ink-600">{locale === "uz" ? "Qabul qilingan tuzatishdan inert nomzod manba yaratiladi; keyin alohida huquq, ziddiyat va regressiya ko'rib chiqiladi." : "Materialize the accepted correction as inert candidate source data; rights, conflicts, and regression still require separate review."}</p>
            <button type="button" className="btn-primary self-start" disabled={busy !== ""} onClick={() => void materializeSignal()}>{t.materialize}</button>
          </div>}
          {!eligibleMaterialization && selectedSignal.signal.signalType.startsWith("provider_") && <p className="text-sm text-band-warn">{locale === "uz" ? "Provayder signali bilimga aylantirilmaydi; u faqat audit qilinadigan dalil." : "Provider signals cannot be materialized as authoritative knowledge; they remain auditable evidence only."}</p>}
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="card flex flex-col gap-3 p-5" aria-labelledby="riwi-audit-title">
          <h3 id="riwi-audit-title" className="font-display text-lg text-ink-900">{t.audit}</h3>
          {audit.length === 0 && <p className="text-sm text-ink-500">{t.noAudit}</p>}
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {audit.map((entry) => <li key={entry.id} className="rounded-xl border border-ink-100 p-3">
              <p className="font-medium text-ink-800">{entry.action}</p><p className="mt-1 text-xs text-ink-500">{entry.targetType ?? "riwi"}{entry.targetId ? ` · ${entry.targetId}` : ""} · {new Date(entry.createdAt).toLocaleString()}</p>
              {entry.metadata && <p className="mt-1 break-words text-[11px] text-ink-400">{Object.entries(entry.metadata).filter(([key, value]) => !/secret|token|prompt|body|password|url|endpoint/i.test(key) && ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => `${key}=${String(value).slice(0, 160)}`).join(" · ")}</p>}
            </li>)}
          </ul>
        </div>
        <div className="card flex flex-col gap-3 p-5" aria-labelledby="riwi-diagnostics-title">
          <h3 id="riwi-diagnostics-title" className="font-display text-lg text-ink-900">{t.diagnostics}</h3>
          <p className="text-xs text-ink-500">{locale === "uz" ? "Faqat holat, ro'yxatdan o'tgan provayder identifikatorlari va muhit o'zgaruvchisi nomlari. Sir qiymatlari, endpoint URL yoki tashqi javob mazmuni yo'q." : "Status, registered provider IDs, and environment-variable names only. No secret values, endpoint URLs, or raw external response bodies."}</p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <Meta label="Raw secrets returned" value={diagnostics?.safety.rawSecretsReturned ? "yes" : "no"} />
            <Meta label="Arbitrary endpoints accepted" value={diagnostics?.safety.arbitraryEndpointsAccepted ? "yes" : "no"} />
            <Meta label="Provider agreement means truth" value={diagnostics?.safety.providerAgreementMeansTruth ? "yes" : "no"} />
            <Meta label="Automatic activation" value={diagnostics?.safety.automaticActivationOfUnverifiedKnowledge ? "yes" : "no"} />
          </dl>
        </div>
      </section>
    </div>
  );
}

function Readiness({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-paper-sunken px-3 py-2 text-xs text-ink-700"><span className="text-ink-500">{label}: </span><strong>{value}</strong></div>;
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg bg-paper-sunken p-2"><dt className="text-ink-500">{label}</dt><dd className="mt-1 break-words font-medium text-ink-800">{value}</dd></div>;
}
function TextExcerpt({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg bg-paper-sunken p-3"><p className="text-xs font-semibold text-ink-500">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-700">{value}</p></div>;
}
