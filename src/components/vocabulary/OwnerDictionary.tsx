"use client";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { Entry, Sense, Draft } from "@/lib/dictionary/model";
import { DictionaryPanel } from "./DictionaryPanel";
type Overview = {
  channel: { active_release_id: string; previous_release_id: string | null };
  release: {
    manifest: {
      lexemes: number;
      senses: number;
      examples: number;
      search_terms: number;
    };
    manifest_sha: string;
    validated_at: string;
  };
  drafts: number;
  custom: { lexemes: number; senses: number };
  published_at: string;
  index_state: string;
};
type DraftRow = { id: string; changes: Draft };
type History = {
  id: string;
  operation: string;
  created_at: string;
  result_release_id: string | null;
};
type Job = {
  id: string;
  phase: string;
  error: string | null;
  candidate_release_id: string;
};
export function OwnerDictionary({ dict }: { dict: Dictionary }) {
  const t = dict.globalDictionary;
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null),
    [drafts, setDrafts] = useState<DraftRow[]>([]),
    [history, setHistory] = useState<History[]>([]),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<{
      entry: Entry | null;
      sense: Sense | null;
    } | null>(null),
    [adding, setAdding] = useState(false),
    [lemma, setLemma] = useState(""),
    [pos, setPos] = useState("noun"),
    [kind, setKind] = useState("word"),
    [en, setEn] = useState(""),
    [uz, setUz] = useState(""),
    [definition, setDefinition] = useState(""),
    [examples, setExamples] = useState<
      { id?: string; textEn: string; textUz: string }[]
    >([]);
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const r = await fetch("/api/owner/dictionary/" + path, {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw Error(data.error || t.unavailable);
    }
    return r.json();
  }
  async function refresh() {
    try {
      const [s, d, h, j] = await Promise.all([
        api<Overview>("summary"),
        api<{ drafts: DraftRow[] }>("drafts"),
        api<{ history: History[] }>("history"),
        api<{ job: Job | null }>("publish"),
      ]);
      setOverview(s);
      setDrafts(d.drafts);
      setHistory(h.history);
      setJob(j.job);
      setError("");
    } catch {
      setError(t.unavailable);
    }
  }
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function select(entry: Entry | null, sense: Sense | null) {
    setEditingDraftId(null);
    setAdding(!sense);
    setEdit({ entry, sense });
    setLemma(entry?.display_lemma ?? "");
    setPos(entry?.part_of_speech ?? "noun");
    setKind(entry?.lexical_type ?? "word");
    setEn(sense?.definition_en ?? "");
    setUz(sense?.translations[0]?.text ?? "");
    setDefinition(sense?.definition_uz ?? "");
    setExamples(
      sense?.examples.map((x) => ({
        id: x.example_id,
        textEn: x.text_en,
        textUz: x.text_uz,
      })) ?? [],
    );
  }
  async function draft() {
    if (!edit || busy) return;
    setBusy(true);
    try {
      const changes: unknown = edit.sense
        ? {
            operation: "edit_sense",
            lexemeId: edit.entry!.lexeme_id,
            senseId: edit.sense.sense_id,
            translationUz: uz,
            definitionUz: definition,
            examples: examples.map((x) => ({
              exampleId: x.id,
              textUz: x.textUz,
            })),
          }
        : edit.entry
          ? {
              operation: "add_sense",
              lexemeId: edit.entry.lexeme_id,
              definitionEn: en,
              translationUz: uz,
              definitionUz: definition,
              examples: examples.map((x) => ({
                textEn: x.textEn,
                textUz: x.textUz,
              })),
            }
          : {
              operation: "add_lexeme",
              lemma,
              partOfSpeech: pos,
              lexicalType: kind,
              definitionEn: en,
              translationUz: uz,
              definitionUz: definition,
              examples: examples.map((x) => ({
                textEn: x.textEn,
                textUz: x.textUz,
              })),
            };
      await api(editingDraftId ? "drafts/" + editingDraftId : "drafts", editingDraftId ? "PATCH" : "POST", changes);
      setEditingDraftId(null);
      setEdit(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error && e.message === "dictionary_capacity_exceeded" ? t.capacityExceeded : e instanceof Error && e.message === "duplicate_lexeme" ? t.duplicateWord : e instanceof Error && e.message === "duplicate_sense" ? t.duplicateSense : t.unavailable);
    } finally {
      setBusy(false);
    }
  }
  async function publish(resume = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let current = resume
        ? (job?.phase==="failed"?(await api<{job:Job}>("publish/"+job.id+"/retry","POST")).job:job)
        : (await api<{ job: Job }>("publish", "POST")).job;
      if (!current) throw Error(t.unavailable);
      setJob(current);
      while (!["complete", "failed"].includes(current.phase)) {
        current = (await api<{ job: Job }>("publish/" + current.id, "POST"))
          .job;
        setJob(current);
        if(current.phase==="worker_index")await new Promise(resolve=>setTimeout(resolve,2000));
      }
      if (current.phase === "failed")
        throw Error(current.error || t.unavailable);
      await refresh();
    } catch (e) {
      setError(e instanceof Error && e.message === "dictionary_capacity_exceeded" ? t.capacityExceeded : e instanceof Error && e.message === "duplicate_lexeme" ? t.duplicateWord : e instanceof Error && e.message === "duplicate_sense" ? t.duplicateSense : t.unavailable);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="section-title">{t.owner}</h1>
      {error && <p role="alert">{error}</p>}
      {overview && (
        <section className="card space-y-3 p-5">
          <h2 className="font-display text-xl">{t.overview}</h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            {Object.entries(overview.release.manifest)
              .filter(([k]) =>
                ["lexemes", "senses", "examples", "search_terms"].includes(k),
              )
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{({lexemes:t.lexemes,senses:t.senses,examples:t.examplesCount,search_terms:t.searchTerms} as Record<string,string>)[k]}</dt>
                  <dd className="font-display text-2xl">
                    {Number(v).toLocaleString()}
                  </dd>
                </div>
              ))}
          </dl>
          <p className="break-all">{overview.channel.active_release_id}</p>
          {overview.channel.previous_release_id && (
            <p className="break-all">{overview.channel.previous_release_id}</p>
          )}
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt>{t.customLexemes}</dt><dd>{overview.custom.lexemes}</dd></div>
            <div><dt>{t.customSenses}</dt><dd>{overview.custom.senses}</dd></div>
            <div><dt>{t.drafts}</dt><dd>{overview.drafts}</dd></div>
            <div><dt>{t.indexState}</dt><dd>{overview.index_state === "validated" ? t.validated : t.pending}</dd></div>
            <div><dt>{t.publishedAt}</dt><dd>{overview.published_at ? new Date(overview.published_at).toLocaleString() : "—"}</dd></div>
          </dl>
          <p className="break-all text-xs">
            SHA-256: {overview.release.manifest_sha}
          </p>
        </section>
      )}
      <DictionaryPanel
        dict={dict}
        owner
        onEdit={select}
        onAddSense={(entry) => select(entry, null)}
        onAddWord={() => select(null, null)}
      />
      {edit && (
        <form
          className="card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void draft();
          }}
        >
          <h2>{edit.sense ? t.edit : edit.entry ? t.addSense : t.custom}</h2>
          {!edit.entry && (
            <>
              <label className="block">
                {t.lemma}
                <input
                  className="input"
                  required
                  maxLength={120}
                  value={lemma}
                  onChange={(e) => setLemma(e.target.value)}
                />
              </label>
              <label>
                {t.pos}
                <select
                  className="input"
                  value={pos}
                  onChange={(e) => setPos(e.target.value)}
                >
                  {[
                    "noun",
                    "verb",
                    "adjective",
                    "adverb",
                    "preposition",
                    "pronoun",
                    "determiner",
                    "conjunction",
                    "interjection",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                {t.type}
                <select
                  className="input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {[
                    "word",
                    "noun_phrase",
                    "verb_phrase",
                    "phrasal_verb",
                    "idiom",
                    "collocation",
                    "fixed_expression",
                    "compound",
                    "technical_term",
                    "phrase",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="block">
            {t.english}
            <textarea
              className="input"
              required
              readOnly={!!edit.sense}
              value={en}
              maxLength={6000}
              onChange={(e) => setEn(e.target.value)}
            />
          </label>
          {edit.sense && <p>{t.upstream}</p>}
          <label className="block">
            {t.translation}
            <textarea
              className="input"
              required
              maxLength={6000}
              value={uz}
              onChange={(e) => setUz(e.target.value)}
            />
          </label>
          <label className="block">
            {t.definition}
            <textarea
              className="input"
              required
              maxLength={6000}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
            />
          </label>
          <h3>{t.examples}</h3>
          {examples.map((x, i) => (
            <div key={x.id ?? i} className="grid gap-2 sm:grid-cols-2">
              <textarea
                className="input"
                required
                readOnly={!adding}
                aria-label={t.english}
                maxLength={6000}
                value={x.textEn}
                onChange={(e) =>
                  setExamples((a) =>
                    a.map((v, n) =>
                      n === i ? { ...v, textEn: e.target.value } : v,
                    ),
                  )
                }
              />
              <textarea
                className="input"
                required
                aria-label={t.translation}
                maxLength={6000}
                value={x.textUz}
                onChange={(e) =>
                  setExamples((a) =>
                    a.map((v, n) =>
                      n === i ? { ...v, textUz: e.target.value } : v,
                    ),
                  )
                }
              />
            </div>
          ))}
          {adding && examples.length < 100 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setExamples((a) => [...a, { textEn: "", textUz: "" }])
              }
            >
              + {t.examples}
            </button>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {t.draft}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEdit(null)}
            >
              {dict.vocabulary.add.close}
            </button>
          </div>
        </form>
      )}
      <section className="card space-y-3 p-5">
        <h2 className="font-display text-xl">{t.drafts}</h2>
        {drafts.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap justify-between gap-2 border-b border-ink-100 py-2"
          >
            <span>
              {d.changes.operation} ·{" "}
              {"lemma" in d.changes
                ? d.changes.lemma
                : "lexemeId" in d.changes
                  ? d.changes.lexemeId
                  : ""}
            </span>
            <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
              try {
                const change = d.changes;
                const entry = change.operation === "add_lexeme" ? null : (await api<{entry: Entry}>("entries/" + change.lexemeId)).entry;
                const sense = change.operation === "edit_sense" ? entry?.senses.find(s => s.sense_id === change.senseId) ?? null : null;
                select(entry, sense);
                setEditingDraftId(d.id);
                if (change.operation === "add_lexeme") { setLemma(change.lemma); setPos(change.partOfSpeech); setKind(change.lexicalType); }
                if (change.operation !== "edit_sense") {
                  setEn(change.definitionEn); setExamples(change.examples);
                } else setExamples(sense?.examples.map(ex => ({id: ex.example_id, textEn: ex.text_en, textUz: change.examples?.find(e => e.exampleId === ex.example_id)?.textUz ?? ex.text_uz})) ?? []);
                setUz(change.translationUz ?? sense?.translations[0]?.text ?? "");
                setDefinition(change.definitionUz ?? sense?.definition_uz ?? "");
              } catch { setError(t.unavailable); }
            }}>{t.edit}</button>
            <button type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await api("drafts/" + d.id, "DELETE");
                  await refresh();
                } catch {
                  setError(t.unavailable);
                }
              }}
            >
              {t.discard}
            </button>
          </div>
        ))}
        <button type="button"
          className="btn-primary"
          disabled={
            busy ||
            !drafts.length ||
            (!!job && !["complete", "failed"].includes(job.phase))
          }
          onClick={() => void publish()}
        >
          {t.publish}
        </button>
        {job && (!["complete", "failed"].includes(job.phase)||job.error==="dictionary_index_build_failed") && (
          <button type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void publish(true)}
          >
            {t.resume}
          </button>
        )}
        {job && (
          <p role="status">
            {job.phase === "complete" ? t.done : t.working} · {job.phase}
          </p>
        )}
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-display text-xl">{t.history}</h2>
        <button type="button"
          className="btn-secondary"
          disabled={busy || !overview?.channel.previous_release_id}
          onClick={async () => {
            setBusy(true);
            try {
              await api("rollback", "POST");
              await refresh();
            } catch {
              setError(t.unavailable);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.rollback}
        </button>
        {history.map((h) => (
          <p key={h.id} className="break-all">
            {h.created_at} · {h.operation} · {h.result_release_id}
          </p>
        ))}
      </section>
    </div>
  );
}
