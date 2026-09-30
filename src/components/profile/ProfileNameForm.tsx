"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { IconUser } from "@/components/ui/icons";
import { Input, Label } from "@/components/ui/Input";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

export function ProfileNameForm({ dict, initialName }: { dict: Dictionary; initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const result = await requestJson<{ name: string }>("/api/profile", {
        method: "PATCH",
        body: { name },
      });
      if (!result.ok) {
        setError(failureMessage(result, dict.auth, {
          invalid_input: dict.profile.failed,
          not_found: dict.profile.failed,
          unauthenticated: dict.errors.forbidden,
        }));
        return;
      }
      setName(result.data.name);
      setSavedName(result.data.name);
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" data-profile-name-form>
      <div>
        <Label htmlFor="profile-name">{dict.profile.displayName}</Label>
        <Input
          id="profile-name"
          name="name"
          autoComplete="name"
          minLength={2}
          maxLength={200}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
        />
      </div>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      {saved && <p role="status" className="text-sm text-band-good">{dict.profile.saved}</p>}
      <Button type="submit" disabled={pending || name.trim() === savedName}>
        {pending ? dict.profile.saving : dict.profile.saveName}
      </Button>
    </form>
  );
}

/**
 * The profile page's name control.
 *
 * The owner asked for the edit action to be explicit and reachable from the top
 * right rather than a form that is simply always open: the card shows the name
 * that is actually stored, "Edit name" / "Ismni tahrirlash" reveals the real
 * form (the same one, with the same PATCH /api/profile contract), and the same
 * button cancels. The Profile menu links into the revealed state, so the flow is
 * one press from anywhere in the product.
 */
export function ProfileNameEditor({
  dict,
  initialName,
  initiallyEditing = false,
}: {
  dict: Dictionary;
  initialName: string;
  initiallyEditing?: boolean;
}) {
  const [editing, setEditing] = useState(initiallyEditing);

  return (
    <section className="panel flex flex-col gap-4" data-profile-name-card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-ink-300">{dict.profile.displayName}</p>
          <p className="truncate font-display text-lg text-ink-900" data-profile-current-name>
            {initialName}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          data-profile-edit-name
          aria-expanded={editing}
          aria-controls="profile-name-form"
          onClick={() => setEditing((value) => !value)}
        >
          <IconUser className="text-[18px]" />
          {editing ? dict.common.cancel : dict.profile.editName}
        </Button>
      </div>
      {editing && (
        <div id="profile-name-form" data-profile-name-editor>
          <ProfileNameForm dict={dict} initialName={initialName} />
        </div>
      )}
    </section>
  );
}
