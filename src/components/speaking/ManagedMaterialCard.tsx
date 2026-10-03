"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BlockRenderer } from "./BlockRenderer";
import { EditMaterialForm } from "./EditMaterialForm";
import type { Dictionary } from "@/lib/i18n/en";
import type { materialBlocks, speakingMaterials } from "@/db/schema";
import { apiErrorMessage } from "@/lib/api-error-message";

type Material = typeof speakingMaterials.$inferSelect;
type Block = typeof materialBlocks.$inferSelect;

/**
 * A managed resource in the teacher/admin list. Rename, activate/deactivate,
 * delete, and — the part that was missing before — a full edit form for the
 * primary file and every description block.
 */
export function ManagedMaterialCard({
  dict,
  material,
  blocks,
  authorName,
  canManage,
}: {
  dict: Dictionary;
  material: Material;
  blocks: Block[];
  authorName: string;
  canManage: boolean;
}) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    const res = await requestResponse(`/api/speaking/materials/${material.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res) return;
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(apiErrorMessage(data.error, res.status, dict));
      return;
    }
    router.refresh();
  }

  async function onDelete() {
    const confirmed = confirm(
      dict.speaking.confirmDelete
        .replace("{title}", material.title)
        .replace("{count}", String(blocks.length + (material.primaryObjectKey ? 1 : 0)))
    );
    if (!confirmed) return;
    setPending(true);
    setError(null);
    const res = await requestResponse(`/api/speaking/materials/${material.id}`, { method: "DELETE" }).catch(() => null);
    if (!res) return;
    setPending(false);
    if (!res || !res.ok) {
      // A failed delete used to be silent; now the staff member sees why (localised, no raw code).
      const data = res ? await res.json().catch(() => ({})) : {};
      setError(apiErrorMessage((data as { error?: string }).error, res?.status ?? 0, dict));
      return;
    }
    router.refresh();
  }

  return (
    <div className={`card flex flex-col gap-2 ${!material.isActive ? "opacity-50" : ""}`}>
      {error && <p role="alert" className="rounded-md border border-band-bad/40 bg-band-bad/10 p-2 text-sm text-band-bad" data-material-error>{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editingTitle ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-sm"
              aria-label={dict.speaking.titleField}
            />
            <Button
              disabled={pending}
              onClick={async () => {
                await patch({ title });
                setEditingTitle(false);
              }}
            >
              {dict.speaking.save}
            </Button>
            <Button variant="ghost" onClick={() => setEditingTitle(false)}>
              {dict.common.cancel}
            </Button>
          </div>
        ) : (
          <p className="text-sm font-medium text-ink-900">{material.title}</p>
        )}
        <span className="shrink-0 text-xs text-ink-300">
          {dict.speaking.category[material.category]} · {dict.speaking.postedBy}: {authorName}
        </span>
      </div>

      {blocks.length > 0 && !editingContent && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="btn-secondary w-fit"
        >
          {expanded ? "Hide" : "Show"} {blocks.length} attachment{blocks.length > 1 ? "s" : ""}
        </button>
      )}
      {expanded && !editingContent && (
        <div className="flex flex-col gap-2 rounded-sm bg-paper-sunken p-2">
          {blocks.map((b) => (
            <BlockRenderer key={b.id} block={b} openLabel={dict.speaking.openMaterial} emptyLabel={dict.speaking.noFileYet} />
          ))}
        </div>
      )}

      {editingContent && (
        <EditMaterialForm dict={dict} material={material} blocks={blocks} onDone={() => setEditingContent(false)} />
      )}

      {canManage && !editingTitle && !editingContent && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => setEditingContent(true)}>
            {dict.speaking.editBlocks}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setEditingTitle(true)}>
            {dict.speaking.edit}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => patch({ isActive: !material.isActive })}>
            {material.isActive ? dict.speaking.deactivate : dict.speaking.activate}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onDelete} className="text-band-bad">
            {dict.common.delete}
          </Button>
        </div>
      )}
    </div>
  );
}
