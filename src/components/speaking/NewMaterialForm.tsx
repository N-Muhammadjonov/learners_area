"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { describeUploadError } from "@/lib/uploads/errors";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { BlockComposer } from "./BlockComposer";
import { PrimaryFileField, type PrimaryDraft } from "./PrimaryFileField";
import { useBlockDrafts } from "./useBlockDrafts";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

type Category = "part1" | "part2" | "part3" | "general" | "shadowing" | "top_structures";

/**
 * Create a resource: primary file (or link) plus an ordered list of description
 * blocks. The composer is shared with the edit form, so what you see while
 * creating is exactly what you see while editing.
 */
export function NewMaterialForm({ dict }: { dict: Dictionary }) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();
  const t = dict.speaking;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("part1");
  const [title, setTitle] = useState("");
  const [primary, setPrimary] = useState<PrimaryDraft>({ mode: "empty" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const controller = useBlockDrafts({ onError: setError });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>+ {t.newMaterial}</Button>
    );
  }

  const primaryBusy = primary.mode === "upload" && (primary.state === "queued" || primary.state === "uploading" || primary.state === "finalizing");
  const canSubmit =
    !!title.trim() &&
    !pending &&
    !primaryBusy &&
    !controller.anyUploading &&
    (primary.mode === "link" ? primary.primaryUrl.startsWith("http") : primary.mode === "upload" && primary.state === "complete");

  async function onSubmit() {
    setPending(true);
    setError("");

    // Only blocks whose upload finished are serializable; text/link blocks
    // always are. A block that failed is left out rather than silently
    // dropped without telling the user — the error is already on screen.
    const blocks = controller.blocks
      .filter((b) => b.type !== "text" || b.textContent.trim())
      .filter((b) => b.type !== "link" || b.linkUrl.trim())
      .map((b) => {
        if (b.type === "text") return { type: "text" as const, textContent: b.textContent };
        if (b.type === "link") return { type: "link" as const, linkUrl: b.linkUrl };
        return { type: b.type, ref: { uploadId: b.uploadId, objectKey: b.objectKey } };
      });

    const primaryPayload =
      primary.mode === "link"
        ? { mode: "link" as const, primaryType: "link" as const, primaryUrl: primary.primaryUrl }
        : {
            mode: "upload" as const,
            primaryType: "file" as const,
            ref: { uploadId: primary.mode === "upload" ? primary.uploadId : undefined },
          };

    const res = await requestResponse("/api/speaking/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, title: title.trim(), primary: primaryPayload, blocks }),
    });
    if (!res) return;

    setPending(false);
    if (res.ok) {
      setOpen(false);
      setTitle("");
      setCategory("part1");
      setPrimary({ mode: "empty" });
      controller.setInitial([]);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(apiErrorMessage(data.error, res.status, dict));
    }
  }

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="new-material-category">{t.section}</Label>
          <select
            id="new-material-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {(["part1", "part2", "part3", "general", "top_structures", "shadowing"] as const).map((c) => (
              <option key={c} value={c}>
                {t.category[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="new-material-title">{t.titleField}</Label>
          <Input
            id="new-material-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-describedby="new-material-title-help"
          />
          <p id="new-material-title-help" className="mt-1 text-xs text-ink-300">
            {t.titleRequired}
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-700">{t.primaryFile}</legend>
        <PrimaryFileField dict={dict} value={primary} onChange={setPrimary} onError={setError} />
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-t border-ink-100 pt-3">
        <legend className="mb-1 text-sm font-medium text-ink-700">{t.description}</legend>
        <BlockComposer dict={dict} controller={controller} />
      </fieldset>

      {error && <p className="text-sm text-band-bad">{describeUploadError(error, dict.uploadErrors)}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {pending ? dict.common.saving : dict.common.save}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </form>
  );
}
