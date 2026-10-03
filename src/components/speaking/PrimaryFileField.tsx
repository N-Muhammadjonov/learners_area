"use client";

import { describeUploadError, uploadErrorMessage } from "@/lib/uploads/errors";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { startUpload, preflight, type UploadState, type UploadHandle } from "@/lib/uploads/client";
import { formatBytes } from "@/lib/uploads/format";
import { acceptAttribute, maxBytesLabel } from "@/lib/validation/uploads";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The resource's primary file: choose, replace, remove, cancel, retry — with
 * real byte progress and no simulated percentage.
 *
 * An object already stored on the material (edit mode) is passed in as
 * `existing`; it renders as complete with no `uploadId`, which is exactly what
 * tells the server "retain this object, don't expect a new upload".
 */
export type PrimaryDraft =
  | { mode: "empty" }
  | { mode: "link"; primaryUrl: string }
  | {
      mode: "upload";
      state: UploadState;
      progress: number;
      uploadId?: string;
      objectKey?: string;
      originalName: string;
      mimeType: string;
      size: number;
      file?: File;
      error?: string;
      /** true when this object was already stored before the form opened */
      retained?: boolean;
    };

export function PrimaryFileField({
  dict,
  value,
  onChange,
  materialId,
  onError,
}: {
  dict: Dictionary;
  value: PrimaryDraft;
  onChange: (next: PrimaryDraft) => void;
  materialId?: string;
  onError?: (message: string) => void;
}) {
  const t = dict.speaking;
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const uploadRef = useRef<UploadHandle | null>(null);
  useEffect(() => {alive.current = true; return () => {alive.current = false; uploadRef.current?.cancel(); uploadRef.current = null;};}, []);

  function cancelCurrent() {
    ++generation.current;
    uploadRef.current?.cancel();
    uploadRef.current = null;
  }

  function choose() {
    inputRef.current?.click();
  }

  function startUploadOf(file: File) {
    uploadRef.current?.cancel();
    const currentGeneration = ++generation.current;
    const emit = (next: PrimaryDraft) => {if (alive.current && currentGeneration === generation.current) onChange(next);};
    const pre = preflight(file, "primary");
    if (!pre.ok) {
      onError?.(describeUploadError(pre.error, dict.uploadErrors));
      return;
    }

    emit({
      mode: "upload",
      state: "queued",
      progress: 0,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      file,
    });

    const handle = startUpload(file, {
      purpose: "material_primary",
      materialId,
      onState: (state) =>
        emit({
          mode: "upload",
          state,
          progress: 0,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          file,
        }),
      onProgress: (progress) =>
        emit({
          mode: "upload",
          state: "uploading",
          progress,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          file,
        }),
    });

    uploadRef.current = handle;
    void handle.promise.then((outcome) => {
      if (!alive.current || currentGeneration !== generation.current) return;
      uploadRef.current = null;
      if (outcome.ok) {
        emit({
          mode: "upload",
          state: "complete",
          progress: 100,
          uploadId: outcome.uploadId,
          objectKey: outcome.objectKey,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          file,
        });
      } else {
        emit({
          mode: "upload",
          state: outcome.error === "cancelled" ? "cancelled" : "failed",
          progress: 0,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          file,
          error: outcome.error,
        });
      }
    });
  }

  const uploading =
    value.mode === "upload" && (value.state === "queued" || value.state === "uploading" || value.state === "finalizing");

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 flex w-fit overflow-hidden rounded-sm border border-ink-100 text-xs font-medium">
        {(["upload", "link"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={tab === mode}
            onClick={() => {
              cancelCurrent();
              setTab(mode);
              onChange(mode === "upload" ? { mode: "empty" } : { mode: "link", primaryUrl: "" });
            }}
            className={`px-3 py-1.5 ${tab === mode ? "bg-signal-600 text-white" : "bg-paper-raised text-ink-500"}`}
          >
            {mode === "upload" ? t.uploadTab : t.linkTab}
          </button>
        ))}
      </div>

      {tab === "upload" ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={acceptAttribute("primary")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) startUploadOf(file);
              e.target.value = "";
            }}
          />

          {value.mode === "empty" && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const file = e.dataTransfer.files?.[0];
                if (file) startUploadOf(file);
              }}
              className="flex flex-col items-start gap-1 rounded-sm border border-dashed border-ink-200 px-3 py-4"
            >
              <Button type="button" variant="secondary" onClick={choose}>
                {t.chooseFile}
              </Button>
              <p className="text-xs text-ink-300">{t.dropHint.replace("{max}", maxBytesLabel("primary"))}</p>
            </div>
          )}

          {value.mode === "upload" && (
            <div className="flex flex-col gap-2 rounded-sm border border-ink-100 bg-paper-sunken p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink-900">{value.originalName}</span>
                <span className="shrink-0 text-xs text-ink-300">{formatBytes(value.size)}</span>
              </div>

              {uploading && (
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100"
                    role="progressbar"
                    aria-valuenow={value.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t.uploadState[value.state]}
                  >
                    <div className="h-full bg-signal-500" style={{ width: `${value.progress}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-xs text-ink-300">
                    {value.state === "finalizing"
                      ? t.uploadState.finalizing
                      : t.progressLabel.replace("{percent}", String(value.progress))}
                  </span>
                  <button
                    type="button"
                    onClick={() => { cancelCurrent(); onChange({ mode: "empty" }); }}
                    className="shrink-0 text-xs text-ink-400 hover:text-band-bad"
                  >
                    {t.cancelUpload}
                  </button>
                </div>
              )}

              {value.state === "complete" && (
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-xs text-band-good">
                    ✓
                  </span>
                  <span className="text-xs text-band-good">{t.uploadState.complete}</span>
                  {value.retained && <span className="text-xs text-ink-300">{t.keepAttachment}</span>}
                  <button type="button" onClick={choose} className="btn-secondary ml-auto">
                    {t.replaceFile}
                  </button>
                  <button
                    type="button"
                    onClick={() => { cancelCurrent(); onChange({ mode: "empty" }); }}
                    className="btn-secondary text-band-bad"
                  >
                    {t.removeFile}
                  </button>
                </div>
              )}

              {(value.state === "failed" || value.state === "cancelled") && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-band-bad">
                    {t.uploadState[value.state]}
                    {value.error ? ` — ${describeUploadError(value.error, dict.uploadErrors)}` : ""}
                  </span>
                  {value.file && (
                    <button type="button" onClick={() => startUploadOf(value.file!)} className="btn-secondary ">
                      {t.retryUpload}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="primary-link">{t.linkTab}</Label>
          <Input
            id="primary-link"
            type="url"
            placeholder="https://…"
            value={value.mode === "link" ? value.primaryUrl : ""}
            onChange={(e) => onChange({ mode: "link", primaryUrl: e.target.value })}
          />
          <p className="text-xs text-ink-300">{t.primaryUrlHelp}</p>
        </div>
      )}
    </div>
  );
}
