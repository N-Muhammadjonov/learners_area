"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import type { GrammarActivity } from "@/lib/services/grammar/mastery";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { apiErrorMessage } from "@/lib/api-error-message";

type Exercise = {
  id: string;
  order: number;
  promptText: string;
  translatePromptUz: string | null;
  targetStructures: string[];
  activationPrompt: string | null;
};

type Result = {
  verdict: "correct" | "partial" | "incorrect" | "undetermined" | string;
  checkedBy: string | null;
  used: string[];
  missing: string[];
  sampleAnswer: string | null;
  explanation: string;
  issues: string[];
};

/**
 * Translate With It and Activate It.
 *
 * The evaluator supplies the verdict. Phrase matches are supporting diagnostics,
 * and never a substitute for checking meaning or accepting valid alternatives.
 */
export function PracticeActivities({
  dict,
  exercises,
}: {
  dict: Dictionary;
  exercises: Exercise[];
}) {
  const t = dict.grammar;
  const request = useScopedRequest();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const translatable = exercises.filter((e) => e.translatePromptUz);
  const activatable = exercises.filter((e) => e.activationPrompt);

  async function submit(exerciseId: string, activity: GrammarActivity) {
    const key = `${activity}:${exerciseId}`;
    setBusy(key);
    setError(null);
    const res = await request<Record<string, unknown>>(`/api/grammar/exercises/${exerciseId}/practice`, { body: { activity, answer: answers[key] ?? "" }, timeoutMs: 60_000 });
    if (!res) return;
    setBusy(null);
    if (!res.ok) { setError(apiErrorMessage(res.error, res.status, dict)); return; }
    const data = res.data as { verdict?: string; checkedBy?: string; structures?: { used?: string[]; missing?: string[] }; sampleAnswer?: string | null; explanation?: string; issues?: string[] };
    setResults((prev) => ({
      ...prev,
      [key]: {
        verdict: String(data.verdict),
        checkedBy: data.checkedBy ?? null,
        used: data.structures?.used ?? [],
        missing: data.structures?.missing ?? [],
        sampleAnswer: data.sampleAnswer ?? null,
        explanation: String(data.explanation ?? ""),
        issues: Array.isArray(data.issues) ? (data.issues as string[]) : [],
      },
    }));
  }

  /**
   * The four deterministic structure verdicts have their own wording. Anything
   * else is the text evaluator's own vocabulary ("needs_correction" and friends),
   * which is translated by the coach's label map — the same map the rest of the
   * app uses, so a verdict never appears untranslated or invented.
   */
  function verdictText(verdict: string): string {
    const structureVerdicts: Record<string, string> = {
      correct: t.verdictCorrect,
      partial: t.verdictPartial,
      incorrect: t.verdictIncorrect,
      undetermined: t.verdictUndetermined,
    };
    if (structureVerdicts[verdict]) return structureVerdicts[verdict];
    return (dict.coach.verdicts as Record<string, string>)[verdict] ?? verdict;
  }

  if (translatable.length === 0 && activatable.length === 0) {
    return (
      <Card data-practice-empty>
        <h2 className="font-display text-lg text-ink-900">{t.practiceTitle}</h2>
        <p className="mt-1 text-sm text-ink-500">{t.practiceEmpty}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {translatable.length > 0 && (
        <Card data-translate-block>
          <h2 className="font-display text-lg text-ink-900">{t.translateTitle}</h2>
          <p className="mt-1 text-xs text-ink-300">{t.translateHint}</p>
          <div className="mt-3 flex flex-col gap-4">
            {translatable.map((ex) => {
              const key = `translate_it:${ex.id}`;
              const result = results[key];
              return (
                <div key={ex.id} className="rounded-sm bg-paper-sunken p-3" data-translate={ex.id}>
                  <p className="text-sm text-ink-900">{ex.translatePromptUz}</p>
                  {ex.targetStructures.length > 0 && (
                    <p className="mt-1 text-xs text-ink-300">
                      {t.targetStructures}: {ex.targetStructures.join(" · ")}
                    </p>
                  )}
                  <textarea
                    className="input mt-2 min-h-[70px] w-full"
                    value={answers[key] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                    data-translate-input={ex.id}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={busy === key || (answers[key] ?? "").trim().length < 2}
                      onClick={() => void submit(ex.id, "translate_it")}
                      data-translate-check={ex.id}
                    >
                      {busy === key ? dict.common.saving : t.checkMine}
                    </Button>
                    {result && (
                      <span className="flex flex-wrap items-center gap-2 text-sm" data-translate-verdict={result.verdict}>
                        <span className={result.verdict === "correct" ? "text-band-good" : "text-ink-700"}>{verdictText(result.verdict)}</span>
                        {result.checkedBy && <span className="text-xs text-ink-300" data-practice-checked-by={result.checkedBy}>{dict.coach.checkedBy} {result.checkedBy}</span>}
                      </span>
                    )}
                  </div>
                  {result && (
                    <div className="mt-2 text-xs text-ink-500" data-translate-structures>
                      {result.used.length > 0 && (
                        <p>
                          {t.structuresUsed}: {result.used.join(", ")}
                        </p>
                      )}
                      {result.missing.length > 0 && (
                        <p className="text-band-bad">
                          {t.structuresMissing}: {result.missing.join(", ")}
                        </p>
                      )}
                      {result.issues.length > 0 && <ul className="list-inside list-disc">{result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
                      {result.sampleAnswer && <p className="mt-1 text-ink-300">{t.sampleAnswer}: {result.sampleAnswer}</p>}
                      <p className="text-ink-300">{result.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {activatable.length > 0 && (
        <Card data-activate-block>
          <h2 className="font-display text-lg text-ink-900">{t.activateTitle}</h2>
          <p className="mt-1 text-xs text-ink-300">{t.activateHint}</p>
          <div className="mt-3 flex flex-col gap-4">
            {activatable.map((ex) => {
              const key = `activate_it:${ex.id}`;
              const result = results[key];
              return (
                <div key={ex.id} className="rounded-sm bg-paper-sunken p-3" data-activate={ex.id}>
                  <p className="text-sm text-ink-900">{ex.activationPrompt}</p>
                  <textarea
                    className="input mt-2 min-h-[70px] w-full"
                    value={answers[key] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                    data-activate-input={ex.id}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={busy === key || (answers[key] ?? "").trim().length < 2}
                      onClick={() => void submit(ex.id, "activate_it")}
                      data-activate-check={ex.id}
                    >
                      {busy === key ? dict.common.saving : t.checkMine}
                    </Button>
                    {result && (
                      <span className="flex flex-wrap items-center gap-2 text-sm" data-activate-verdict={result.verdict}>
                        <span className={result.verdict === "correct" ? "text-band-good" : "text-ink-700"}>
                          {verdictText(result.verdict)}
                        </span>
                        {result.checkedBy && (
                          <span className="text-xs text-ink-300" data-practice-checked-by={result.checkedBy}>
                            {dict.coach.checkedBy} {result.checkedBy}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {result && (
                    <div className="mt-2 text-xs text-ink-500">
                      {result.missing.length > 0 && (
                        <p className="text-band-bad">
                          {t.structuresMissing}: {result.missing.join(", ")}
                        </p>
                      )}
                      {result.issues.length > 0 && (
                        <ul className="list-inside list-disc">
                          {result.issues.map((issue, index) => (
                            <li key={index}>{issue}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-ink-300">{result.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {error && <p className="text-sm text-band-bad">{error}</p>}
    </div>
  );
}
