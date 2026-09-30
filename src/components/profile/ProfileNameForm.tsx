"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
    <form onSubmit={onSubmit} className="panel flex max-w-xl flex-col gap-4" data-profile-name-form>
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
