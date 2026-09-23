"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import { uploadFileWithProgress } from "@/lib/uploadWithProgress";
import type { Dictionary } from "@/lib/i18n/en";

type Category = "part1" | "part2" | "part3" | "general" | "shadowing" | "top_structures";

type BlockDraft =
  | { localId: string; type: "text"; textContent: string }
  | { localId: string; type: "link"; linkUrl: string }
  | {
      localId: string;
      type: "image" | "audio" | "file";
      state: "uploading" | "done" | "error";
      progress: number;
      objectUrl?: string;
      objectKey?: string;
      originalName: string;
      mimeType: string;
      size?: number;
      previewUrl?: string; // local blob: URL for instant preview, revoked on completion
      error?: string;
    };

function newId() {
  return Math.random().toString(36).slice(2);
}

export function NewMaterialForm({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("part1");
  const [title, setTitle] = useState("");

  const [primarySourceMode, setPrimarySourceMode] = useState<"upload" | "link">("upload");
  const [primaryType, setPrimaryType] = useState<"video" | "audio" | "file" | "link">("video");
  const [primaryUrl, setPrimaryUrl] = useState("");
  const [primaryMeta, setPrimaryMeta] = useState<{ objectKey?: string; originalName?: string; mimeType?: string; size?: number }>({});
  const [primaryUploading, setPrimaryUploading] = useState(false);
  const [primaryProgress, setPrimaryProgress] = useState(0);
  const [primaryName, setPrimaryName] = useState("");

  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const [addingType, setAddingType] = useState<"text" | "link" | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftLink, setDraftLink] = useState("");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const primaryInputRef = useRef<HTMLInputElement>(null);
  const blockFileInputRef = useRef<HTMLInputElement>(null);
  const pendingBlockKindRef = useRef<"image" | "audio" | "file">("file");

  if (!open) return <Button onClick={() => setOpen(true)}>+ {dict.speaking.newMaterial}</Button>;

  async function uploadPrimary(file: File) {
    setPrimaryUploading(true);
    setPrimaryProgress(0);
    setError("");
    const { promise } = uploadFileWithProgress(file, "speaking", setPrimaryProgress);
    try {
      const res = await promise;
      setPrimaryUrl(res.url);
      setPrimaryType(res.type);
      setPrimaryMeta({ objectKey: res.key, originalName: file.name, mimeType: file.type, size: file.size });
      setPrimaryName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPrimaryUploading(false);
    }
  }

  function addTextBlock() {
    if (!draftText.trim()) return;
    setBlocks((prev) => [...prev, { localId: newId(), type: "text", textContent: draftText.trim() }]);
    setDraftText("");
    setAddingType(null);
  }

  function addLinkBlock() {
    if (!draftLink.trim()) return;
    setBlocks((prev) => [...prev, { localId: newId(), type: "link", linkUrl: draftLink.trim() }]);
    setDraftLink("");
    setAddingType(null);
  }

  function pickBlockFile(kind: "image" | "audio" | "file") {
    pendingBlockKindRef.current = kind;
    if (blockFileInputRef.current) {
      blockFileInputRef.current.accept = kind === "image" ? "image/*" : kind === "audio" ? "audio/*" : "*/*";
      blockFileInputRef.current.click();
    }
  }

  function onBlockFileSelected(file: File) {
    const kind = pendingBlockKindRef.current;
    const localId = newId();
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;

    setBlocks((prev) => [
      ...prev,
      { localId, type: kind, state: "uploading", progress: 0, originalName: file.name, mimeType: file.type, previewUrl },
    ]);

    const { promise } = uploadFileWithProgress(file, "speaking", (pct) => {
      setBlocks((prev) => prev.map((b) => (b.localId === localId && "progress" in b ? { ...b, progress: pct } : b)));
    });

    promise
      .then((res) => {
        setBlocks((prev) =>
          prev.map((b) =>
            b.localId === localId && "state" in b
              ? { ...b, state: "done", objectUrl: res.url, objectKey: res.key, size: file.size }
              : b
          )
        );
      })
      .catch((err) => {
        setBlocks((prev) =>
          prev.map((b) =>
            b.localId === localId && "state" in b
              ? { ...b, state: "error", error: err instanceof Error ? err.message : "Upload failed" }
              : b
          )
        );
      });
  }

  function removeBlock(localId: string) {
    setBlocks((prev) => {
      const target = prev.find((b) => b.localId === localId);
      if (target && "previewUrl" in target && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((b) => b.localId !== localId);
    });
  }

  function moveBlock(localId: string, dir: -1 | 1) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.localId === localId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  const blocksStillUploading = blocks.some((b) => "state" in b && b.state === "uploading");
  const canSubmit = !!primaryUrl && !primaryUploading && !blocksStillUploading && !!title;

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        const res = await fetch("/api/speaking/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            title,
            primaryType,
            primaryUrl,
            ...primaryMeta,
            blocks: blocks
              .filter((b) => b.type !== "text" || b.textContent)
              .filter((b) => !("state" in b) || b.state === "done")
              .map((b) => {
                if (b.type === "text") return { type: "text", textContent: b.textContent };
                if (b.type === "link") return { type: "link", linkUrl: b.linkUrl };
                return {
                  type: b.type,
                  objectUrl: b.objectUrl,
                  objectKey: b.objectKey,
                  originalName: b.originalName,
                  mimeType: b.mimeType,
                  size: b.size,
                };
              }),
          }),
        });
        setPending(false);
        if (res.ok) {
          setOpen(false);
          router.refresh();
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Could not save");
        }
      }}
    >
      {/* Primary file */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="category">Section</Label>
          <select id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {(["part1", "part2", "part3", "general", "top_structures", "shadowing"] as const).map((c) => (
              <option key={c} value={c}>{dict.speaking.category[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>

      <div>
        <Label>Primary file</Label>
        <div className="mb-1.5 flex overflow-hidden rounded-sm border border-ink-100 text-xs font-medium">
          <button type="button" onClick={() => { setPrimarySourceMode("upload"); setPrimaryUrl(""); }}
            className={`flex-1 px-3 py-1.5 ${primarySourceMode === "upload" ? "bg-signal-600 text-white" : "bg-paper-raised text-ink-500"}`}>
            Upload
          </button>
          <button type="button" onClick={() => { setPrimarySourceMode("link"); setPrimaryUrl(""); }}
            className={`flex-1 px-3 py-1.5 ${primarySourceMode === "link" ? "bg-signal-600 text-white" : "bg-paper-raised text-ink-500"}`}>
            Link
          </button>
        </div>

        {primarySourceMode === "upload" ? (
          <div>
            <input
              ref={primaryInputRef}
              type="file"
              accept="video/*,audio/*,application/pdf,image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPrimary(f); }}
            />
            {!primaryUrl && !primaryUploading && (
              <Button type="button" variant="secondary" onClick={() => primaryInputRef.current?.click()}>
                Choose file…
              </Button>
            )}
            {primaryUploading && (
              <div className="card flex items-center gap-3 p-3 text-sm">
                <span className="flex-1 truncate">{primaryName}</span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full bg-signal-500" style={{ width: `${primaryProgress}%` }} />
                </div>
                <span className="w-9 text-right text-xs text-ink-300">{primaryProgress}%</span>
              </div>
            )}
            {primaryUrl && !primaryUploading && (
              <div className="card flex items-center gap-2 p-3 text-sm">
                <span aria-hidden className="text-band-good">✓</span>
                <span className="flex-1 truncate">{primaryName}</span>
                <button type="button" onClick={() => { setPrimaryUrl(""); setPrimaryName(""); }} className="text-xs text-band-bad hover:underline">
                  Remove
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <select className="input" value={primaryType} onChange={(e) => setPrimaryType(e.target.value as typeof primaryType)}>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="file">File</option>
              <option value="link">Link</option>
            </select>
            <Input type="url" required placeholder="https://..." value={primaryUrl} onChange={(e) => setPrimaryUrl(e.target.value)} />
            <p className="text-xs text-ink-300">{dict.speaking.primaryUrlHelp}</p>
          </div>
        )}
      </div>

      {/* Description blocks */}
      <div className="flex flex-col gap-2 border-t border-ink-100 pt-3">
        <Label>Description</Label>

        <input
          ref={blockFileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onBlockFileSelected(f); e.target.value = ""; }}
        />

        {blocks.map((b, i) => (
          <div key={b.localId} className="flex items-start gap-2 rounded-sm bg-paper-sunken p-2">
            <div className="flex flex-col">
              <button type="button" disabled={i === 0} onClick={() => moveBlock(b.localId, -1)} className="text-xs text-ink-300 hover:text-ink-700 disabled:opacity-30">▲</button>
              <button type="button" disabled={i === blocks.length - 1} onClick={() => moveBlock(b.localId, 1)} className="text-xs text-ink-300 hover:text-ink-700 disabled:opacity-30">▼</button>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              {b.type === "text" && <p className="whitespace-pre-line text-ink-700">{b.textContent}</p>}
              {b.type === "link" && <p className="truncate text-signal-600">🔗 {b.linkUrl}</p>}
              {(b.type === "image" || b.type === "audio" || b.type === "file") && (
                <div className="flex items-center gap-2">
                  {b.previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.previewUrl} alt="" className="h-10 w-10 rounded-sm object-cover" />
                  )}
                  <span className="truncate">{b.originalName}</span>
                  {b.state === "uploading" && <span className="text-xs text-ink-300">{b.progress}%</span>}
                  {b.state === "done" && <span className="text-band-good">✓</span>}
                  {b.state === "error" && <span className="text-xs text-band-bad">{b.error}</span>}
                </div>
              )}
            </div>
            <button type="button" onClick={() => removeBlock(b.localId)} className="text-xs text-band-bad hover:underline">
              ✕
            </button>
          </div>
        ))}

        {addingType === "text" && (
          <div className="flex flex-col gap-2">
            <Textarea autoFocus value={draftText} onChange={(e) => setDraftText(e.target.value)} className="min-h-[60px]" />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={addTextBlock}>Add</Button>
              <Button type="button" variant="ghost" onClick={() => setAddingType(null)}>{dict.common.cancel}</Button>
            </div>
          </div>
        )}
        {addingType === "link" && (
          <div className="flex flex-col gap-2">
            <Input autoFocus type="url" placeholder="https://..." value={draftLink} onChange={(e) => setDraftLink(e.target.value)} />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={addLinkBlock}>Add</Button>
              <Button type="button" variant="ghost" onClick={() => setAddingType(null)}>{dict.common.cancel}</Button>
            </div>
          </div>
        )}

        {!addingType && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => setAddingType("text")} className="text-xs text-signal-600 hover:underline">+ Text</button>
            <button type="button" onClick={() => pickBlockFile("image")} className="text-xs text-signal-600 hover:underline">+ Image</button>
            <button type="button" onClick={() => pickBlockFile("audio")} className="text-xs text-signal-600 hover:underline">+ Audio</button>
            <button type="button" onClick={() => pickBlockFile("file")} className="text-xs text-signal-600 hover:underline">+ File</button>
            <button type="button" onClick={() => setAddingType("link")} className="text-xs text-signal-600 hover:underline">+ Link</button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-band-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !canSubmit}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
