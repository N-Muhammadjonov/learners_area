"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { Entry, Sense } from "@/lib/dictionary/model";
import { dictionaryPos } from "@/lib/dictionary/labels";
import { privateResources } from "@/lib/client/private-resource";
import { DictionaryPronunciation } from "./DictionaryPronunciation";
import {
  DictionaryRecentSearches,
  type DictionaryRecentSearch as Recent,
} from "./DictionaryRecentSearches";
import {
  DictionaryFolderDialog,
  type DictionaryFolder,
} from "./DictionaryFolderDialog";

type Hit = {
  lexeme_id: string;
  display_lemma: string;
  part_of_speech: string;
  translation_uz: string;
};
export function DictionaryPanel({
  dict,
  owner = false,
  onEdit,
  onAddSense,
  onAddWord,
}: {
  dict: Dictionary;
  owner?: boolean;
  onEdit?: (entry: Entry, sense: Sense) => void;
  onAddSense?: (entry: Entry) => void;
  onAddWord?: () => void;
}) {
  const t = dict.globalDictionary;
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"EN" | "UZ">("EN");
  const [hits, setHits] = useState<Hit[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [release, setRelease] = useState("");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [folders, setFolders] = useState<DictionaryFolder[]>([]);
  const [selectedSense, setSelectedSense] = useState<Sense | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [searchRun,setSearchRun]=useState(0);
  const request = useRef(0);
  const entryCacheKeys=useRef<string[]>([]);
  const mounted = useRef(true);
  const base = owner ? "/api/owner/dictionary" : "/api/dictionary";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for(const key of entryCacheKeys.current)privateResources.invalidate(key);
    };
  }, []);
  const read = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, { ...init, cache: "no-store" });
      if (!response.ok) throw Error(t.unavailable);
      return response.json();
    },
    [t.unavailable],
  );

  useEffect(() => {
    if (owner) return;
    const abort = new AbortController();
    void Promise.all([
      read<{ recent: Recent[] }>("/api/dictionary/recent", {
        signal: abort.signal,
      }),
      read<{ folders: DictionaryFolder[] }>("/api/vocabulary/folders", {
        signal: abort.signal,
      }),
    ])
      .then(([history, result]) => {
        setRecent(history.recent);
        setFolders(result.folders);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(t.unavailable);
      });
    return () => abort.abort();
  }, [owner, read, t.unavailable, retry]);

  useEffect(() => {
    const abort = new AbortController();
    const stamp = ++request.current;
    setEntry(null);
    setSelectedSense(null);
    setActive(-1);
    setHits([]);
    setError("");
    if (!query.trim()) {
      setLoading(false);
      return () => abort.abort();
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void read<{ release_id: string; results: Hit[] }>(
        `${base}/search?q=${encodeURIComponent(query)}&direction=${direction}`,
        { signal: abort.signal },
      )
        .then((result) => {
          if (stamp === request.current) {
            setHits(result.results);
            setRelease(result.release_id);
          }
        })
        .catch(() => {
          if (!abort.signal.aborted && stamp === request.current)
            setError(t.unavailable);
        })
        .finally(() => {
          if (stamp === request.current) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, direction, base, read, t.unavailable, retry, searchRun]);

  async function open(
    hit: Pick<Hit, "lexeme_id" | "display_lemma">,
    search = query,
    lang = direction,
  ) {
    const stamp = ++request.current;
    setLoading(true);
    setError("");
    try {
      const pin = release ? `?release_id=${encodeURIComponent(release)}` : "";
      const cached=release?privateResources.peek<Entry>(`dictionary:entry:${base}:${release}:${hit.lexeme_id}`):null;
      if(cached&&cached.ageMs<300000){setEntry(cached.data);setSaved([]);}
      const result = await read<{ entry: Entry; saved?: string[] }>(
        `${base}/entries/${hit.lexeme_id}${pin}`,
      );
      if (stamp !== request.current || !mounted.current) return;
      const resource=`dictionary:entry:${base}:${result.entry.release_id}:${hit.lexeme_id}`;
      privateResources.set(resource,result.entry);
      entryCacheKeys.current=entryCacheKeys.current.filter(key=>key!==resource);entryCacheKeys.current.push(resource);
      while(entryCacheKeys.current.length>8)privateResources.invalidate(entryCacheKeys.current.shift()!);
      setEntry(result.entry);
      setRelease(result.entry.release_id);
      setSaved(result.saved ?? []);
      setExpanded([]);
      if (!owner) {
        // History failure must not discard an entry that was successfully loaded.
        try {
          await read(`/api/dictionary/entries/${hit.lexeme_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: search || hit.display_lemma,
              direction: lang,
              releaseId: result.entry.release_id,
            }),
          });
          const history = await read<{ recent: Recent[] }>(
            "/api/dictionary/recent",
          );
          if (stamp === request.current && mounted.current)
            setRecent(history.recent);
        } catch {
          if (stamp === request.current && mounted.current)
            setError(t.unavailable);
        }
      }
    } catch {
      if (stamp === request.current && mounted.current) {setEntry(null);setError(t.unavailable);}
    } finally {
      if (stamp === request.current && mounted.current) setLoading(false);
    }
  }

  async function save(folderId: string | null) {
    if (!entry || !selectedSense || saving) return;
    const senseId = selectedSense.sense_id;
    setSaving(senseId);
    try {
      await read("/api/dictionary/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lexemeId: entry.lexeme_id,
          senseId,
          releaseId: entry.release_id,
          folderId,
        }),
      });
      setSaved((current) => [...new Set([...current, senseId])]);
      setSelectedSense(null);
      privateResources.invalidate("vocabulary:");
    } finally {
      setSaving("");
    }
  }
  async function createFolder(name: string) {
    const result = await read<{ folder: DictionaryFolder }>(
      "/api/vocabulary/folders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    setFolders((current) =>
      current.some((folder) => folder.id === result.folder.id)
        ? current
        : [...current, { ...result.folder, count: 0 }],
    );
    privateResources.invalidate("vocabulary:");
    return result.folder;
  }
  const allOpen =
    entry?.senses.every((sense) => expanded.includes(sense.sense_id)) ?? false;
  const synonyms = [...new Map((entry?.relations.filter(relation=>["synonym","synonymy"].includes(relation.relation_type.toLowerCase()))??[]).map(relation=>[relation.target_lexeme_id,relation])).values()];
  const relatedPhrases = entry?.relations.filter(relation=>
    ['phrase','idiom','phrasal_verb','fixed_expression','collocation'].includes(relation.lexical_type)
    && (' '+relation.display_lemma.normalize('NFKC').toLowerCase().replace(/[-\s]+/gu,' ').trim()+' ').includes(' '+entry.display_lemma.normalize('NFKC').toLowerCase().replace(/[-\s]+/gu,' ').trim()+' ')
    && relation.display_lemma.toLocaleLowerCase()!==entry.display_lemma.toLocaleLowerCase()
  )??[];

  return (
    <section className="dictionary-reader card mx-auto w-full max-w-[1120px]" data-global-dictionary>
      <form className="dictionary-search" role="search" onSubmit={(event) => {event.preventDefault();setSearchRun(value=>value+1);}}>
        <button type="submit" className="dictionary-search-submit" aria-label={t.search} title={t.search}><span aria-hidden>⌕</span></button>
        <input aria-label={t.search} placeholder={t.search} maxLength={80} value={query} role="combobox" aria-autocomplete="list" aria-controls={!entry?"dictionary-results":undefined} aria-expanded={!entry&&hits.length>0} aria-activedescendant={!entry&&active>=0?`dictionary-hit-${active}`:undefined}
          onChange={event=>setQuery(event.target.value)}
          onKeyDown={event=>{if(entry||!hits.length)return;if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setActive(index=>event.key==="ArrowDown"?Math.min(index+1,hits.length-1):Math.max(0,index-1));}if(event.key==="Enter"&&hits[active>=0?active:0]){event.preventDefault();void open(hits[active>=0?active:0]!);}}}
        />
        {query&&<button type="button" className="dictionary-clear" aria-label={t.clear} onClick={()=>setQuery("")}>×</button>}
        <div className="dictionary-directions" role="group" aria-label={t.search}>
          {(["EN","UZ"] as const).map(lang=><button key={lang} type="button" aria-pressed={direction===lang} onClick={()=>{setDirection(lang);setRelease("");}}>{lang}</button>)}
        </div>
      </form>
      {error&&<div role="alert" className="dictionary-error"><p>{error}</p><button type="button" onClick={()=>{setEntry(null);setRelease("");setRetry(value=>value+1);}}>{t.retry}</button></div>}
      {!entry&&<div className="dictionary-results-area">
        {loading?<div role="status" aria-label={dict.common.loading} className="space-y-3">{[0,1,2].map(index=><div key={index} className="dictionary-loading h-20 animate-pulse"/>)}</div>:
          !query.trim()?<>
            {!owner&&<DictionaryRecentSearches recent={recent} title={t.recent} clearLabel={t.clear} onOpen={item=>void open(item,item.query_display,item.direction)} onClear={()=>{void read("/api/dictionary/recent",{method:"DELETE"}).then(()=>setRecent([])).catch(()=>setError(t.unavailable));}}/>}
            {!recent.length&&<div className="dictionary-empty"><h2>{t.startTitle}</h2><p>{t.startHint}</p></div>}
          </>:<>
            <h2 className="dictionary-list-title">{t.results}</h2>
            {!error&&!hits.length&&<p className="dictionary-empty">{t.empty}</p>}
            <ul id="dictionary-results" role="listbox" aria-label={t.results} className="dictionary-result-list">
              {hits.map((hit,index)=><li key={hit.lexeme_id} role="option" aria-selected={active===index} id={`dictionary-hit-${index}`}>
                <button type="button" className="dictionary-result-row" data-active={active===index} onClick={()=>void open(hit)}>
                  <span className="dictionary-result-heading"><strong>{hit.display_lemma}</strong><span className="dictionary-pos">{dictionaryPos(hit.part_of_speech)}</span></span>
                  <span className="dictionary-preview">{hit.translation_uz}</span>
                </button>
              </li>)}
            </ul>
          </>}
      </div>}
      {entry&&<article className="dictionary-entry" data-dictionary-entry>
        <nav className="dictionary-entry-nav" aria-label={t.allSenses}><button type="button" onClick={()=>{request.current++;setEntry(null);setSelectedSense(null);setLoading(false);}}>{t.back}</button></nav>
        <header className="dictionary-entry-heading"><div><div className="dictionary-word-heading"><h2>{entry.display_lemma}</h2><DictionaryPronunciation key={entry.lexeme_id} word={entry.display_lemma} label={dict.vocabulary.games.pronounce} unavailable={t.pronunciationUnavailable}/></div><div className="dictionary-entry-meta"><span className="dictionary-pos">{dictionaryPos(entry.part_of_speech)}</span>{entry.pronunciations.map((pronunciation,index)=><span key={index}>/{pronunciation.ipa}/</span>)}</div></div>
          <button type="button" className="dictionary-expand-all" onClick={()=>setExpanded(allOpen?[]:entry.senses.map(sense=>sense.sense_id))}>{allOpen?t.collapseAll:t.expandAll}</button>
        </header>
        <div className="dictionary-meanings">
          {entry.senses.map((sense,index)=>{const isExpanded=expanded.includes(sense.sense_id),isSaved=saved.includes(sense.sense_id);return <section key={sense.sense_id} className="dictionary-meaning" data-dictionary-sense={sense.sense_id}>
            <div className="dictionary-meaning-header">
              {!owner&&<button type="button" className="dictionary-add-meaning" aria-label={isSaved?t.saved:t.save} title={isSaved?t.saved:t.save} disabled={!!saving||isSaved} onClick={()=>setSelectedSense(sense)}><span aria-hidden>{isSaved?"✓":"+"}</span><span className="sr-only">{isSaved?t.saved:t.save}</span></button>}
              <h3><button type="button" className="dictionary-meaning-toggle" aria-expanded={isExpanded} aria-controls={`dictionary-sense-${sense.sense_id}`} onClick={()=>setExpanded(current=>isExpanded?current.filter(id=>id!==sense.sense_id):[...current,sense.sense_id])}>
                <strong>{entry.senses.length>1?`${index+1}. `:""}{sense.translations.map(translation=>translation.text).join(" / ")}</strong><span className="dictionary-pos">{dictionaryPos(entry.part_of_speech)}</span>{sense.cefr&&<span className="dictionary-level">{sense.cefr}</span>}<span aria-hidden className="dictionary-chevron">{isExpanded?"⌃":"⌄"}</span>
              </button></h3>
            </div>
            {isExpanded&&<div id={`dictionary-sense-${sense.sense_id}`} className="dictionary-meaning-body">
              <div className="dictionary-definition"><h4>{t.english}</h4><p>{sense.definition_en}</p></div>
              <hr className="dictionary-translation-divider"/><div className="dictionary-definition"><h4>{t.definition}</h4><p>{sense.definition_uz}</p></div>
              {sense.examples.length>0&&<div className="dictionary-examples" aria-label={t.examples}>{sense.examples.slice(0,2).map(example=><blockquote key={example.example_id}><p>• {example.text_en}</p><p lang="uz">{example.text_uz}</p></blockquote>)}</div>}
              {sense.examples.length>2&&<details className="dictionary-disclosure"><summary>{t.moreExamples}</summary><div className="dictionary-examples">{sense.examples.slice(2).map(example=><blockquote key={example.example_id}><p>• {example.text_en}</p><p lang="uz">{example.text_uz}</p></blockquote>)}</div></details>}
              {owner&&<div className="dictionary-owner-controls"><p>{sense.editorial&&sense.editorial.translation_status!=="human_reviewed"?dict.vocabulary.contextUnverified:t.upstream}</p><button type="button" onClick={()=>onEdit?.(entry,sense)}>{t.edit}</button></div>}
            </div>}
          </section>;})}
        </div>
        <div className="dictionary-word-details">
          <details className="dictionary-disclosure"><summary>{t.synonyms}</summary><div className="dictionary-related-items">{synonyms.length?synonyms.map((relation,index)=><button type="button" key={index} onClick={()=>void open({lexeme_id:relation.target_lexeme_id,display_lemma:relation.display_lemma},relation.display_lemma,"EN")}>{relation.display_lemma}</button>):<p>{t.noSynonyms}</p>}</div></details>
          <details className="dictionary-disclosure"><summary>{t.collocations}</summary><div className="dictionary-collocations">
            {entry.collocations.map((item,index)=><p key={index}><strong>{item.text}</strong></p>)}
            {relatedPhrases.map((relation,index)=><button type="button" key={index} onClick={()=>void open({lexeme_id:relation.target_lexeme_id,display_lemma:relation.display_lemma},relation.display_lemma,"EN")}>{relation.display_lemma}</button>)}
            {!entry.collocations.length&&!relatedPhrases.length&&<p>{t.noCollocations}</p>}
          </div></details>
        </div>
        {owner&&<button type="button" className="dictionary-owner-action" onClick={()=>onAddSense?.(entry)}>{t.addSense}</button>}
      </article>}
      {!owner&&entry&&selectedSense&&<DictionaryFolderDialog dict={dict} entry={entry} sense={selectedSense} folders={folders} saving={!!saving} onClose={()=>setSelectedSense(null)} onSave={save} onCreate={createFolder}/>}
      {owner&&<button type="button" className="dictionary-owner-action" onClick={onAddWord}>{t.custom}</button>}
    </section>
  );
}
