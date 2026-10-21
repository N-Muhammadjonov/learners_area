"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Dictionary } from "@/lib/i18n/en";
import type { Entry, Sense } from "@/lib/dictionary/model";
import { dictionaryPos } from "@/lib/dictionary/labels";

export type DictionaryFolder = { id: string; name: string; count?: number };
export function DictionaryFolderDialog({
  dict,
  entry,
  sense,
  folders,
  saving,
  onClose,
  onSave,
  onCreate,
}: {
  dict: Dictionary;
  entry: Entry;
  sense: Sense;
  folders: DictionaryFolder[];
  saving: boolean;
  onClose: () => void;
  onSave: (folderId: string | null) => Promise<void>;
  onCreate: (name: string) => Promise<DictionaryFolder>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [folder, setFolder] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const t = dict.globalDictionary;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="dictionary-folder-dialog"
      aria-labelledby="dictionary-folder-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving && !pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving && !pending)
          onClose();
      }}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2
            id="dictionary-folder-title"
            className="font-display text-xl font-semibold"
          >
            {t.folder}
          </h2>
          <button
            type="button"
            className="btn-ghost min-h-11 min-w-11"
            aria-label={t.close}
            disabled={saving || pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="rounded-xl border border-ink-100 p-3">
          <strong className="text-xl">{entry.display_lemma}</strong>
          <p className="mt-1 text-sm text-ink-500">
            {[
              ...entry.pronunciations.map((p) => p.ipa),
              dictionaryPos(entry.part_of_speech),
              entry.lexical_type,
              sense.cefr,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-2 text-sm">
            {sense.translations.map((item) => item.text).join(" · ")}
          </p>
        </div>
        <label className="flex flex-col gap-2">{t.folder}
          <select className="input w-full" aria-label={t.folder} value={folder} onChange={event=>setFolder(event.target.value)} disabled={saving||pending} data-dictionary-folder-select>
            <option value="">{t.defaultFolder}</option>
            {folders.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {creating ? (
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!name.trim() || pending) return;
              setPending(true);
              setError("");
              try {
                const created = await onCreate(name.trim());
                setFolder(created.id);
                setCreating(false);
                setName("");
              } catch {
                setError(t.unavailable);
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="block text-sm">
              {t.folderName}
              <input
                autoFocus
                className="input mt-1 w-full"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn-secondary"
              disabled={pending || !name.trim()}
            >
              {pending ? dict.common.loading : t.createFolder}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn-secondary justify-start"
            onClick={() => setCreating(true)}
          >
            ＋ {t.newFolder}
          </button>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn-primary min-h-11 w-full"
          disabled={saving || pending}
          onClick={async () => {
            setError("");
            try {
              await onSave(folder || null);
            } catch {
              setError(t.unavailable);
            }
          }}
        >
          {saving ? dict.common.loading : t.confirmFolder}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
