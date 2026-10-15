"use client";

import Link from "next/link";
import { RetentionMeasurementEditor } from "@/components/admin/RetentionMeasurementEditor";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { RETENTION_LEVEL_CONFIG, type RetentionLevel } from "@/lib/retention/levels";
import { countWords } from "@/lib/retention/word-count";

/**
 * The Retention bank panel: the owner's two-field authoring workflow.
 *
 * Add takes exactly two inputs — the text and the Measurement Structure — plus
 * the level the screen is already on. Everything else (internal label, version,
 * usage counters, rotation membership) is assigned by the server.
 *
 * The live check calls the SAME endpoint the save calls, so the red/green state
 * in the editor cannot disagree with what the server will do, and the live word
 * counter is the SAME shared `countWords` the server stores. Change is a new
 * version, never an overwrite, and a stale editor is told so instead of silently
 * clobbering a newer version.
 *
 * Failure handling: every request has a deadline and is aborted on unmount; a
 * validation response older than the current input is ignored; a mutation is
 * locked synchronously against double clicks and never retried automatically,
 * because a timed-out POST has an unknown server outcome.
 */

export type RetentionBankRow = {
  textId: string;
  internalLabel: string;
  level: string;
  active: boolean;
  preview: string;
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
  | { kind: "invalid"; error: string; issues: string[] }
  | { kind: "unavailable" };

type EditorTarget = { mode: "add" } | { mode: "change"; textId: string; label: string };

const READ_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 20_000;

class RequestTimeout extends Error {}

/** fetch with a deadline that also honours an outer abort (unmount). */
async function fetchWithDeadline(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener("abort", onOuterAbort);
  try {
    return await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * The validator answers `details: { issues: [{ path, code }] }` for a structure
 * problem. Render path + code (never raw server internals).
 */
export function formatValidationIssues(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 20).map((issue) => {
    if (typeof issue === "string") return issue;
    if (issue && typeof issue === "object") {
      const { path, code } = issue as { path?: unknown; code?: unknown };
      const where = typeof path === "string" && path ? path : "(root)";
      return `${where}: ${typeof code === "string" ? code : "invalid"}`;
    }
    return "invalid";
  });
}

export function RetentionBankPanel({
  dict,
  level,
  rows,
  isOwner = false,
  filter,
  sort,
  page = 1,
  pageCount = 1,
  total,
}: {
  dict: Dictionary;
  level: RetentionLevel;
  rows: RetentionBankRow[];
  isOwner?: boolean;
  filter: string;
  sort: string;
  page?: number;
  pageCount?: number;
  total?: number;
}) {
  const t = dict.retentionMemory.admin;
  const router = useRouter();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);

  const levelHref = (nextFilter: string, nextSort = sort, nextPage = 1) =>
    `/app/admin/reading/retention?level=${level}&filter=${nextFilter}&sort=${nextSort}${nextPage > 1 ? `&page=${nextPage}` : ""}`;

  async function setActive(row: RetentionBankRow, active: boolean) {
    if (busyRef.current) return;
    if (!active && !window.confirm(t.confirmArchive)) return;
    busyRef.current = row.textId;
    setBusy(row.textId);
    setConflict(false);
    try {
      const response = await fetchWithDeadline(
        `/api/admin/retention/texts/${row.textId}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) },
        WRITE_TIMEOUT_MS
      );
      if (!response.ok) {
        setNotice(t.archiveFailed);
        return;
      }
      setNotice(t.saved);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof RequestTimeout ? t.saveUnknown : t.archiveFailed);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function deleteText(row: RetentionBankRow) {
    if (busyRef.current) return;
    if (!window.confirm(t.confirmPermanentDelete.replace("{label}", row.internalLabel))) return;
    if (window.prompt(t.confirmDeleteLabel.replace("{label}", row.internalLabel)) !== row.internalLabel) return;
    busyRef.current = row.textId;
    setBusy(row.textId);
    setConflict(false);
    try {
      const response = await fetchWithDeadline(
        `/api/admin/retention/texts/${row.textId}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedLabel: row.internalLabel }) },
        WRITE_TIMEOUT_MS
      );
      if (response.status === 409) {
        setNotice(t.deleteBlocked);
        return;
      }
      if (!response.ok) {
        setNotice(t.deleteFailed);
        return;
      }
      setNotice(t.saved);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof RequestTimeout ? t.saveUnknown : t.deleteFailed);
    } finally {
      busyRef.current = null;
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
          <Link
            key={option.key}
            href={levelHref(option.key)}
            className={filter === option.key ? "tab tab-active" : "tab"}
            data-retention-filter={option.key}
          >
            {option.label}
          </Link>
        ))}
        <span className="mx-1 h-6 w-px self-center bg-ink-100" aria-hidden />
        {[
          { key: "label", label: t.sortLabel },
          { key: "uses", label: t.sortUses },
          { key: "newest", label: t.sortNewest },
        ].map((option) => (
          <Link
            key={option.key}
            href={levelHref(filter, option.key)}
            className={sort === option.key ? "tab tab-active" : "tab"}
            data-retention-sort={option.key}
          >
            {option.label}
          </Link>
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
                <th scope="col"><span className="sr-only">{t.tableActions}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.textId} className="border-t border-ink-100 align-top" data-retention-row={row.textId} data-retention-row-active={row.active}>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-900">{row.internalLabel}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${row.active ? "bg-paper-sunken text-ink-700" : "text-signal-600"}`}
                        data-retention-row-status={row.active ? "active" : "archived"}
                      >
                        {row.active ? t.activeBadge : t.archivedBadge}
                      </span>
                    </div>
                    {row.preview && (
                      <p className="meta-text mt-1 line-clamp-2 max-w-[36rem]" data-retention-row-preview>
                        {row.preview}
                      </p>
                    )}
                  </td>
                  <td className="py-2 text-ink-500">{row.wordCount}</td>
                  <td className="py-2 text-ink-500">{t.versionBadge.replace("{n}", String(row.versionNumber))}</td>
                  <td className="py-2 text-ink-500" data-retention-row-current-uses={row.currentVersionUses}>{row.currentVersionUses}</td>
                  <td className="py-2 text-ink-500" data-retention-row-lifetime-uses={row.lifetimeUses}>{row.lifetimeUses}</td>
                  <td className="py-2">
                    <RowMenu
                      label={t.rowActions.replace("{label}", row.internalLabel)}
                      disabled={busy === row.textId}
                      items={[
                        {
                          key: "change",
                          label: t.change,
                          marker: { "data-retention-change": row.textId },
                          onSelect: () => setEditor({ mode: "change", textId: row.textId, label: row.internalLabel }),
                        },
                        row.active
                          ? {
                              key: "archive",
                              label: t.archiveAction,
                              marker: { "data-retention-archive": row.textId },
                              onSelect: () => void setActive(row, false),
                            }
                          : {
                              key: "restore",
                              label: t.restore,
                              marker: { "data-retention-restore": row.textId },
                              onSelect: () => void setActive(row, true),
                            },
                        ...(isOwner ? [{
                          key: "delete",
                          label: t.archive,
                          marker: { "data-retention-delete": row.textId },
                          onSelect: () => void deleteText(row),
                        }] : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 || (total !== undefined && total > 0) ? (
        <nav className="flex flex-wrap items-center gap-3" aria-label={t.pagination} data-retention-pagination>
          {page > 1 ? (
            <Link className="btn-secondary" href={levelHref(filter, sort, page - 1)} data-retention-page-prev>
              {t.previousPage}
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-50" aria-disabled="true">{t.previousPage}</span>
          )}
          <span className="meta-text" data-retention-page-status={`${page}/${pageCount}`}>
            {t.pageStatus
              .replace("{page}", String(page))
              .replace("{pages}", String(pageCount))
              .replace("{total}", String(total ?? rows.length))}
          </span>
          {page < pageCount ? (
            <Link className="btn-secondary" href={levelHref(filter, sort, page + 1)} data-retention-page-next>
              {t.nextPage}
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-50" aria-disabled="true">{t.nextPage}</span>
          )}
        </nav>
      ) : null}
    </section>
  );
}

type MenuItem = { key: string; label: string; marker: Record<string, string>; onSelect: () => void };

/**
 * Accessible three-dot row menu: a labelled trigger, `role="menu"` items,
 * ArrowUp/ArrowDown/Home/End roving focus, Escape and outside press close, and
 * focus returns to the trigger when the menu closes from the keyboard.
 */
function RowMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const index = itemRefs.current.findIndex((item) => item === document.activeElement);
    const last = items.length - 1;
    const focusAt = (next: number) => itemRefs.current[next]?.focus();
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index >= last ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index <= 0 ? last : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(last);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="relative inline-block" ref={wrapperRef} data-retention-row-menu>
      <button
        ref={triggerRef}
        type="button"
        className="btn-secondary min-h-[40px] min-w-[40px] px-2"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={disabled || undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        data-retention-row-menu-trigger
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-10 mt-1 flex min-w-[10rem] flex-col rounded-md border border-ink-100 bg-paper-raised p-1 shadow-card"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="rounded px-3 py-2 text-left text-sm text-ink-700 hover:bg-paper-sunken focus:bg-paper-sunken"
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              {...item.marker}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "failed">(target.mode === "change" ? "loading" : "ready");
  const [loadGeneration, setLoadGeneration] = useState(0);
  const savingRef = useRef(false);
  const validationGeneration = useRef(0);
  const unmount = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    unmount.current = controller;
    return () => controller.abort();
  }, []);

  // Change opens the CURRENT version, so the editor starts from the truth. A
  // failed or non-OK load is an explicit failure with Retry, never an empty
  // edit form that could be saved over the real text.
  useEffect(() => {
    if (target.mode !== "change") return;
    const controller = new AbortController();
    setLoad("loading");
    void (async () => {
      try {
        const response = await fetchWithDeadline(`/api/admin/retention/texts/${target.textId}`, { method: "GET" }, READ_TIMEOUT_MS, controller.signal);
        if (!response.ok) throw new Error("load failed");
        const body = (await response.json()) as {
          text?: { bodyText: string; scoringStructure: unknown; currentVersionId: string };
        };
        if (!body.text) throw new Error("load failed");
        if (controller.signal.aborted) return;
        setBodyText(body.text.bodyText);
        setStructureText(JSON.stringify(body.text.scoringStructure, null, 2));
        setCurrentVersionId(body.text.currentVersionId);
        setLoad("ready");
      } catch {
        if (!controller.signal.aborted) setLoad("failed");
      }
    })();
    return () => controller.abort();
  }, [target, loadGeneration]);

  const check = useCallback(async () => {
    const generation = ++validationGeneration.current;
    if (!bodyText.trim() || !structureText.trim()) {
      setValidation({ kind: "idle" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(structureText);
    } catch {
      setValidation({ kind: "invalid", error: "retention_invalid_structure", issues: [t.structureJsonInvalid] });
      return;
    }
    setValidation({ kind: "checking" });
    try {
      const response = await fetchWithDeadline(
        "/api/admin/retention/validate",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level, bodyText, scoringStructure: parsed }) },
        READ_TIMEOUT_MS,
        unmount.current?.signal
      );
      const result = (await response.json().catch(() => null)) as
        | { valid: true; wordCount: number; claims: number }
        | { valid: false; error: string; details: unknown }
        | null;
      // A newer keystroke has started its own check: this answer is stale.
      if (generation !== validationGeneration.current) return;
      if (!response.ok || !result) {
        setValidation(response.status === 400 ? { kind: "invalid", error: "retention_invalid_input", issues: [] } : { kind: "unavailable" });
        return;
      }
      if (result.valid) {
        setValidation({ kind: "valid", wordCount: result.wordCount, points: 100 });
        return;
      }
      setValidation({ kind: "invalid", error: result.error, issues: formatValidationIssues(result.details) });
    } catch {
      if (generation === validationGeneration.current && !unmount.current?.signal.aborted) setValidation({ kind: "unavailable" });
    }
  }, [bodyText, level, structureText, t.structureJsonInvalid]);

  useEffect(() => {
    if (load !== "ready") return;
    const timer = window.setTimeout(() => void check(), 400);
    return () => window.clearTimeout(timer);
  }, [check, load]);

  const save = useCallback(async () => {
    // Synchronous lock: a second click before React re-renders is ignored.
    if (savingRef.current) return;
    let structure: unknown;
    try {
      structure = JSON.parse(structureText);
    } catch {
      setValidation({ kind: "invalid", error: "retention_invalid_structure", issues: [t.structureJsonInvalid] });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const isChange = target.mode === "change";
      const response = await fetchWithDeadline(
        isChange ? `/api/admin/retention/texts/${target.textId}/versions` : "/api/admin/retention/texts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isChange
              ? { bodyText, scoringStructure: structure, expectedCurrentVersionId: currentVersionId ?? undefined }
              : { level, bodyText, scoringStructure: structure }
          ),
        },
        WRITE_TIMEOUT_MS,
        unmount.current?.signal
      );
      if (response.status === 409) {
        onConflict();
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; details?: unknown } | null;
        if (body?.error === "retention_invalid_structure" || body?.error === "retention_word_count_out_of_range") {
          setValidation({ kind: "invalid", error: body.error, issues: formatValidationIssues(body.details) });
        } else {
          setSaveError(t.saveFailed);
        }
        return;
      }
      onSaved();
    } catch (error) {
      if (unmount.current?.signal.aborted) return;
      // Unknown outcome after a timeout: never retry automatically.
      setSaveError(error instanceof RequestTimeout ? t.saveUnknown : t.saveFailed);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [bodyText, currentVersionId, level, onConflict, onSaved, structureText, t, target]);

  // Live count uses the shared canonical counter, independent of the rubric.
  const liveWords = useMemo(() => countWords(bodyText), [bodyText]);
  const inRange = liveWords >= config.minWords && liveWords <= config.maxWords;

  const statusLine = (() => {
    switch (validation.kind) {
      case "checking":
        return dict.common.loading;
      case "valid":
        return `${t.pointsValid.replace("{n}", String(validation.points))} ${t.valid}`;
      case "unavailable":
        return t.validationUnavailable;
      case "invalid":
        return validation.error === "retention_word_count_out_of_range"
          ? t.wordCountInvalid
              .replace("{n}", String(liveWords))
              .replace("{level}", level)
              .replace("{min}", String(config.minWords))
              .replace("{max}", String(config.maxWords))
          : t.issueStructure.replace("{n}", String(validation.issues.length));
      default:
        return t.invalid;
    }
  })();

  return (
    <div className="panel flex flex-col gap-3" data-retention-editor>
      <div className="flex items-center justify-between">
        <h3 className="card-title">{target.mode === "change" ? t.changeTitle : t.addTitle}</h3>
        <span className="meta-text" data-retention-editor-mode={target.mode}>
          {target.mode === "change" ? target.label : level}
        </span>
      </div>

      {load === "loading" && <p className="body-text" role="status">{dict.common.loading}</p>}
      {load === "failed" && (
        <div className="flex flex-wrap items-center gap-3" role="alert" data-retention-editor-load-failed>
          <p className="body-text">{t.loadFailed}</p>
          <button type="button" className="btn-secondary" onClick={() => setLoadGeneration((value) => value + 1)} data-retention-editor-load-retry>
            {t.retry}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      )}
      {load === "ready" && (
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
            <span
              className={`meta-text ${inRange ? "" : "text-signal-700"}`}
              aria-live="polite"
              data-retention-editor-live-count={liveWords}
              data-retention-editor-live-in-range={inRange}
            >
              {t.wordCountLive
                .replace("{n}", String(liveWords))
                .replace("{level}", level)
                .replace("{min}", String(config.minWords))
                .replace("{max}", String(config.maxWords))}
            </span>
          </label>

          <RetentionMeasurementEditor value={structureText} onChange={setStructureText} dict={dict} />

          <div
            className="meta-text"
            role="status"
            aria-live="polite"
            data-retention-editor-status={validation.kind}
            data-retention-editor-word-count={validation.kind === "valid" ? validation.wordCount : ""}
          >
            {statusLine}
          </div>

          {validation.kind === "invalid" && validation.issues.length > 0 && (
            <ul className="meta-text list-disc pl-5" data-retention-editor-issues>
              {validation.issues.slice(0, 8).map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}

          {saveError && (
            <p className="text-sm text-signal-700" role="alert" data-retention-editor-save-error>
              {saveError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save()}
              disabled={saving || validation.kind !== "valid"}
              aria-busy={saving || undefined}
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
