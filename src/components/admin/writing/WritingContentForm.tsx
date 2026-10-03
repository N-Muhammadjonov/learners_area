"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { LESSON_CATEGORIES, MODEL_TEXT_BANDS, wordsIn, type WritingAdminKind } from "@/lib/writing/admin-schemas";
import { PATTERN_FUNCTIONS } from "@/lib/writing/pattern-functions";
import { TRANSLATION_BANDS, TRANSLATION_QUESTION_TYPES } from "@/lib/writing/translation-rules";

type Values = Record<string, unknown>;
type Sentence = { position: number; uzbekSource: string; modelEnglish: string; acceptedAlternatives: string; notes: string; targetLexicalItems: string };

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const str = (v: unknown) => (v == null ? "" : String(v));

/**
 * One editor for every Writing content kind. The server (services/writing/admin)
 * is the authority: this form only collects values, and shows the server's
 * problems as localized sentences — never raw codes.
 */
export function WritingContentForm({ dict, kind, id, initial, sources }: { dict: Dictionary; kind: WritingAdminKind; id: string | null; initial: Values; sources: { id: string; title: string }[] }) {
  const t = dict.admin.writingAdmin;
  const f = t.fields;
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [sentences, setSentences] = useState<Sentence[]>(() => ((initial.sentences as Values[] | undefined) ?? []).map((s) => ({
    position: Number(s.position), uzbekSource: str(s.uzbekSource), modelEnglish: str(s.modelEnglish),
    acceptedAlternatives: ((s.acceptedAlternatives as string[]) ?? []).join("\n"), notes: ((s.notes as string[]) ?? []).join("\n"), targetLexicalItems: ((s.targetLexicalItems as string[]) ?? []).join("\n"),
  })));
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const set = (k: string, val: unknown) => { setV((x) => ({ ...x, [k]: val })); setSaved(false); };

  function payload(): Values {
    const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, v[k] === "" ? null : v[k]]));
    switch (kind) {
      case "lesson": return { ...pick(["title", "category", "summary", "body"]), durationMinutes: v.durationMinutes ? Number(v.durationMinutes) : null, position: Number(v.position ?? 0) };
      case "prompt": return { ...pick(["taskType", "category", "prompt"]), targetWordCount: Number(v.targetWordCount) };
      case "translation": return {
        ...pick(["title", "topic", "questionType", "taskType", "promptText", "provenance"]), targetBand: Number(v.targetBand),
        sentences: sentences.map((s) => ({ position: Number(s.position), uzbekSource: s.uzbekSource, modelEnglish: s.modelEnglish, acceptedAlternatives: lines(s.acceptedAlternatives), notes: lines(s.notes), targetLexicalItems: lines(s.targetLexicalItems) })),
      };
      case "model-text": return { ...pick(["title", "taskType", "topic", "body", "provenance"]), targetBand: Number(v.targetBand) };
      case "pattern": return { ...pick(["pattern", "function", "taskType", "topic", "example", "usageNote", "provenance"]), targetBand: v.targetBand ? Number(v.targetBand) : null, sourceRef: v.sourceRef || null };
    }
  }

  async function save() {
    setBusy(true); setIssues([]); setSaved(false);
    const res = await fetch(id ? `/api/admin/writing/${kind}/${id}` : `/api/admin/writing/${kind}`, {
      method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()),
    }).catch(() => null);
    setBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { id?: string; error?: { issues?: string[] } } | null) : null;
    if (!res?.ok || !data?.id) { setIssues(data?.error?.issues?.length ? data.error.issues : ["write_failed"]); return; }
    setSaved(true);
    if (!id) router.replace(`/admin/writing/${kind}/${data.id}`); else router.refresh();
  }

  const text = (k: string, label: string, opts: { rows?: number; required?: boolean; max?: number } = {}) => (
    <label className="flex flex-col gap-1 text-base text-ink-800">
      <span>{label}{opts.required && " *"}</span>
      {opts.rows ? <textarea className="input" rows={opts.rows} maxLength={opts.max} value={str(v[k])} onChange={(e) => set(k, e.target.value)} />
        : <input className="input" maxLength={opts.max} value={str(v[k])} onChange={(e) => set(k, e.target.value)} />}
    </label>
  );
  const select = (k: string, label: string, options: readonly (string | number)[], labels?: Record<string, string>, allowEmpty?: string) => (
    <label className="flex flex-col gap-1 text-base text-ink-800">
      <span>{label}</span>
      <select className="input min-h-11" value={str(v[k])} onChange={(e) => set(k, e.target.value)}>
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {options.map((o) => <option key={String(o)} value={String(o)}>{labels?.[String(o)] ?? String(o)}</option>)}
      </select>
    </label>
  );
  const number = (k: string, label: string, min: number, max: number) => (
    <label className="flex flex-col gap-1 text-base text-ink-800">
      <span>{label}</span>
      <input type="number" className="input min-h-11" min={min} max={max} value={str(v[k])} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const task = select("taskType", f.taskType, ["task1", "task2"], { task1: "Task 1", task2: "Task 2" });
  const fns = dict.writingWorkspace.topicVocab.fns as Record<string, string>;
  const cats = dict.writingWorkspace.lessons.category as Record<string, string>;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }} data-admin-writing-form={kind}>
      {kind === "lesson" && (<>
        {text("title", f.title, { required: true, max: 200 })}
        <div className="grid gap-4 sm:grid-cols-3">{select("category", f.category, LESSON_CATEGORIES, cats)}{number("durationMinutes", f.duration, 1, 240)}{number("position", f.position, 0, 10000)}</div>
        {text("summary", f.summary, { rows: 2, max: 600 })}
        {text("body", f.body, { rows: 14, required: true, max: 20000 })}
      </>)}
      {kind === "prompt" && (<>
        <div className="grid gap-4 sm:grid-cols-3">{task}{text("category", f.category, { required: true, max: 60 })}{number("targetWordCount", f.targetWordCount, 50, 500)}</div>
        {text("prompt", f.prompt, { rows: 6, required: true, max: 2000 })}
      </>)}
      {kind === "translation" && (<>
        {text("title", f.title, { required: true, max: 200 })}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{text("topic", f.topic, { required: true, max: 120 })}{select("questionType", f.questionType, TRANSLATION_QUESTION_TYPES, dict.writingWorkspace.translation.types as Record<string, string>)}{task}{select("targetBand", f.targetBand, TRANSLATION_BANDS)}</div>
        {text("promptText", f.promptText, { rows: 3, required: true, max: 2000 })}
        {text("provenance", f.provenance, { required: true, max: 200 })}
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold text-ink-900">{f.sentences}</legend>
          {sentences.map((s, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-ink-100 p-3 lg:grid-cols-2" data-admin-sentence={i}>
              <label className="flex flex-col gap-1 text-base">{f.position1}<input type="number" min={1} max={40} className="input min-h-11 w-24" value={s.position} onChange={(e) => setSentences((x) => x.map((y, j) => (j === i ? { ...y, position: Number(e.target.value) } : y)))} /></label>
              <div className="flex items-end justify-end"><button type="button" className="btn-secondary min-h-11" onClick={() => setSentences((x) => x.filter((_, j) => j !== i))}>{f.removeSentence}</button></div>
              {(["uzbekSource", "modelEnglish", "acceptedAlternatives", "notes", "targetLexicalItems"] as const).map((k) => (
                <label key={k} className="flex flex-col gap-1 text-base">{{ uzbekSource: f.uzbekSource, modelEnglish: f.modelEnglish, acceptedAlternatives: f.alternatives, notes: f.notes, targetLexicalItems: f.lexical }[k]}
                  <textarea className="input" rows={2} value={s[k]} onChange={(e) => setSentences((x) => x.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} />
                </label>
              ))}
            </div>
          ))}
          <button type="button" className="btn-secondary min-h-11 self-start" onClick={() => setSentences((x) => [...x, { position: (x.reduce((m, y) => Math.max(m, y.position), 0) || 0) + 1, uzbekSource: "", modelEnglish: "", acceptedAlternatives: "", notes: "", targetLexicalItems: "" }])}>+ {f.addSentence}</button>
        </fieldset>
      </>)}
      {kind === "model-text" && (<>
        {text("title", f.title, { required: true, max: 200 })}
        <div className="grid gap-4 sm:grid-cols-3">{task}{text("topic", f.topic, { required: true, max: 120 })}{select("targetBand", f.targetBand, MODEL_TEXT_BANDS)}</div>
        {text("body", f.body, { rows: 16, required: true, max: 8000 })}
        <p className="text-sm text-ink-500" data-admin-word-count>{f.wordCount}: {wordsIn(str(v.body))}</p>
        {text("provenance", f.provenance, { required: true, max: 200 })}
      </>)}
      {kind === "pattern" && (<>
        {text("pattern", f.pattern, { required: true, max: 240 })}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{select("function", f.function, PATTERN_FUNCTIONS, fns)}{task}{text("topic", f.topic, { max: 120 })}{select("targetBand", f.targetBand, [5, 6, 7, 8, 9], undefined, "—")}</div>
        {text("example", f.example, { rows: 2, required: true, max: 400 })}
        {text("usageNote", f.usageNote, { rows: 2, max: 600 })}
        {select("sourceRef", f.sourceRef, sources.map((s) => s.id), Object.fromEntries(sources.map((s) => [s.id, s.title])), f.noSource)}
        {text("provenance", f.provenance, { required: true, max: 200 })}
      </>)}

      {issues.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-band-bad/40 bg-band-bad/5 p-3 pl-8 text-base text-band-bad" data-admin-writing-issues>
          {issues.map((code) => <li key={code}>{(t.issues as Record<string, string>)[code] ?? t.issues.write_failed}</li>)}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary min-h-11" disabled={busy}>{busy ? t.saving : t.save}</button>
        {saved && <span role="status" className="text-sm text-band-good">{t.saved}</span>}
      </div>
    </form>
  );
}
