"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { formatBytes } from "@/lib/uploads/format";
import { acceptAttribute, maxBytesLabel } from "@/lib/validation/uploads";
import { isMediaDraft, type BlockDraft, type BlockDraftController } from "./useBlockDrafts";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The ordered description composer: a Telegram-shaped list of mixed blocks
 * (text, link, image, audio, file) rather than one textarea.
 *
 * Interaction rules held here deliberately:
 *  - a compact "+" opens File / Image / Audio / Link — no giant modal
 *  - reordering is drag-and-drop on desktop AND up/down buttons, so keyboard
 *    and touch users are never blocked by the fancy path
 *  - every file shows its real state and real byte progress, with retry and
 *    cancel; nothing animates a fake percentage
 *  - a block that is already stored is labelled "kept as-is" so it is obvious
 *    that saving will not re-upload it
 */
export function BlockComposer({
  dict,
  controller,
  materialId,
}: {
  dict: Dictionary;
  controller: BlockDraftController;
  materialId?: string;
}) {
  const t = dict.speaking;
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState<"text" | "link" | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftLink, setDraftLink] = useState("");
  const [editingText, setEditingText] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<"image" | "audio" | "file">("file");
  const replaceTarget = useRef<string | null>(null);
  const menuId = useId();

  const { blocks, move, reorderTo, remove, retry, cancel, addText, addLink, setText, setLink, replaceMedia, uploadMedia } =
    controller;

  function pickFile(kind: "image" | "audio" | "file", forLocalId?: string) {
    pendingKind.current = kind;
    replaceTarget.current = forLocalId ?? null;
    if (fileInput.current) {
      fileInput.current.accept = acceptAttribute(kind);
      fileInput.current.value = "";
      fileInput.current.click();
    }
  }

  function onFilesPicked(files: FileList | null) {
    if (!files) return;
    const kind = pendingKind.current;
    const target = replaceTarget.current;
    for (const file of Array.from(files)) {
      if (target) replaceMedia(target, file);
      else uploadMedia(file, kind);
    }
    replaceTarget.current = null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex flex-col gap-2 rounded-sm border border-dashed p-2 transition-colors ${
          dropActive ? "border-signal-500 bg-signal-50" : "border-transparent"
        }`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropActive(false);
          const files = Array.from(e.dataTransfer.files);
          for (const file of files) {
            const kind = file.type.startsWith("image/")
              ? "image"
              : file.type.startsWith("audio/")
                ? "audio"
                : "file";
            uploadMedia(file, kind);
          }
        }}
      >
        {blocks.length === 0 && (
          <p className="px-1 py-2 text-xs text-ink-300">{t.noBlocks}</p>
        )}

        {blocks.map((block, index) => (
          <BlockRow
            key={block.localId}
            dict={dict}
            block={block}
            index={index}
            total={blocks.length}
            dragging={dragging}
            materialId={materialId}
            onDragStart={() => setDragging(block.localId)}
            onDragEnd={() => setDragging(null)}
            onDropOn={() => {
              if (dragging) reorderTo(dragging, block.localId);
              setDragging(null);
            }}
            onMove={(dir) => move(block.localId, dir)}
            onRemove={() => remove(block.localId)}
            onRetry={() => retry(block.localId)}
            onCancelUpload={() => cancel(block.localId)}
            onEditText={() => setEditingText(block.localId)}
            onEditLink={() => setEditingLink(block.localId)}
            onChangeText={(value) => setText(block.localId, value)}
            onChangeLink={(value) => setLink(block.localId, value)}
            onDoneText={() => setEditingText(null)}
            onDoneLink={() => setEditingLink(null)}
            editingText={editingText === block.localId}
            editingLink={editingLink === block.localId}
            onReplace={() => {
              if (isMediaDraft(block)) pickFile(block.type, block.localId);
            }}
          />
        ))}

        {/* The compact "+" attachment interaction. */}
        <div className="relative flex items-center gap-2 pt-1">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={t.attachmentMenuLabel}
            title={t.attachmentMenuLabel}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-paper-raised text-lg font-semibold text-ink-600 transition-colors hover:border-signal-400 hover:text-signal-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500"
          >
            +
          </button>

          {menuOpen && (
            <div
              id={menuId}
              role="menu"
              aria-label={t.attachmentMenuLabel}
              className="flex flex-wrap items-center gap-1 rounded-md border border-ink-100 bg-paper-raised p-1 shadow-sm"
            >
              {(
                [
                  ["file", t.addFile],
                  ["image", t.addImage],
                  ["audio", t.addAudio],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    pickFile(kind);
                    setMenuOpen(false);
                  }}
                  className="rounded-sm px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-sunken hover:text-signal-600"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdding("text");
                  setMenuOpen(false);
                }}
                className="rounded-sm px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-sunken hover:text-signal-600"
              >
                {t.addText}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAdding("link");
                  setMenuOpen(false);
                }}
                className="rounded-sm px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-paper-sunken hover:text-signal-600"
              >
                {t.addLink}
              </button>
            </div>
          )}

          <span className="text-xs text-ink-300">{t.dropHint.replace("{max}", maxBytesLabel("file"))}</span>
        </div>

        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            onFilesPicked(e.target.files);
            e.target.value = "";
          }}
        />

        {adding === "text" && (
          <div className="flex flex-col gap-2">
            <Textarea
              autoFocus
              aria-label={t.addText}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              className="min-h-[72px]"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!draftText.trim()) return;
                  addText(draftText.trim());
                  setDraftText("");
                  setAdding(null);
                }}
              >
                {t.addBlock}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                {dict.common.cancel}
              </Button>
            </div>
          </div>
        )}

        {adding === "link" && (
          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              type="url"
              aria-label={t.addLink}
              placeholder="https://…"
              value={draftLink}
              onChange={(e) => setDraftLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!draftLink.trim()) return;
                  addLink(draftLink.trim());
                  setDraftLink("");
                  setAdding(null);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!draftLink.trim()) return;
                  addLink(draftLink.trim());
                  setDraftLink("");
                  setAdding(null);
                }}
              >
                {t.addBlock}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                {dict.common.cancel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BlockRow({
  dict,
  block,
  index,
  total,
  dragging,
  materialId,
  editingText,
  editingLink,
  onDragStart,
  onDragEnd,
  onDropOn,
  onMove,
  onRemove,
  onRetry,
  onCancelUpload,
  onEditText,
  onEditLink,
  onChangeText,
  onChangeLink,
  onDoneText,
  onDoneLink,
  onReplace,
}: {
  dict: Dictionary;
  block: BlockDraft;
  index: number;
  total: number;
  dragging: string | null;
  materialId?: string;
  editingText: boolean;
  editingLink: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onRetry: () => void;
  onCancelUpload: () => void;
  onEditText: () => void;
  onEditLink: () => void;
  onChangeText: (value: string) => void;
  onChangeLink: (value: string) => void;
  onDoneText: () => void;
  onDoneLink: () => void;
  onReplace: () => void;
}) {
  const t = dict.speaking;
  const kindLabel =
    block.type === "text"
      ? t.blockText
      : block.type === "link"
        ? t.blockLink
        : block.type === "image"
          ? t.blockImage
          : block.type === "audio"
            ? t.blockAudio
            : t.blockFile;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      className={`flex items-start gap-2 rounded-sm border bg-paper-sunken p-2 ${
        dragging === block.localId ? "border-signal-400 opacity-60" : "border-ink-100"
      }`}
    >
      {/* Drag handle — visual affordance; the buttons below are the accessible path. */}
      <span
        aria-hidden
        title={t.dragToReorder}
        className="mt-1 cursor-grab select-none text-xs leading-none text-ink-200"
      >
        ⠿
      </span>

      <div className="flex flex-col">
        <button
          type="button"
          disabled={index === 0}
          aria-label={`${t.moveBlockUp} — ${kindLabel}`}
          title={t.moveBlockUp}
          onClick={() => onMove(-1)}
          className="px-1 text-xs leading-tight text-ink-300 hover:text-ink-700 disabled:opacity-30"
        >
          ▲
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          aria-label={`${t.moveBlockDown} — ${kindLabel}`}
          title={t.moveBlockDown}
          onClick={() => onMove(1)}
          className="px-1 text-xs leading-tight text-ink-300 hover:text-ink-700 disabled:opacity-30"
        >
          ▼
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-200">{kindLabel}</p>

        {block.type === "text" &&
          (editingText ? (
            <div className="flex flex-col gap-2">
              <Textarea
                autoFocus
                aria-label={t.editText}
                value={block.textContent}
                onChange={(e) => onChangeText(e.target.value)}
                className="min-h-[72px]"
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onDoneText}>
                  {t.doneEditingText}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onEditText}
              className="w-full rounded-sm px-1 py-0.5 text-left text-sm whitespace-pre-line text-ink-700 hover:bg-paper"
            >
              {block.textContent}
            </button>
          ))}

        {block.type === "link" &&
          (editingLink ? (
            <div className="flex flex-col gap-2">
              <Input
                autoFocus
                type="url"
                aria-label={t.addLink}
                value={block.linkUrl}
                onChange={(e) => onChangeLink(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onDoneLink}>
                  {t.doneEditingText}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onEditLink}
              className="w-full truncate rounded-sm px-1 py-0.5 text-left text-sm text-signal-600 hover:bg-paper"
            >
              🔗 {block.linkUrl}
            </button>
          ))}

        {isMediaDraft(block) && (
          <MediaBlockBody
            dict={dict}
            block={block}
            materialId={materialId}
            onRetry={onRetry}
            onCancelUpload={onCancelUpload}
            onReplace={onReplace}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t.removeBlock} — ${kindLabel}`}
        title={t.removeBlock}
        className="mt-1 shrink-0 px-1 text-xs text-band-bad hover:underline"
      >
        ✕
      </button>
    </div>
  );
}

function MediaBlockBody({
  dict,
  block,
  materialId,
  onRetry,
  onCancelUpload,
  onReplace,
}: {
  dict: Dictionary;
  block: Extract<BlockDraft, { state: string }>;
  materialId?: string;
  onRetry: () => void;
  onCancelUpload: () => void;
  onReplace: () => void;
}) {
  const t = dict.speaking;
  const inFlight = block.state === "queued" || block.state === "uploading" || block.state === "finalizing";
  // While uploading there is no object to read yet, so a preview is either the
  // local blob URL (image) or nothing at all.
  const readUrl = block.objectKey
    ? `/api/resources/${block.objectKey}`
    : block.previewUrl;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {block.type === "image" && readUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={readUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-sm border border-ink-100 object-cover"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{block.originalName}</span>
        <span className="shrink-0 text-xs text-ink-300">{formatBytes(block.size)}</span>
      </div>

      {block.type === "audio" && block.state === "complete" && block.objectKey && (
        <audio controls preload="none" className="w-full" src={`/api/resources/${block.objectKey}`} />
      )}

      {inFlight && (
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100"
            role="progressbar"
            aria-valuenow={block.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.uploadState[block.state]}
          >
            <div className="h-full bg-signal-500 transition-none" style={{ width: `${block.progress}%` }} />
          </div>
          <span className="w-24 shrink-0 text-xs text-ink-300">
            {block.state === "finalizing"
              ? t.uploadState.finalizing
              : t.progressLabel.replace("{percent}", String(block.progress))}
          </span>
          <button type="button" onClick={onCancelUpload} className="shrink-0 text-xs text-ink-400 hover:text-band-bad">
            {t.cancelUpload}
          </button>
        </div>
      )}

      {block.state === "complete" && (
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xs text-band-good">
            ✓
          </span>
          <span className="text-xs text-band-good">{t.uploadState.complete}</span>
          {block.objectKey && (
            <span className="text-xs text-ink-300">
              {block.uploadId ? "" : t.keepAttachment}
            </span>
          )}
          <button type="button" onClick={onReplace} className="ml-auto text-xs text-signal-600 hover:underline">
            {t.replaceAttachment}
          </button>
        </div>
      )}

      {(block.state === "failed" || block.state === "cancelled") && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-band-bad">
            {t.uploadState[block.state]}
            {block.error ? ` — ${block.error}` : ""}
          </span>
          <button type="button" onClick={onRetry} className="text-xs text-signal-600 hover:underline">
            {t.retryUpload}
          </button>
        </div>
      )}
    </div>
  );
}
