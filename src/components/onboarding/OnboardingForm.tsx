"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";
import { StudyDateInput } from './StudyDateInput';
export type StudyProfileValues={currentLevel:string|null;currentBand:number|null;targetBand:number|null;examDate:string|null;dailyStudyMinutes:number|null;strongestSkill:string|null;weakestSkill:string|null};

const SKILLS = ["listening", "reading", "writing", "speaking"] as const;
const LEVELS = ["A2", "B1", "B2", "C1", "C2"];

export function OnboardingForm({ dict, locale,initial,profile=false }: { dict: Dictionary; locale: Locale;initial?:StudyProfileValues;profile?:boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // The form had no error surface at all: a failed request used to end silently,
  // leaving a button that looked like it had done something. It now says so.
  const [error, setError] = useState("");
  const [saved,setSaved]=useState(false);
  const [form, setForm] = useState({
    preferredLanguage: locale,
    currentLevel: initial?.currentLevel??"B1",
    currentBand: initial?.currentBand==null?"":String(initial.currentBand),
    targetBand: String(initial?.targetBand??7),
    examDate: initial?.examDate??"",
    dailyStudyMinutes: String(initial?.dailyStudyMinutes??60),
    strongestSkill: (initial?.strongestSkill??"reading") as (typeof SKILLS)[number],
    weakestSkill: (initial?.weakestSkill??"writing") as (typeof SKILLS)[number],
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await requestJson(profile?"/api/profile/study":"/api/onboarding", {
        method:profile?"PATCH":"POST",
        body: {
          ...form,
          currentBand: form.currentBand || undefined,
          examDate: form.examDate || undefined,
        },
      });
      if (!result.ok) {
        setError(failureMessage(result, dict.auth));
        return;
      }
      if(profile)setSaved(true);else router.push("/app");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={()=>setSaved(false)} className="grid grid-cols-1 gap-5 sm:grid-cols-2" data-study-profile={profile||undefined}>
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

      <StudyDateInput dict={dict} value={form.examDate} onChange={examDate=>setForm({...form,examDate})}/>

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
        <FieldError>{error}</FieldError>
        {saved&&<p role="status">{dict.profile.studySaved}</p>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? dict.common.loading : profile?dict.profile.saveStudy:dict.onboarding.finish}
        </Button>
      </div>
    </form>
  );
}
