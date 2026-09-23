"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { BlockComposer } from "./BlockComposer";
import { PrimaryFileField, type PrimaryDraft } from "./PrimaryFileField";
import { draftsFromBlocks, useBlockDrafts } from "./useBlockDrafts";
import type { Dictionary } from "@/lib/i18n/en";
import type { materialBlocks, speakingMaterials } from "@/db/schema";

type Material = typeof speakingMaterials.$inferSelect;
type Block = typeof materialBlocks.$inferSelect;

/**
 * Edit an existing resource.
 *
 * The point of this form is that it does NOT re-upload anything the user did
 * not touch. Blocks the user leaves alone are sent back by their existing
 * objectKey, which the server recognises as "retained" and keeps. Only a
 * genuinely replaced attachment arrives as a new uploadId, and only that
 * object gets swapped. Reordering writes `position` and deletes nothing.
 */
export function EditMaterialForm({
  dict,
  material,
  blocks,
  onDone,
}: {
  dict: Dictionary;
  material: Material;
  blocks: Block[];
  onDone: () => void;
}) {
  const router = useRouter();
  const t = dict.speaking;

  const [title, setTitle] = useState(material.title);
  const [primary, setPrimary] = useState<PrimaryDraft>(() => initialPrimary(material));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const controller = useBlockDrafts({
    materialId: material.id,
    onError: setError,
  });
  const [initialized, setInitialized] = useState(false);
  if (!initialized) {
    controller.setInitial(draftsFromBlocks(blocks));
    setInitialized(true);
  }

  const primaryBusy =
    primary.mode === "upload" && (primary.state === "queued" || primary.state === "uploading" || primary.state === "finalizing");

  async function onSubmit() {
    setPending(true);
    setError("");
    setSaved(false);

    const blockPayload = controller.blocks
      .filter((b) => b.type !== "text" || b.textContent.trim())
      .filter((b) => b.type !== "link" || b.linkUrl.trim())
      .map((b) => {
        if (b.type === "text") return { type: "text" as const, textContent: b.textContent };
        if (b.type === "link") return { type: "link" as const, linkUrl: b.linkUrl };
        // A block that never finished uploading is omitted — sending it would
        // be sending a reference to an object that is not there.
        if (b.state !== "complete" || !b.objectKey) return null;
        return { type: b.type, ref: { uploadId: b.uploadId, objectKey: b.objectKey } };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);

    const primaryPayload =
      primary.mode === "link"
        ? primary.primaryUrl.startsWith("http")
          ? { mode: "link" as const, primaryType: "link" as const, primaryUrl: primary.primaryUrl }
          : null
        : primary.mode === "upload" && primary.state === "complete"
          ? {
              mode: "upload" as const,
              primaryType: "file" as const,
              ref: { uploadId: primary.uploadId, objectKey: primary.objectKey },
            }
          : null;

    const body: Record<string, unknown> = {
      title: title.trim(),
      blocks: blockPayload,
    };
    if (primaryPayload) body.primary = primaryPayload;

    const res = await fetch(`/api/speaking/materials/${material.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setPending(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      onDone();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t.saveFailed);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-sm border border-signal-200 bg-paper-raised p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-900">{t.editMaterial}</h3>
        <span className="text-xs text-ink-300">{t.reorderKeyboardHint}</span>
      </div>

      <div>
        <Label htmlFor={`edit-title-${material.id}`}>{t.titleField}</Label>
        <Input
          id={`edit-title-${material.id}`}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-700">{t.primaryFile}</legend>
        <PrimaryFileField
          dict={dict}
          value={primary}
          onChange={setPrimary}
          materialId={material.id}
          onError={setError}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-t border-ink-100 pt-3">
        <legend className="mb-1 text-sm font-medium text-ink-700">{t.description}</legend>
        <BlockComposer dict={dict} controller={controller} materialId={material.id} />
      </fieldset>

      {error && <p className="text-sm text-band-bad">{error}</p>}
      {saved && <p className="text-sm text-band-good">{t.savedAndRefreshed}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={pending || !title.trim() || primaryBusy || controller.anyUploading}
        >
          {pending ? dict.common.saving : dict.common.save}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {dict.common.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Seeds the primary field from the stored material without re-uploading. */
function initialPrimary(material: Material): PrimaryDraft {
  if (material.primaryType === "link" || !material.primaryObjectKey) {
    return { mode: "link", primaryUrl: material.primaryUrl };
  }
  return {
    mode: "upload",
    state: "complete",
    progress: 100,
    objectKey: material.primaryObjectKey,
    originalName: material.primaryOriginalName ?? material.title,
    mimeType: material.primaryMimeType ?? "application/octet-stream",
    size: material.primarySize ?? 0,
    retained: true,
  };
}
