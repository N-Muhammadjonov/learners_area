"use client";
import { useId, useMemo } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { MeasurementClaim, MeasurementGroup, MeasurementStructureV1 } from "@/lib/retention/types";
import { decodeMeasurementDraft, measurementLines } from "@/lib/retention/measurement-draft";
import { measurementStructureSchema } from "@/lib/retention/measurement";
type Props = { value: string; onChange: (value: string) => void; dict: Dictionary };
export function RetentionMeasurementEditor({ value, onChange, dict }: Props) {
 const t = dict.retentionMemory.admin.builder;
 const prefix = useId();
 const draft = useMemo(() => decodeMeasurementDraft(value), [value]);
 const valid = useMemo(() => draft ? measurementStructureSchema.safeParse(draft).success : false, [draft]);
 function update(next: MeasurementStructureV1) { onChange(JSON.stringify(next, null, 2)); }
 function replaceClaim(index: number, next: MeasurementClaim) {
  if (draft) update({ ...draft, claims: draft.claims.map((claim, i) => i === index ? next : claim) });
 }
 function replaceGroup(ci: number, gi: number, next: MeasurementGroup) {
  const claim = draft?.claims[ci]; if (!claim) return;
  const groups = claim.groups.map((g, i) => i === gi ? next : g);
  replaceClaim(ci, { ...claim, groups, points: groups.reduce((sum, g) => sum + g.points, 0) });
 }
 function newId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`; }
 return <div className="flex flex-col gap-3" data-retention-measurement-builder>
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="section-title">{t.title}</h3><span className="technical-text" role="status">{draft?.claims.reduce((n, c) => n + c.points, 0) ?? "—"} / 100 · {valid ? t.valid : t.incomplete}</span></div>
  <p className="meta-text">{t.hint}</p>
  {!draft && <p role="alert" className="meta-text text-signal-700">{t.rawWarning}</p>}
  {draft?.claims.map((claim, ci) => <fieldset className="panel flex flex-col gap-3" key={claim.id}>
   <legend className="meta-text">{t.claim} {ci + 1} · {claim.points}/100</legend>
   <label className="flex flex-col gap-1"><span>{t.label}</span><input className="input" maxLength={300} value={claim.label} onChange={e => replaceClaim(ci, { ...claim, label: e.target.value })}/></label>
   <label className="flex flex-col gap-1"><span>{t.scope}</span><select className="input" value={claim.scope} onChange={e => replaceClaim(ci, { ...claim, scope: e.target.value as MeasurementClaim["scope"] })}><option value="sentence">{t.sentence}</option><option value="answer">{t.answer}</option></select></label>
   {claim.groups.map((group, gi) => <fieldset className="rounded-lg border border-ink-100 p-3 flex flex-col gap-2" key={group.id}>
    <legend className="meta-text">{t.group} {gi + 1}</legend>
    <div className="grid gap-2 sm:grid-cols-2"><label className="flex flex-col gap-1"><span>{t.kind}</span><select className="input" value={group.kind} onChange={e => replaceGroup(ci, gi, { ...group, kind: e.target.value as MeasurementGroup["kind"] })}>{(["concept", "entity", "number", "date"] as const).map(kind => <option value={kind} key={kind}>{t[kind]}</option>)}</select></label>
    <label className="flex flex-col gap-1"><span>{t.points}</span><input type="number" min={1} max={100} step={1} className="input" value={group.points} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) replaceGroup(ci, gi, { ...group, points: n }); }}/></label></div>
    <label className="flex flex-col gap-1"><span>{t.alternatives}</span><textarea className="input min-h-20" value={group.anyOf.join("\n")} onChange={e => replaceGroup(ci, gi, { ...group, anyOf: measurementLines(e.target.value) })}/></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={group.critical} onChange={e => replaceGroup(ci, gi, { ...group, critical: e.target.checked })}/><span>{t.critical}</span></label>
    <button className="btn-secondary w-fit" type="button" onClick={() => { const groups = claim.groups.filter((_, i) => i !== gi); replaceClaim(ci, { ...claim, groups, points: groups.reduce((n, g) => n + g.points, 0) }); }}>{t.removeGroup}</button>
   </fieldset>)}
   <button className="btn-secondary w-fit" type="button" disabled={claim.groups.length >= 20} onClick={() => { const groups = [...claim.groups, { id: newId("g"), points: 1, kind: "concept" as const, anyOf: [], critical: false }]; replaceClaim(ci, { ...claim, groups, points: groups.reduce((n, g) => n + g.points, 0) }); }}>{t.addGroup}</button>
   <details><summary className="btn-secondary w-fit">{t.phrases}</summary><div className="grid gap-3 pt-3 sm:grid-cols-2"><label className="flex flex-col gap-1"><span>{t.accepted}</span><textarea className="input" value={claim.acceptedPhrases.join("\n")} onChange={e => replaceClaim(ci, { ...claim, acceptedPhrases: measurementLines(e.target.value) })}/></label><label className="flex flex-col gap-1"><span>{t.rejected}</span><textarea className="input" value={claim.rejectPhrases.join("\n")} onChange={e => replaceClaim(ci, { ...claim, rejectPhrases: measurementLines(e.target.value) })}/></label></div></details>
   <button className="btn-secondary w-fit" type="button" onClick={() => update({ ...draft, claims: draft.claims.filter((_, i) => i !== ci) })}>{t.removeClaim}</button>
  </fieldset>)}
  {draft && <button className="btn-secondary w-fit" type="button" disabled={draft.claims.length >= 40} onClick={() => update({ ...draft, claims: [...draft.claims, { id: newId("c"), label: "", points: 1, scope: "sentence", groups: [{ id: newId("g"), points: 1, kind: "concept", anyOf: [], critical: false }], acceptedPhrases: [], rejectPhrases: [] }] })}>{t.addClaim}</button>}
  <details open={!draft}><summary className="btn-secondary w-fit">{t.json}</summary><label htmlFor={`${prefix}-json`} className="meta-text block pt-3">{dict.retentionMemory.admin.structureLabel}</label><textarea id={`${prefix}-json`} className="input min-h-[12rem] w-full font-mono text-xs" value={value} onChange={e => onChange(e.target.value)} spellCheck={false} data-retention-editor-structure/></details>
 </div>;
}
