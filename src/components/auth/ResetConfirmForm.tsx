"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label, FieldError } from "@/components/ui/Input";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

export function ResetConfirmForm({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await requestJson("/api/auth/reset/confirm", { body: { token, password } });
      if (!result.ok) {
        setError(failureMessage(result, dict.auth, { invalid_token: dict.errors.unknown }));
        return;
      }
      router.push("/login");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="password">{dict.auth.password}</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" disabled={pending || !token}>
        {pending ? dict.common.loading : dict.auth.resetConfirmCta}
      </Button>
      <Link href="/login" className="text-center text-sm font-medium text-signal-700 underline underline-offset-2">
        {dict.auth.loginCta}
      </Link>
    </form>
  );
}
