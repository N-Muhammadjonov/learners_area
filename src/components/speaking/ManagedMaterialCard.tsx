"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { BlockRenderer } from "./BlockRenderer";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingMaterials, materialBlocks } from "@/db/schema";

type Material = typeof speakingMaterials.$inferSelect;
type Block = typeof materialBlocks.$inferSelect;

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
  const router = useRouter();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setPending(true);
    await fetch(`/api/speaking/materials/${material.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    router.refresh();
  }

  async function onDelete() {
    if (!confirm(`Delete "${material.title}"? This also removes its ${blocks.length} attachment(s) from storage.`)) return;
    setPending(true);
    await fetch(`/api/speaking/materials/${material.id}`, { method: "DELETE" });
    setPending(false);
    router.refresh();
  }

  return (
    <div className={`card flex flex-col gap-2 ${!material.isActive ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        {editingTitle ? (
          <div className="flex flex-1 items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" />
            <Button disabled={pending} onClick={async () => { await patch({ title }); setEditingTitle(false); }}>
              {dict.speaking.save}
            </Button>
            <Button variant="ghost" onClick={() => setEditingTitle(false)}>{dict.common.cancel}</Button>
          </div>
        ) : (
          <p className="text-sm font-medium text-ink-900">{material.title}</p>
        )}
        <span className="shrink-0 text-xs text-ink-300">
          {dict.speaking.category[material.category]} · {dict.speaking.postedBy}: {authorName}
        </span>
      </div>

      {blocks.length > 0 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="w-fit text-xs text-signal-600 hover:underline">
          {expanded ? "Hide" : "Show"} {blocks.length} attachment{blocks.length > 1 ? "s" : ""}
        </button>
      )}
      {expanded && (
        <div className="flex flex-col gap-2 rounded-sm bg-paper-sunken p-2">
          {blocks.map((b) => (
            <BlockRenderer key={b.id} block={b} openLabel={dict.speaking.openMaterial} />
          ))}
        </div>
      )}

      {canManage && !editingTitle && (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => setEditingTitle(true)}>{dict.speaking.edit}</Button>
          <Button variant="ghost" disabled={pending} onClick={() => patch({ isActive: !material.isActive })}>
            {material.isActive ? dict.speaking.deactivate : dict.speaking.activate}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onDelete} className="text-band-bad">
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
