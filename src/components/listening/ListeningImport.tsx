"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { startUpload, preflight, type UploadHandle } from "@/lib/uploads/client";
import { uploadErrorMessage } from "@/lib/uploads/errors";
import { archiveFile, readTransportArchive } from "@/lib/import/zip-transport";
import { ListeningLegacyImport } from "./ListeningLegacyImport";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * Listening import — CANONICAL FIRST.
 *
 *   select package → validate (server, no writes) → see what the package needs
 *   → upload the declared binaries → dry run → transactional import → open test
 *
 * The JSON is validated BEFORE a single byte of a 25 MB recording moves, the
 * browser never sends an object key, and the package decides nothing about the
 * interface: the imported rows are rendered by the same native exam as every
 * other Listening test. Legacy HTML/ZIP material lives in its own, clearly
 * labeled section.
 */

type Issue = { level: number; code: string; path?: string; message: string; blocking: boolean };

type RequiredAsset = {
  key: string;
  role: string;
  required: boolean;
  label: string | null;
  mimeTypes: string[];
  maxBytes: number;
  declared: boolean;
  path: string | null;
};

type Validation = {
  ok: boolean;
  module: string;
  contentType: string;
  schemaVersion: number;
  title: string;
  sourceRef: string;
  migratedFrom?: number;
  capabilities: { key: string; label: string };
  requiredAssets: RequiredAsset[];
  sourceStatus?: { status: "new" | "identical" | "changed"; detail?: string };
  preview: { title: string; lines: { label: string; value: string }[]; warnings: string[] } | null;
  issues: Issue[];
  warnings: string[];
};

type ImportResult = {
  action: "created" | "updated" | "unchanged";
  targetId: string;
  publicationState: string;
  warnings: string[];
};

const issueToMessage = (t: Dictionary["contentImport"], issue: Issue) =>
  `${t.problems[issue.code as keyof typeof t.problems] ?? t.problems.unknown}${issue.path ? ` (${issue.path})` : ""}`;

/**
 * Only a code this screen has copy for is kept (§O/§47/§59): the alert renders
 * `t.problems[code] ?? t.problems.unknown`, and an unknown code — one a newer server
 * invents, or a rewritten response supplies — becomes `unknown` at the boundary instead
 * of being carried into rendered state. The value is still the code, not a message, so
 * `data-canonical-import-problem` stays a machine-readable diagnosis for the operator.
 */
function knownProblemCode(t: Dictionary["contentImport"], code: string | undefined): string {
  return code && code in t.problems ? code : "unknown";
}

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)), template);

function categoryFor(role: string): "audio" | "image" | "file" {
  return role === "audio" ? "audio" : role === "image" ? "image" : "file";
}

export function ListeningImport({ dict }: { dict: Dictionary }) {
  const t = dict.contentImport;
  const [pkg, setPkg] = useState<unknown>(null);
  const [packageName, setPackageName] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [fatal, setFatal] = useState<{ code: string; issues: Issue[] } | null>(null);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [uploads, setUploads] = useState<Record<string, string>>({});
  const [published, setPublished] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"" | "validate" | "upload" | "dry" | "import">("");
  const [progress, setProgress] = useState(0);
  const [dryRun, setDryRun] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const lifetime = useRef(new AbortController());
  const handles = useRef<UploadHandle[]>([]);

  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    const uploadsInFlight = handles.current;
    const controller = lifetime.current;
    return () => {
      controller.abort();
      uploadsInFlight.forEach((handle) => handle.cancel());
    };
  }, []);

  function resetForNextPackage() {
    setValidation(null);
    setFatal(null);
    setFiles({});
    setUploads({});
    setDryRun(null);
    setResult(null);
    setError("");
    setAcknowledged(false);
  }

  async function validatePackage(candidate: unknown, name: string) {
    resetForNextPackage();
    setPkg(candidate);
    setPackageName(name);
    setBusy("validate");
    try {
      const res = await fetch("/api/admin/content/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: candidate }),
      });
      const data = (await res.json().catch(() => null)) as Validation | { error?: string; ok?: boolean; issues?: Issue[] } | null;
      if (!res.ok || !data || data.ok === false || "error" in data) {
        const failure = data as { error?: string; issues?: Issue[] };
        setFatal({ code: knownProblemCode(t, failure?.error), issues: failure?.issues ?? [] });
        return;
      }
      setValidation(data as Validation);
    } catch {
      setFatal({ code: "unknown", issues: [] });
    } finally {
      setBusy("");
    }
  }

  async function loadPackage(file: File) {
    setError("");
    if (/\.json$/i.test(file.name)) {
      try {
        await validatePackage(JSON.parse(await file.text()), file.name);
      } catch {
        setPkg(null);
        setValidation(null);
        setFatal({ code: "invalid_json", issues: [] });
      }
      return;
    }
    if (/\.zip$/i.test(file.name)) {
      setBusy("validate");
      try {
        const archive = await readTransportArchive(new Uint8Array(await file.arrayBuffer()), lifetime.current.signal);
        const extracted: Record<string, File> = {};
        const declared = (archive.manifest as { assets?: { key?: unknown; path?: unknown; role?: unknown }[] })?.assets ?? [];
        for (const asset of declared) {
          if (typeof asset?.key !== "string" || typeof asset?.path !== "string") continue;
          const bytes = archiveFile(archive.files, asset.path);
          if (!bytes) continue;
          const name = asset.path.split("/").pop() ?? asset.key;
          extracted[asset.key] = new File([new Uint8Array(bytes)], name, { type: "" });
        }
        setBusy("");
        await validatePackage(archive.manifest, file.name);
        setFiles((current) => ({ ...extracted, ...current }));
      } catch {
        setBusy("");
        setPkg(null);
        setValidation(null);
        setFatal({ code: "invalid_input", issues: [] });
      }
      return;
    }
    setFatal({ code: "invalid_input", issues: [] });
  }

  async function uploadDeclared(): Promise<Record<string, string> | null> {
    if (!validation) return null;
    const next: Record<string, string> = { ...uploads };
    const pending = validation.requiredAssets.filter((asset) => asset.declared && files[asset.key] && !next[asset.key]);
    if (!pending.length) return next;
    setBusy("upload");
    setProgress(0);
    for (const asset of pending) {
      const file = files[asset.key]!;
      const pre = preflight({ name: file.name, type: file.type, size: file.size }, categoryFor(asset.role));
      if (!pre.ok) {
        setError(t.problems.asset_mime_invalid);
        setBusy("");
        return null;
      }
      const handle = startUpload(file, {
        purpose: "material_primary",
        onProgress: (percent) => {
          if (!lifetime.current.signal.aborted) setProgress(percent);
        },
      });
      handles.current.push(handle);
      const outcome = await handle.promise;
      if (!outcome.ok) {
        setError(uploadErrorMessage(outcome.failure, dict.uploadErrors));
        setBusy("");
        return null;
      }
      next[asset.key] = outcome.uploadId;
    }
    setUploads(next);
    setProgress(0);
    return next;
  }

  async function submit(mode: "dry" | "apply") {
    if (!pkg || !validation) return;
    setError("");
    const ids = await uploadDeclared();
    if (!ids) return;
    setBusy(mode === "dry" ? "dry" : "import");
    try {
      const res = await fetch("/api/admin/content/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package: pkg,
          assetUploads: ids,
          dryRun: mode === "dry",
          publish: mode === "apply" && published,
          acknowledgeGradeImpact: acknowledged,
          originalFilename: packageName,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | (ImportResult & { ok: true })
        | { ok: false; code: string; report?: { issues: Issue[] } }
        | null;
      if (!res.ok || !data || !("ok" in data) || data.ok !== true) {
        const code = (data as { code?: string })?.code ?? "unknown";
        const issues = (data as { report?: { issues: Issue[] } })?.report?.issues ?? [];
        setFatal({ code, issues });
        return;
      }
      if (mode === "dry") setDryRun(data);
      else setResult(data);
    } catch {
      setError(t.problems.unknown);
    } finally {
      setBusy("");
    }
  }

  const missing = validation
    ? validation.requiredAssets.filter((asset) => asset.declared && !files[asset.key])
    : [];
  const undeclared = validation ? validation.requiredAssets.filter((asset) => !asset.declared) : [];

  return (
    <div className="card space-y-4" data-canonical-listening-import>
      <h1 className="font-display text-xl">{t.title}</h1>
      <p>{t.intro}</p>

      <div className="flex flex-wrap gap-2">
        <a download className="btn-secondary" href="/api/admin/content/template?module=listening&contentType=full_test&kind=template">
          {t.downloadTemplate}
        </a>
        <a download className="btn-secondary" href="/api/admin/content/template?module=listening&contentType=full_test&kind=example">
          {t.downloadExample}
        </a>
      </div>

      <label className="block">
        {t.packageLabel}
        <input
          className="mt-2 block"
          type="file"
          accept=".json,.zip,application/json,application/zip"
          disabled={!!busy}
          data-canonical-package-input
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadPackage(file);
          }}
        />
      </label>

      {busy && (
        <p role="status" data-canonical-import-status>
          {busy === "validate"
            ? t.validating
            : busy === "upload"
              ? fill(t.uploadPhase, { pct: progress > 0 ? `${progress}%` : "" })
              : busy === "dry"
                ? t.dryRunPhase
                : t.importPhase}
        </p>
      )}

      {fatal && (
        <div role="alert" className="space-y-2 rounded-lg border border-red-300 p-3" data-canonical-import-problem={fatal.code}>
          <p className="font-medium text-red-700">{t.invalidTitle}</p>
          <p>{t.problems[fatal.code as keyof typeof t.problems] ?? t.problems.unknown}</p>
          {fatal.issues.length > 0 && (
            <ul className="list-disc pl-5 text-sm" data-canonical-import-issues>
              {fatal.issues.slice(0, 8).map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issueToMessage(t, issue)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {validation && (
        <>
          <section className="space-y-2" data-canonical-import-summary>
            <h2 className="font-display text-lg">{t.summaryTitle}</h2>
            {/* The material's own title, so the operator can see WHAT they are about to import. */}
            <p className="font-medium">{validation.preview?.title ?? validation.title}</p>
            <p className="text-sm">{validation.capabilities.label} · v{validation.schemaVersion}</p>
            {validation.migratedFrom !== undefined && (
              <p className="text-sm" role="status" data-canonical-migrated>
                {validation.migratedFrom} → {validation.schemaVersion}
              </p>
            )}
            {validation.sourceStatus && (
              <p className="text-sm" data-canonical-source-status={validation.sourceStatus.status}>
                {validation.sourceStatus.status === "new"
                  ? t.sourceStatusNew
                  : validation.sourceStatus.status === "identical"
                    ? t.sourceStatusIdentical
                    : t.sourceStatusChanged}
              </p>
            )}
            {validation.preview && (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {validation.preview.lines.map((line) => (
                  <div key={line.label} className="flex gap-2 text-sm">
                    <dt className="font-medium">{line.label}</dt>
                    <dd>{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {validation.requiredAssets.length > 0 && (
            <section className="space-y-2" data-canonical-import-assets>
              <h2 className="font-display text-lg">{t.assetsTitle}</h2>
              {validation.requiredAssets.map((asset) => (
                <div key={asset.key} className="space-y-1 rounded-lg border border-black/10 p-2" data-asset-key={asset.key}>
                  <p className="text-sm font-medium">
                    {asset.label ?? asset.key} · {asset.role} · {asset.mimeTypes.join(", ")}
                  </p>
                  <p className="text-sm">
                    {files[asset.key] ? `${t.assetProvided}: ${files[asset.key]!.name}` : t.assetMissing}
                  </p>
                  <input
                    type="file"
                    className="block"
                    accept={asset.role === "audio" ? "audio/*,video/webm" : asset.role === "image" ? "image/*" : undefined}
                    disabled={!!busy}
                    aria-label={`${t.chooseFile}: ${asset.key}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) setFiles((current) => ({ ...current, [asset.key]: file }));
                    }}
                  />
                </div>
              ))}
            </section>
          )}

          {undeclared.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 p-3" data-canonical-undeclared-assets>
              <p>{t.problems.asset_missing}</p>
              <ul className="list-disc pl-5 text-sm">
                {undeclared.map((asset) => (
                  <li key={asset.key}>{`${asset.key} (${asset.role})`}</li>
                ))}
              </ul>
            </div>
          )}

          {validation.issues.length > 0 && (
            <div role="alert" className="space-y-1 rounded-lg border border-red-300 p-3" data-canonical-import-issues>
              <p className="font-medium text-red-700">{t.issuesTitle}</p>
              <ul className="list-disc pl-5 text-sm">
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issueToMessage(t, issue)}</li>
                ))}
              </ul>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-300 p-3" data-canonical-import-warnings>
              <p className="font-medium">{t.warningsTitle}</p>
              <ul className="list-disc pl-5 text-sm">
                {validation.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {error && <p role="alert" className="text-red-700">{error}</p>}

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={published} disabled={!!busy} onChange={(event) => setPublished(event.target.checked)} />
              {t.publishNow}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={!!busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              {t.acknowledgeGrades}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={!!busy || missing.length > 0 || undeclared.length > 0}
              data-canonical-dry-run
              onClick={() => void submit("dry")}
            >
              {t.dryRun}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!!busy || missing.length > 0 || undeclared.length > 0 || !dryRun}
              data-canonical-import-button
              onClick={() => void submit("apply")}
            >
              {t.importButton}
            </button>
          </div>

          {dryRun && (
            <p role="status" className="text-sm" data-canonical-dry-run-result>
              {t.dryRunPassed}
              {dryRun.warnings.length > 0 && (
                <ul className="list-disc pl-5">
                  {dryRun.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
            </p>
          )}
        </>
      )}

      {result && (
        <p role="status" data-canonical-import-result={result.action}>
          {result.action === "unchanged" ? t.unchanged : result.action === "updated" ? t.updated : result.publicationState === "published" ? t.createdPublished : t.createdDraft}{" "}
          <Link className="btn-secondary" href={`/app/listening/tests/${result.targetId}`}>
            {t.open}
          </Link>
        </p>
      )}

      <details className="rounded-lg border border-black/10 p-3" data-legacy-import-section>
        <summary className="cursor-pointer font-medium">{t.legacyTitle}</summary>
        <p className="mt-2 text-sm">{t.legacyIntro}</p>
        <div className="mt-3">
          <ListeningLegacyImport dict={dict} />
        </div>
      </details>
    </div>
  );
}

export { probeAudio } from "./audio-probe";
