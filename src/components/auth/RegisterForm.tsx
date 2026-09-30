"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label, FieldError } from "@/components/ui/Input";
import { TelegramButton } from "./TelegramButton";
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
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [genderError, setGenderError] = useState(false);
  const firstGender = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gender) {
      setGenderError(true);
      firstGender.current?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      // `requestJson` never throws: a dropped connection and a non-JSON error page
      // both come back as a value, so the button always leaves its loading state.
      const result = await requestJson<{ accountStatus?: string }>("/api/auth/register", {
        body: { name, email, password, gender },
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
      <fieldset>
        <legend id="gender-label" className="mb-1.5 text-sm font-medium text-ink-700">{dict.auth.chooseGender}</legend>
        <div className="gender-segments" role="radiogroup" aria-labelledby="gender-label" aria-required="true" aria-invalid={genderError} aria-describedby={genderError ? "gender-error" : undefined}>
          {(["male", "female"] as const).map((value) => (
            <label key={value}>
              <input
                ref={value === "male" ? firstGender : undefined}
                type="radio"
                name="gender"
                value={value}
                required
                checked={gender === value}
                aria-describedby={genderError ? "gender-error" : undefined}
                onInvalid={(event) => {
                  event.preventDefault();
                  setGenderError(true);
                  firstGender.current?.focus();
                }}
                onChange={() => { setGender(value); setGenderError(false); }}
                className="sr-only"
              />
              <span>{value === "male" ? dict.auth.genderMale : dict.auth.genderFemale}</span>
            </label>
          ))}
        </div>
        {genderError && <p id="gender-error" role="alert" className="mt-1 text-xs text-band-bad">{dict.auth.errorGenderRequired}</p>}
      </fieldset>
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
      <TelegramButton
        label={dict.auth.continueWithTelegram}
        unavailableLabel={dict.auth.telegramUnavailable}
        configured={telegramConfigured}
        botUsername={telegramBotUsername}
      />
    </form>
  );
}
