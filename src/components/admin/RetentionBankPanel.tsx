"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { RETENTION_LEVEL_CONFIG, type RetentionLevel } from "@/lib/retention/levels";

/**
 * The Retention bank panel: the owner's two-field authoring workflow.
 *
 * Add takes exactly two inputs — the text and the Measurement Structure — plus
 * the level the screen is already on. Everything else (internal label, version,
 * usage counters, rotation membership) is assigned by the server.
 *
 * The live check calls the SAME endpoint the save calls, so the counter and the
 * red/green state in the editor cannot disagree with what the server will do.
 * Change is a new version, never an overwrite, and a stale editor is told so
 * instead of silently clobbering a newer version.
 */

export type RetentionBankRow = {
  textId: string;
  internalLabel: string;
  level: string;
  active: boolean;
  wordCount: number;
  versionNumber: number;
  currentVersionUses: number;
  lifetimeUses: number;
  updatedAt: string;
};

type ValidationState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; wordCount: number; points: number }
  | { kind: "invalid"; error: string; message: string; issues: string[] };

type EditorTarget = { mode: "add" } | { mode: "change"; textId: string; label: string; versionId: string };

export function RetentionBankPanel({
  dict,
  level,
  rows,
  filter,
  sort,
}: {
  dict: Dictionary;
  level: RetentionLevel;
  rows: RetentionBankRow[];
  filter: string;
  sort: string;
}) {
  const t = dict.retentionMemory.admin;
  const router = useRouter();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const levelHref = (nextFilter: string, nextSort = sort) =>
    `/admin/reading/retention?level=${level}&filter=${nextFilter}&sort=${nextSort}`;

  async function setActive(row: RetentionBankRow, active: boolean) {
    if (!active && !window.confirm(t.confirmArchive)) return;
    setBusy(row.textId);
    setConflict(false);
    try {
      const response = await fetch(`/api/admin/retention/texts/${row.textId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!response.ok) {
        setNotice(dict.retentionMemory.errors.retention_unavailable);
        return;
      }
      setNotice(t.saved);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" data-retention-bank={level}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{t.levelHeading.replace("{level}", level)}</h2>
        <button type="button" className="btn-primary w-fit" onClick={() => setEditor({ mode: "add" })} data-retention-add>
          {t.addText}
        </button>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={t.inventoryTitle} data-retention-bank-filters>
        {[
          { key: "all", label: t.filterAll },
          { key: "active", label: t.filterActive },
          { key: "archived", label: t.filterArchived },
        ].map((option) => (
          <a
            key={option.key}
            href={levelHref(option.key)}
            className={filter === option.key ? "tab tab-active" : "tab"}
            data-retention-filter={option.key}
          >
            {option.label}
          </a>
        ))}
        <span className="mx-1 h-6 w-px self-center bg-ink-100" aria-hidden />
        {[
          { key: "label", label: t.sortLabel },
          { key: "uses", label: t.sortUses },
          { key: "newest", label: t.sortNewest },
        ].map((option) => (
          <a
            key={option.key}
            href={levelHref(filter, option.key)}
            className={sort === option.key ? "tab tab-active" : "tab"}
            data-retention-sort={option.key}
          >
            {option.label}
          </a>
        ))}
      </nav>

      {notice && !editor && <p className="meta-text" role="status" data-retention-bank-notice>{notice}</p>}

      {editor && (
        <RetentionEditor
          dict={dict}
          level={level}
          target={editor}
          onClose={() => {
            setEditor(null);
            setConflict(false);
          }}
          onConflict={() => setConflict(true)}
          onSaved={() => {
            setEditor(null);
            setNotice(t.saved);
            router.refresh();
          }}
        />
      )}

      {conflict && (
        <p className="panel border-signal-300 text-sm text-signal-700" role="alert" data-retention-conflict>
          {t.conflict}{" "}
          <button type="button" className="link-inline" onClick={() => router.refresh()} data-retention-conflict-reload>
            {t.cancel}
          </button>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="body-text" data-retention-bank-empty>{t.emptyBank}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-retention-bank-table>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-300">
                <th scope="col">{t.tableLabel}</th>
                <th scope="col">{t.tableWords}</th>
                <th scope="col">{t.tableVersion}</th>
                <th scope="col">{t.tableCurrentUses}</th>
                <th scope="col">{t.tableLifetimeUses}</th>
                <th scope="col">{t.tableActions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.textId} className="border-t border-ink-100" data-retention-row={row.textId} data-retention-row-active={row.active}>
                  <td className="py-2">
                    <span className="text-ink-900">{row.internalLabel}</span>
                    {!row.active && <span className="ml-2 text-xs text-signal-600">{t.archivedBadge}</span>}
                  </td>
                  <td className="py-2 text-ink-500">{row.wordCount}</td>
                  <td className="py-2 text-ink-500">{t.versionBadge.replace("{n}", String(row.versionNumber))}</td>
                  <td className="py-2 text-ink-500" data-retention-row-current-uses={row.currentVersionUses}>{row.currentVersionUses}</td>
                  <td className="py-2 text-ink-500" data-retention-row-lifetime-uses={row.lifetimeUses}>{row.lifetimeUses}</td>
                  <td className="flex flex-wrap gap-2 py-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setEditor({ mode: "change", textId: row.textId, label: row.internalLabel, versionId: "" })}
                      data-retention-change={row.textId}
                    >
                      {t.change}
                    </button>
                    {row.active ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void setActive(row, false)}
                        disabled={busy === row.textId}
                        data-retention-archive={row.textId}
                      >
                        {t.archive}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void setActive(row, true)}
                        disabled={busy === row.textId}
                        data-retention-restore={row.textId}
                      >
                        {t.restore}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RetentionEditor({
  dict,
  level,
  target,
  onClose,
  onSaved,
  onConflict,
}: {
  dict: Dictionary;
  level: RetentionLevel;
  target: EditorTarget;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = dict.retentionMemory.admin;
  const config = RETENTION_LEVEL_CONFIG[level];
  const [bodyText, setBodyText] = useState("");
  const [structureText, setStructureText] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(target.mode === "change");

  // Change opens the CURRENT version, so the editor starts from the truth, not
  // from whatever the row happened to render.
  useEffect(() => {
    if (target.mode !== "change") return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/admin/retention/texts/${target.textId}`, { cache: "no-store" });
      if (!response.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const body = (await response.json()) as {
        text: { bodyText: string; scoringStructure: unknown; currentVersionId: string };
      };
      if (cancelled) return;
      setBodyText(body.text.bodyText);
      setStructureText(JSON.stringify(body.text.scoringStructure, null, 2));
      setCurrentVersionId(body.text.currentVersionId);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const check = useCallback(async () => {
    if (!bodyText.trim() || !structureText.trim()) {
      setValidation({ kind: "idle" });
      return;
    }
    setValidation({ kind: "checking" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(structureText);
    } catch {
      setValidation({ kind: "invalid", error: "retention_invalid_structure", message: t.invalid, issues: [] });
      return;
    }
    try {
      const response = await fetch("/api/admin/retention/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level, bodyText, scoringStructure: parsed }),
      });
      const result = (await response.json()) as
        | { valid: true; wordCount: number; claims: number }
        | { valid: false; error: string; details: unknown };
      if (!response.ok) {
        setValidation({ kind: "invalid", error: "retention_invalid_input", message: t.invalid, issues: [] });
        return;
      }
      if (result.valid) {
        setValidation({ kind: "valid", wordCount: result.wordCount, points: 100 });
        return;
      }
      const issues = Array.isArray(result.details)
        ? result.details.map((issue) => (typeof issue === "string" ? issue : JSON.stringify(issue)))
        : [];
      setValidation({ kind: "invalid", error: result.error, message: t.invalid, issues });
    } catch {
      setValidation({ kind: "invalid", error: "retention_unavailable", message: t.invalid, issues: [] });
    }
  }, [bodyText, level, structureText, t.invalid]);

  useEffect(() => {
    const timer = window.setTimeout(() => void check(), 400);
    return () => window.clearTimeout(timer);
  }, [check]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const structure = JSON.parse(structureText) as unknown;
      const isChange = target.mode === "change";
      const response = await fetch(
        isChange ? `/api/admin/retention/texts/${target.textId}/versions` : "/api/admin/retention/texts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isChange
              ? { bodyText, scoringStructure: structure, expectedCurrentVersionId: currentVersionId ?? undefined }
              : { level, bodyText, scoringStructure: structure }
          ),
        }
      );
      if (response.status === 409) {
        onConflict();
        return;
      }
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setValidation({ kind: "invalid", error: body.error ?? "retention_unavailable", message: t.invalid, issues: [] });
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }, [bodyText, currentVersionId, level, onConflict, onSaved, structureText, t.invalid, target]);

  const issueLine = useMemo(() => {
    if (validation.kind !== "invalid") return null;
    if (validation.error === "retention_word_count_out_of_range") {
      const count = bodyText.trim() ? bodyText.trim().split(/\s+/u).filter(Boolean).length : 0;
      return t.wordCountInvalid.replace("{n}", String(count)).replace("{level}", level);
    }
    return t.issueStructure.replace("{n}", String(validation.issues.length));
  }, [bodyText, level, t, validation]);

  return (
    <div className="panel flex flex-col gap-3" data-retention-editor>
      <div className="flex items-center justify-between">
        <h3 className="card-title">{target.mode === "change" ? t.changeTitle : t.addTitle}</h3>
        <span className="meta-text" data-retention-editor-mode={target.mode}>
          {target.mode === "change" ? target.label : level}
        </span>
      </div>

      {loading ? (
        <p className="body-text">{dict.common.loading}</p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="meta-text">{t.textLabel}</span>
            <span className="meta-text">{t.textHint.replace("{min}", String(config.minWords)).replace("{max}", String(config.maxWords))}</span>
            <textarea
              className="input min-h-[12rem] w-full"
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              data-retention-editor-text
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="meta-text">{t.structureLabel}</span>
            <span className="meta-text">{t.structureHint}</span>
            <textarea
              className="input min-h-[12rem] w-full font-mono text-xs"
              value={structureText}
              onChange={(event) => setStructureText(event.target.value)}
              spellCheck={false}
              data-retention-editor-structure
            />
          </label>

          <div
            className="meta-text"
            role="status"
            aria-live="polite"
            data-retention-editor-status={validation.kind}
            data-retention-editor-word-count={validation.kind === "valid" ? validation.wordCount : ""}
          >
            {validation.kind === "checking" && dict.common.loading}
            {validation.kind === "idle" && t.invalid}
            {validation.kind === "valid" &&
              `${t.wordCountValid
                .replace("{n}", String(validation.wordCount))
                .replace("{min}", String(config.minWords))
                .replace("{max}", String(config.maxWords))} ${t.pointsValid.replace("{n}", String(validation.points))} ${t.valid}`}
            {validation.kind === "invalid" && (issueLine ?? t.invalid)}
          </div>

          {validation.kind === "invalid" && validation.issues.length > 0 && (
            <ul className="meta-text list-disc pl-5" data-retention-editor-issues>
              {validation.issues.slice(0, 8).map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save()}
              disabled={saving || validation.kind !== "valid"}
              data-retention-editor-save
            >
              {saving ? t.saving : target.mode === "change" ? t.saveVersion : t.save}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose} data-retention-editor-cancel>
              {t.cancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
