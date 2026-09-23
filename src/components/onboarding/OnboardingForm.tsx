"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";

const SKILLS = ["listening", "reading", "writing", "speaking"] as const;
const LEVELS = ["A2", "B1", "B2", "C1", "C2"];

export function OnboardingForm({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    preferredLanguage: locale,
    currentLevel: "B1",
    currentBand: "",
    targetBand: "7",
    examDate: "",
    dailyStudyMinutes: "60",
    strongestSkill: "reading" as (typeof SKILLS)[number],
    weakestSkill: "writing" as (typeof SKILLS)[number],
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        currentBand: form.currentBand || undefined,
        examDate: form.examDate || undefined,
      }),
    });
    setPending(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div>
        <Label htmlFor="preferredLanguage">{dict.onboarding.preferredLanguage}</Label>
        <select
          id="preferredLanguage"
          className="input"
          value={form.preferredLanguage}
          onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value as Locale })}
        >
          <option value="uz">O&apos;zbek</option>
          <option value="en">English</option>
        </select>
      </div>

      <div>
        <Label htmlFor="currentLevel">{dict.onboarding.currentLevel}</Label>
        <select
          id="currentLevel"
          className="input"
          value={form.currentLevel}
          onChange={(e) => setForm({ ...form, currentLevel: e.target.value })}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="currentBand">{dict.onboarding.currentBand}</Label>
        <Input
          id="currentBand"
          type="number"
          min={0}
          max={9}
          step={0.5}
          value={form.currentBand}
          onChange={(e) => setForm({ ...form, currentBand: e.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="targetBand">{dict.onboarding.targetBand}</Label>
        <Input
          id="targetBand"
          type="number"
          min={4}
          max={9}
          step={0.5}
          required
          value={form.targetBand}
          onChange={(e) => setForm({ ...form, targetBand: e.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="examDate">{dict.onboarding.examDate}</Label>
        <Input
          id="examDate"
          type="date"
          value={form.examDate}
          onChange={(e) => setForm({ ...form, examDate: e.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="dailyStudyMinutes">{dict.onboarding.dailyStudyMinutes}</Label>
        <Input
          id="dailyStudyMinutes"
          type="number"
          min={5}
          max={600}
          required
          value={form.dailyStudyMinutes}
          onChange={(e) => setForm({ ...form, dailyStudyMinutes: e.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="strongestSkill">{dict.onboarding.strongestSkill}</Label>
        <select
          id="strongestSkill"
          className="input"
          value={form.strongestSkill}
          onChange={(e) => setForm({ ...form, strongestSkill: e.target.value as (typeof SKILLS)[number] })}
        >
          {SKILLS.map((s) => (
            <option key={s} value={s}>{dict.nav[s]}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="weakestSkill">{dict.onboarding.weakestSkill}</Label>
        <select
          id="weakestSkill"
          className="input"
          value={form.weakestSkill}
          onChange={(e) => setForm({ ...form, weakestSkill: e.target.value as (typeof SKILLS)[number] })}
        >
          {SKILLS.map((s) => (
            <option key={s} value={s}>{dict.nav[s]}</option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? dict.common.loading : dict.onboarding.finish}
        </Button>
      </div>
    </form>
  );
}
