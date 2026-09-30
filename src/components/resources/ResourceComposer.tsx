"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { IconClose, IconChevronDown, IconAlert } from "@/components/ui/icons";
import { acceptAttribute, maxBytesLabel } from "@/lib/validation/uploads";
import { preflight, startUpload, type UploadState } from "@/lib/uploads/client";
import { formatBytes } from "@/lib/uploads/format";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The universal material composer.
 *
 * Telegram-shaped and shared: one ordered list of blocks — text, link, image,
 * audio, file — that can be attached to a lesson, a reading passage, a listening
 * test, a writing prompt, a speaking material, a grammar topic, an assignment or
 * a live class. Modules no longer grow their own uploader; the difference between
 * them is the `ownerType` string and nothing else.
 *
 * What it will not do:
 *   - it never invents an upload. Every file goes through the existing private
 *     lifecycle (intent → PUT → finalize) and shows the real byte progress, and a
 *     failed file keeps its error and offers a retry rather than a spinner;
 *   - it never sends an object key the server did not issue: a stored file is
 *     re-sent as a retained key, and the server checks it against the blocks it
 *     already has (`claimAttachment`);
 *   - it never claims success. The list is only marked saved after the server
 *     answers with the stored blocks.
 */

type Draft =
  | { localId: string; type: "text"; textContent: string }
  | { localId: string; type: "link"; linkUrl: string }
  | {
      localId: string;
      type: "image" | "audio" | "file";
      state: UploadState;
      progress: number;
      uploadId?: string;
      objectKey?: string;
      originalName: string;
      mimeType: string;
      size?: number;
      error?: string;
      file?: File;
    };

import type { ResourceBlockView } from "@/lib/data/resources";

const newId = () => `b_${Math.random().toString(36).slice(2, 10)}`;

export function ResourceComposer({
  dict,
  ownerType,
  ownerId,
  initial,
  title,
}: {
  dict: Dictionary;
  ownerType: string;
  ownerId: string;
  initial: ResourceBlockView[];
  title?: string;
}) {
  const t = dict.resources;
  const [blocks, setBlocks] = useState<Draft[]>(() =>
    [...initial]
      .sort((a, b) => a.position - b.position)
      .map<Draft>((block) => {
        if (block.type === "text") {
          return { localId: newId(), type: "text", textContent: block.textContent ?? "" };
        }
        if (block.type === "link") {
          return { localId: newId(), type: "link", linkUrl: block.linkUrl ?? "" };
        }
        return {
          localId: newId(),
          type: block.type as "image" | "audio" | "file",
          state: "complete",
          progress: 100,
          objectKey: block.objectKey ?? undefined,
          originalName: block.originalName ?? "file",
          mimeType: block.mimeType ?? "application/octet-stream",
          size: block.size ?? undefined,
        };
      })
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropped, setDropped] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // State, not a ref: the `accept` attribute is part of the rendered element, and
  // a ref would leave the picker filtering for the previously chosen kind.
  const [pickKind, setPickKind] = useState<"image" | "audio" | "file">("file");

  function addText() {
    setBlocks((prev) => [...prev, { localId: newId(), type: "text", textContent: "" }]);
    setState("idle");
  }

  function addLink() {
    setBlocks((prev) => [...prev, { localId: newId(), type: "link", linkUrl: "" }]);
    setState("idle");
  }

  function move(localId: string, direction: -1 | 1) {
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.localId === localId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
    setState("idle");
  }

  function remove(localId: string) {
    setBlocks((prev) => prev.filter((block) => block.localId !== localId));
    setState("idle");
  }

  /** Upload one file through the real lifecycle, reporting real progress. */
  async function upload(file: File, kind: "image" | "audio" | "file", replaceId?: string) {
    const localId = replaceId ?? newId();
    setBlocks((prev) => {
      const draft: Draft = {
        localId,
        type: kind,
        state: "queued",
        progress: 0,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        file,
      };
      return replaceId
        ? prev.map((block) => (block.localId === replaceId ? draft : block))
        : [...prev, draft];
    });
    setState("idle");

    function update(patch: Partial<Extract<Draft, { state: UploadState }>>) {
      setBlocks((prev) =>
        prev.map((block) =>
          block.localId === localId && "state" in block ? { ...block, ...patch } : block
        )
      );
    }

    // Pre-flight first: a file that is the wrong type or too large is refused
    // before a single byte moves, with the real limit in the message.
    const check = preflight(file, kind);
    if (!check.ok) {
      update({ state: "failed", error: check.error });
      return;
    }

    const handle = startUpload(file, {
      purpose: "material_block",
      blockKind: kind,
      onState: (next) => update({ state: next }),
      onProgress: (progress) => update({ progress }),
    });
    const result = await handle.promise;

    if (result.ok) {
      update({ state: "complete", progress: 100, uploadId: result.uploadId, objectKey: result.objectKey });
    } else {
      // The file itself is kept, so "Retry" re-sends it without a re-pick.
      update({ state: "failed", error: result.error });
    }
  }

  async function retry(localId: string) {
    const block = blocks.find((item) => item.localId === localId);
    if (!block || !("state" in block) || !block.file) return;
    await upload(block.file, block.type, localId);
  }

  async function save() {
    setState("saving");
    setMessage(null);
    try {
      const payload = blocks
        .filter((block) => !("state" in block) || block.state === "complete")
        .map((block) => {
          if (block.type === "text") return { type: "text" as const, textContent: block.textContent };
          if (block.type === "link") return { type: "link" as const, linkUrl: block.linkUrl };
          return {
            type: block.type,
            uploadId: block.uploadId ?? null,
            objectKey: block.uploadId ? null : (block.objectKey ?? null),
          };
        });

      const res = await fetch(`/api/materials/${ownerType}/${ownerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: payload }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { blocks: ResourceBlockView[] };
      // The server's answer is the truth: positions and metadata come back as stored.
      setBlocks(
        data.blocks.map<Draft>((block) => {
          if (block.type === "text") return { localId: newId(), type: "text", textContent: block.textContent ?? "" };
          if (block.type === "link") return { localId: newId(), type: "link", linkUrl: block.linkUrl ?? "" };
          return {
            localId: newId(),
            type: block.type as "image" | "audio" | "file",
            state: "complete",
            progress: 100,
            objectKey: block.objectKey ?? undefined,
            originalName: block.originalName ?? "file",
            mimeType: block.mimeType ?? "application/octet-stream",
            size: block.size ?? undefined,
          };
        })
      );
      setState("saved");
    } catch {
      setState("error");
      setMessage(t.saveFailed);
    }
  }

  const saving = state === "saving";
  const failedUploads = blocks.filter((block) => "state" in block && block.state === "failed").length;

  return (
    <section className="panel flex flex-col gap-3" data-resource-composer={ownerType}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="card-title">{title ?? t.title}</h2>
          <p className="meta-text">{t.hint}</p>
        </div>
        <div className="relative">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            data-composer-add
            onClick={() => setMenuOpen((open) => !open)}
          >
            + {t.add}
            <IconChevronDown className="text-[16px]" />
          </button>
          {menuOpen && (
            <ul
              className="absolute right-0 z-[var(--z-dropdown)] mt-2 w-48 overflow-hidden rounded-sm border border-ink-100 bg-paper-raised py-1 shadow-card"
              role="menu"
            >
              {(
                [
                  { key: "text", label: t.addText, run: addText },
                  { key: "link", label: t.addLink, run: addLink },
                  {
                    key: "image",
                    label: t.addImage,
                    run: () => {
                      setPickKind("image");
                      fileInput.current?.click();
                    },
                  },
                  {
                    key: "audio",
                    label: t.addAudio,
                    run: () => {
                      setPickKind("audio");
                      fileInput.current?.click();
                    },
                  },
                  {
                    key: "file",
                    label: t.addFile,
                    run: () => {
                      setPickKind("file");
                      fileInput.current?.click();
                    },
                  },
                ] as const
              ).map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    role="menuitem"
                    data-composer-add-option={item.key}
                    className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ink-700 hover:bg-paper-sunken"
                    onClick={() => {
                      setMenuOpen(false);
                      item.run();
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        accept={acceptAttribute(pickKind)}
        data-composer-file
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file, pickKind);
          event.target.value = "";
        }}
      />

      {blocks.length === 0 ? (
        <p className="rounded-sm border border-dashed border-ink-100 px-3 py-4 text-sm text-ink-500" data-composer-empty>
          {t.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-composer-blocks>
          {blocks.map((block, index) => (
            <li
              key={block.localId}
              className="rounded-sm border border-ink-100 bg-paper-sunken/60 p-3"
              data-composer-block={block.type}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {block.type === "text"
                    ? t.blockText
                    : block.type === "link"
                      ? t.blockLink
                      : block.type === "image"
                        ? t.blockImage
                        : block.type === "audio"
                          ? t.blockAudio
                          : t.blockFile}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-sm text-ink-500 hover:bg-paper-raised disabled:opacity-40"
                    aria-label={t.moveUp}
                    disabled={index === 0}
                    data-composer-move="up"
                    onClick={() => move(block.localId, -1)}
                  >
                    <IconChevronDown className="rotate-180 text-[16px]" />
                  </button>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-sm text-ink-500 hover:bg-paper-raised disabled:opacity-40"
                    aria-label={t.moveDown}
                    disabled={index === blocks.length - 1}
                    data-composer-move="down"
                    onClick={() => move(block.localId, 1)}
                  >
                    <IconChevronDown className="text-[16px]" />
                  </button>
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-sm text-ink-500 hover:bg-paper-raised"
                    aria-label={t.remove}
                    data-composer-remove
                    onClick={() => remove(block.localId)}
                  >
                    <IconClose className="text-[16px]" />
                  </button>
                </span>
              </div>

              {block.type === "text" && (
                <Textarea
                  value={block.textContent}
                  placeholder={t.textPlaceholder}
                  maxLength={4000}
                  data-composer-text
                  onChange={(event) =>
                    setBlocks((prev) =>
                      prev.map((item) =>
                        item.localId === block.localId && item.type === "text"
                          ? { ...item, textContent: event.target.value }
                          : item
                      )
                    )
                  }
                />
              )}

              {block.type === "link" && (
                <Input
                  value={block.linkUrl}
                  placeholder="https://…"
                  inputMode="url"
                  data-composer-link
                  onChange={(event) =>
                    setBlocks((prev) =>
                      prev.map((item) =>
                        item.localId === block.localId && item.type === "link"
                          ? { ...item, linkUrl: event.target.value }
                          : item
                      )
                    )
                  }
                />
              )}

              {"state" in block && (
                <div className="flex flex-col gap-1.5" data-upload-state={block.state}>
                  <p className="text-sm text-ink-700">
                    {block.originalName}
                    {block.size ? ` · ${formatBytes(block.size)}` : ""}
                  </p>
                  {block.state === "failed" ? (
                    <p className="flex items-center gap-2 text-sm text-band-bad">
                      <IconAlert className="text-[15px]" />
                      {t.uploadFailed}
                      <button
                        type="button"
                        className="btn-secondary "
                        data-composer-retry
                        onClick={() => void retry(block.localId)}
                      >
                        {t.retry}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary "
                        onClick={() => remove(block.localId)}
                      >
                        {t.remove}
                      </button>
                    </p>
                  ) : block.state === "complete" ? (
                    <p className="text-xs text-ink-300">{t.uploaded}</p>
                  ) : (
                    <p className="text-xs text-ink-500">
                      {block.state === "finalizing" ? t.finalizing : t.uploading} {block.progress}%
                    </p>
                  )}
                  {block.state !== "complete" && block.state !== "failed" && (
                    <span className="h-1.5 overflow-hidden rounded-full bg-paper-raised">
                      <span
                        className="block h-full bg-signal-600 transition-[width]"
                        style={{ width: `${block.progress}%` }}
                      />
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving} data-composer-save>
          {saving ? dict.common.saving : dict.common.save}
        </Button>
        {state === "saved" && (
          <span className="text-sm text-band-good" data-composer-state="saved">
            {dict.common.saved}
          </span>
        )}
        {state === "error" && (
          <span className="text-sm text-band-bad" role="alert" data-composer-state="error">
            {message ?? t.saveFailed}
          </span>
        )}
        {failedUploads > 0 && state !== "error" && (
          <span className="text-sm text-band-bad">{t.failedUploads}</span>
        )}
        <span className="meta-text">{t.sizeLimit.replace("{size}", maxBytesLabel("file"))}</span>
      </div>

      {/* Dropping files onto the panel is a convenience, not the only path. */}
      <div
        className={`rounded-sm border border-dashed px-3 py-2 text-xs ${
          dropped ? "border-signal-600 text-signal-600" : "border-ink-100 text-ink-300"
        }`}
        data-composer-dropzone
        onDragOver={(event) => {
          event.preventDefault();
          setDropped(true);
        }}
        onDragLeave={() => setDropped(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropped(false);
          const file = event.dataTransfer.files?.[0];
          if (!file) return;
          const kind = file.type.startsWith("image/")
            ? "image"
            : file.type.startsWith("audio/")
              ? "audio"
              : "file";
          void upload(file, kind);
        }}
      >
        {t.dropHint}
      </div>
    </section>
  );
}
