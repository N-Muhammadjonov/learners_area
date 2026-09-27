"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label, FieldError } from "@/components/ui/Input";
import { TelegramIntentLogin } from "./TelegramIntentLogin";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

export function RegisterForm({
  dict,
  telegramConfigured,
  telegramBotUsername,
}: {
  dict: Dictionary;
  telegramConfigured: boolean;
  telegramBotUsername?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      // `requestJson` never throws: a dropped connection and a non-JSON error page
      // both come back as a value, so the button always leaves its loading state.
      const result = await requestJson<{ accountStatus?: string }>("/api/auth/register", {
        body: { name, email, password },
      });
      if (!result.ok) {
        setError(
          failureMessage(result, dict.auth, {
            email_taken: dict.auth.errorEmailTaken,
            invalid_input: dict.errors.unknown,
          })
        );
        return;
      }
      // A new account is PENDING until an administrator approves it, so the honest
      // destination is the waiting room, where the applicant can ask for access.
      router.push("/pending");
      router.refresh();
    } finally {
      // The only guarantee that matters: whatever happened above, the user is
      // looking at a button they can press again.
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="name">{dict.auth.name}</Label>
        <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="email">{dict.auth.email}</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
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
      <Button type="submit" disabled={pending}>
        {pending ? dict.common.loading : dict.auth.registerCta}
      </Button>
      <div className="relative py-1 text-center text-xs text-ink-300">
        <span className="relative bg-paper-raised px-2">or</span>
        <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-ink-100" />
      </div>
      <TelegramIntentLogin
        dict={dict}
        configured={telegramConfigured}
        botUsername={telegramBotUsername}
        purpose="register"
      />
    </form>
  );
}
