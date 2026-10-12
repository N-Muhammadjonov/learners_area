import { useCallback, useEffect, useRef, useState } from "react";
import { preflight, startUpload, type UploadHandle, type UploadState } from "@/lib/uploads/client";
import type { materialBlocks } from "@/db/schema";

/**
 * The composer's block state, shared by "create" and "edit" so both surfaces
 * behave identically. `localId` is a React-only identity; the persisted
 * identity is `objectKey` (or, for text/link, the content itself).
 *
 * Media blocks keep the originating `File` so a failed upload can be retried
 * without asking the user to pick it again.
 */
export type BlockDraft =
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
      /** Blob URL for the instant local preview, revoked once replaced/removed. */
      previewUrl?: string;
      error?: string;
      file?: File;
    };

export type MediaBlockDraft = Extract<BlockDraft, { state: UploadState }>;

function newLocalId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

export function isMediaDraft(block: BlockDraft): block is MediaBlockDraft {
  return block.type === "image" || block.type === "audio" || block.type === "file";
}

/** Converts stored blocks (edit mode) into drafts, without re-uploading them. */
export function draftsFromBlocks(blocks: (typeof materialBlocks.$inferSelect)[]): BlockDraft[] {
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((b) => {
      if (b.type === "text") {
        return { localId: newLocalId(), type: "text" as const, textContent: b.textContent ?? "" };
      }
      if (b.type === "link") {
        return { localId: newLocalId(), type: "link" as const, linkUrl: b.linkUrl ?? "" };
      }
      return {
        localId: newLocalId(),
        type: b.type,
        state: "complete" as const,
        progress: 100,
        objectKey: b.objectKey ?? undefined,
        originalName: b.originalName ?? "file",
        mimeType: b.mimeType ?? "application/octet-stream",
        size: b.size ?? undefined,
      };
    });
}

export type UseBlockDraftsOptions = {
  materialId?: string;
  onError?: (message: string) => void;
};

/**
 * Owns the ordered block list and the per-file upload state machines.
 *
 * A failed upload is never silently dropped, and a successful one is never
 * discarded by a later failure: each block carries its own state and the
 * caller decides what to submit (only `complete` blocks are serializable).
 */
export function useBlockDrafts({ materialId, onError }: UseBlockDraftsOptions = {}) {
  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const handles = useRef(new Map<string, UploadHandle>());
  const alive = useRef(true);

  // Revoke every outstanding upload and blob URL on unmount — an image preview
  // must not leak for the lifetime of the tab.
  useEffect(() => {
    alive.current = true;
    const live = handles.current;
    return () => {
      alive.current = false;
      for (const handle of live.values()) handle.cancel();
      live.clear();
    };
  }, []);

  const patch = useCallback((localId: string, changes: Partial<MediaBlockDraft>) => {
    if (!alive.current) return;
    setBlocks((prev) => prev.map((b) => (b.localId === localId && isMediaDraft(b) ? { ...b, ...changes } : b)));
  }, []);

  const launch = useCallback(
    (localId: string, file: File, kind: "image" | "audio" | "file") => {
      const handle = startUpload(file, {
        purpose: "material_block",
        blockKind: kind,
        materialId,
        onState: (state) => patch(localId, { state }),
        onProgress: (progress) => patch(localId, { progress }),
      });
      handles.current.set(localId, handle);

      void handle.promise.then((outcome) => {
        if (!alive.current || handles.current.get(localId) !== handle) return;
        handles.current.delete(localId);
        if (outcome.ok) {
          setBlocks((prev) =>
            prev.map((b) => {
              if (b.localId !== localId || !isMediaDraft(b)) return b;
              if (b.previewUrl) URL.revokeObjectURL(b.previewUrl);
              return {
                ...b,
                state: "complete",
                progress: 100,
                uploadId: outcome.uploadId,
                objectKey: outcome.objectKey,
                previewUrl: undefined,
                error: undefined,
              };
            })
          );
        } else {
          patch(localId, {
            state: outcome.error === "cancelled" ? "cancelled" : "failed",
            error: outcome.error,
          });
        }
      });
    },
    [materialId, patch]
  );

  const uploadMedia = useCallback(
    (file: File, kind: "image" | "audio" | "file") => {
      const pre = preflight(file, kind);
      if (!pre.ok) {
        onError?.(pre.error);
        return;
      }

      const localId = newLocalId();
      const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;

      setBlocks((prev) => [
        ...prev,
        {
          localId,
          type: kind,
          state: "queued",
          progress: 0,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          previewUrl,
          file,
        },
      ]);

      launch(localId, file, kind);
    },
    [launch, onError]
  );

  const replaceMedia = useCallback(
    (localId: string, file: File) => {
      const draft = blocks.find((b) => b.localId === localId);
      if (!draft || !isMediaDraft(draft)) return;
      const kind = draft.type;

      const pre = preflight(file, kind);
      if (!pre.ok) {
        onError?.(pre.error);
        return;
      }

      handles.current.get(localId)?.cancel();
      handles.current.delete(localId);
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);

      patch(localId, {
        state: "queued",
        progress: 0,
        uploadId: undefined,
        objectKey: undefined,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        error: undefined,
        file,
      });

      launch(localId, file, kind);
    },
    [blocks, launch, onError, patch]
  );

  const retry = useCallback(
    (localId: string) => {
      const draft = blocks.find((b) => b.localId === localId);
      if (!draft || !isMediaDraft(draft) || !draft.file) return;
      handles.current.get(localId)?.cancel();
      handles.current.delete(localId);
      patch(localId, { state: "queued", progress: 0, error: undefined });
      launch(localId, draft.file, draft.type);
    },
    [blocks, launch, patch]
  );

  const cancel = useCallback(
    (localId: string) => {
      handles.current.get(localId)?.cancel();
      handles.current.delete(localId);
      patch(localId, { state: "cancelled" });
    },
    [patch]
  );

  const addText = useCallback((text: string) => {
    setBlocks((prev) => [...prev, { localId: newLocalId(), type: "text", textContent: text }]);
  }, []);

  const addLink = useCallback((url: string) => {
    setBlocks((prev) => [...prev, { localId: newLocalId(), type: "link", linkUrl: url }]);
  }, []);

  const setText = useCallback((localId: string, textContent: string) => {
    setBlocks((prev) => prev.map((b) => (b.localId === localId && b.type === "text" ? { ...b, textContent } : b)));
  }, []);

  const setLink = useCallback((localId: string, linkUrl: string) => {
    setBlocks((prev) => prev.map((b) => (b.localId === localId && b.type === "link" ? { ...b, linkUrl } : b)));
  }, []);

  const remove = useCallback((localId: string) => {
    setBlocks((prev) => {
      const target = prev.find((b) => b.localId === localId);
      if (target && isMediaDraft(target) && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((b) => b.localId !== localId);
    });
    handles.current.get(localId)?.cancel();
    handles.current.delete(localId);
  }, []);

  const move = useCallback((localId: string, direction: -1 | 1) => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.localId === localId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }, []);

  /** Drag-and-drop reorder (desktop). The buttons remain the accessible path. */
  const reorderTo = useCallback((fromLocalId: string, toLocalId: string) => {
    if (fromLocalId === toLocalId) return;
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.localId === fromLocalId);
      const to = prev.findIndex((b) => b.localId === toLocalId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  const setInitial = useCallback((drafts: BlockDraft[]) => setBlocks(drafts), []);

  const anyUploading = blocks.some(
    (b) => isMediaDraft(b) && (b.state === "queued" || b.state === "uploading" || b.state === "finalizing")
  );

  return {
    blocks,
    anyUploading,
    uploadMedia,
    retry,
    cancel,
    addText,
    addLink,
    setText,
    setLink,
    remove,
    move,
    reorderTo,
    replaceMedia,
    setInitial,
  };
}

export type BlockDraftController = ReturnType<typeof useBlockDrafts>;
