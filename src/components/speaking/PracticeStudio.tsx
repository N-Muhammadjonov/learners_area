"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { parsePart, PRACTICE_PARTS, type PracticePart } from "@/lib/speaking/practice-browse";
import { studySupportSchema, type SpeakingStudySupport } from "@/lib/speaking/study-support";
import { LocalAnswerRecorder } from "./LocalAnswerRecorder";
import { StudySupportPanel } from "./StudySupportPanel";

/*
 * Practice on your own: Part → Topic → Questions. The selection lives in the URL (?part=&topic=) so
 * Back, reload and shared links land on the same step. Steps use history.pushState (which Next's router
 * observes through useSearchParams), so changing step costs no server round trip. Each question renders
 * its own recorder; only one may hold the microphone at a time.
 *
 * §04 — WHAT CHANGED, AND WHAT DID NOT.
 *
 * This component used to receive the ENTIRE published bank as a prop and do its part counts, topic
 * grouping and search filtering in the browser. At 10 000 prompts that meant 10 007 rows read and
 * 6.15 MB shipped per page view, growing with the corpus — and worse, a learner could only ever browse
 * what the server had been willing to send, so questions past that payload were unreachable through the
 * journey even though they were published.
 *
 * All three now come from bounded, server-authoritative reads:
 *
 *   GET /api/speaking/practice/facets      part counts, then topic discovery for one part
 *   GET /api/speaking/practice/questions   one page of questions for a part+topic, with a keyset cursor
 *   GET /api/speaking/prompts/:id/support  study support for the ONE question selected
 *
 * The journey, the breadcrumb, the ?part=/&topic= contract, the aria-live status region, every
 * data-practice-* hook, the markup and the classes are unchanged — this is not a redesign. What is new
 * is deliberately minimal and only where honesty requires it: a continuation control when more topics
 * or more questions exist behind the current page, and visible loading and failure states. Pages are
 * never fetched automatically in a loop, because walking every page on entry would merely recreate the
 * unbounded payload through repeated requests.
 *
 * Types are declared locally rather than imported from lib/data/speaking-practice: that module pulls in
 * the database client, and a client component must not carry it into the browser bundle even for types.
 */

type PartFacet = { part: string; count: number };
type TopicFacet = { key: string; title: string | null; count: number };
type FacetsResponse = {
  parts: PartFacet[];
  topics: TopicFacet[];
  topicCount: number;
  hasMoreTopics: boolean;
  nextTopicCursor: string | null;
  matching: number;
};
type PagedPrompt = {
  id: string;
  part: string;
  topic: string | null;
  promptText: string;
  cueCard: string | null;
  prepSeconds: number;
  answerSeconds: number;
};
type QuestionsResponse = {
  prompts: PagedPrompt[];
  hasMore: boolean;
  nextCursor: string | null;
  matching: number;
  pageSize: number;
};
type SupportResponse = { promptId: string; support: SpeakingStudySupport };

/** How long a keystroke pauses before it becomes a server search, so typing does not fire a query per character. */
const SEARCH_DEBOUNCE_MS = 250;

export function PracticeStudio({ dict }: { dict: Dictionary }) {
  const t = dict.speakingPractice;
  const study = dict.speakingStudy;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const part = parsePart(searchParams.get("part"));
  const topicKey = searchParams.get("topic");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── server-authoritative discovery state ──────────────────────────────────────────────────────
  const [partCounts, setPartCounts] = useState<Record<string, number> | null>(null);
  const [partsFailed, setPartsFailed] = useState(false);

  const [topics, setTopics] = useState<TopicFacet[] | null>(null);
  const [topicTotal, setTopicTotal] = useState(0);
  const [topicCursor, setTopicCursor] = useState<string | null>(null);
  const [topicsFailed, setTopicsFailed] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);

  const [prompts, setPrompts] = useState<PagedPrompt[] | null>(null);
  const [promptTotal, setPromptTotal] = useState(0);
  const [promptCursor, setPromptCursor] = useState<string | null>(null);
  const [promptsFailed, setPromptsFailed] = useState(false);
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  /*
   * §02 — RETRY HAS TO BE A REAL STATE CHANGE.
   *
   * Each fetch is driven by an effect keyed on its own inputs, so a retry must change one of those
   * inputs or nothing happens. The topics Retry button used to call `setSearch((s) => s)`: an identity
   * updater is not a state change, React bails out of the render, the effect never re-runs, and the
   * button was inert — the learner saw "Try again", pressed it, and nothing happened. A full
   * `window.location.reload()` for the parts failure did recover, but at the cost of the whole screen:
   * the selected part and topic, every page already loaded, and any recording in progress.
   *
   * These counters are the honest mechanism. Bumping one re-runs exactly the effect that failed and
   * nothing else, so a retry recovers the request without discarding the learner's place — which is the
   * entire reason the data is fetched in bounded pages rather than in one unbounded payload.
   */
  const [retryNonce, setRetryNonce] = useState({ parts: 0, topics: 0, prompts: 0 });
  const retryParts = useCallback(() => setRetryNonce((n) => ({ ...n, parts: n.parts + 1 })), []);
  const retryTopics = useCallback(() => setRetryNonce((n) => ({ ...n, topics: n.topics + 1 })), []);
  const retryPrompts = useCallback(() => setRetryNonce((n) => ({ ...n, prompts: n.prompts + 1 })), []);

  const [support, setSupport] = useState<SupportResponse | null>(null);
  const [supportFailed, setSupportFailed] = useState(false);
  const [loadingSupport, setLoadingSupport] = useState(false);

  /*
   * Stale-response protection. Every fetch family carries a monotonically increasing token; a response
   * is applied only if its token is still the newest. Without this, selecting Part 2 then Part 3 quickly
   * could render Part 2's topics over Part 3's, and — worse for §4.3 — selecting question B then C could
   * leave B's study support on screen under C's heading.
   */
  const tokens = useRef({ parts: 0, topics: 0, prompts: 0, support: 0 });
  const debouncedSearchRef = useRef(search);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  debouncedSearchRef.current = debouncedSearch;

  // Part counts: one bounded aggregate, fetched once. Nothing here depends on the selection.
  useEffect(() => {
    const token = ++tokens.current.parts;
    const controller = new AbortController();
    setPartsFailed(false);
    fetch("/api/speaking/practice/facets?channel=practice_alone", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`facets ${response.status}`);
        return (await response.json()) as FacetsResponse;
      })
      .then((facets) => {
        if (token !== tokens.current.parts) return;
        const counts: Record<string, number> = {};
        for (const row of facets.parts) counts[row.part] = row.count;
        setPartCounts(counts);
      })
      .catch((error: unknown) => {
        if (token !== tokens.current.parts) return;
        if ((error as Error)?.name === "AbortError") return;
        setPartCounts(null);
        setPartsFailed(true);
      });
    return () => controller.abort();
  }, [retryNonce.parts]);

  // Topic discovery for the chosen part, narrowed by the server-side search. Reset only when the part
  // or the search term genuinely changes — §4.1: not resetting would show the wrong part's topics, and
  // resetting on every render would throw away pages the learner had already loaded.
  useEffect(() => {
    if (!part) {
      setTopics(null);
      setTopicTotal(0);
      setTopicCursor(null);
      setTopicsFailed(false);
      setLoadingTopics(false);
      return;
    }
    const token = ++tokens.current.topics;
    const controller = new AbortController();
    const query = new URLSearchParams({ channel: "practice_alone", part });
    if (debouncedSearch) query.set("q", debouncedSearch);
    setTopics(null);
    setTopicsFailed(false);
    setLoadingTopics(true);
    fetch(`/api/speaking/practice/facets?${query.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`facets ${response.status}`);
        return (await response.json()) as FacetsResponse;
      })
      .then((facets) => {
        if (token !== tokens.current.topics) return;
        setTopics(facets.topics);
        setTopicTotal(facets.topicCount);
        setTopicCursor(facets.nextTopicCursor);
        setLoadingTopics(false);
      })
      .catch((error: unknown) => {
        if (token !== tokens.current.topics) return;
        if ((error as Error)?.name === "AbortError") return;
        setTopics(null);
        setTopicsFailed(true);
        setLoadingTopics(false);
      });
    return () => controller.abort();
  }, [part, debouncedSearch, retryNonce.topics]);

  // One bounded page of questions for the chosen part+topic.
  useEffect(() => {
    if (!part || !topicKey) {
      setPrompts(null);
      setPromptTotal(0);
      setPromptCursor(null);
      setPromptsFailed(false);
      setLoadingPrompts(false);
      return;
    }
    const token = ++tokens.current.prompts;
    const controller = new AbortController();
    const query = new URLSearchParams({ channel: "practice_alone", part, topic: topicKey });
    setPrompts(null);
    setPromptsFailed(false);
    setLoadingPrompts(true);
    fetch(`/api/speaking/practice/questions?${query.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`questions ${response.status}`);
        return (await response.json()) as QuestionsResponse;
      })
      .then((page) => {
        if (token !== tokens.current.prompts) return;
        setPrompts(page.prompts);
        setPromptTotal(page.matching);
        setPromptCursor(page.nextCursor);
        setLoadingPrompts(false);
      })
      .catch((error: unknown) => {
        if (token !== tokens.current.prompts) return;
        if ((error as Error)?.name === "AbortError") return;
        setPrompts(null);
        setPromptsFailed(true);
        setLoadingPrompts(false);
      });
    return () => controller.abort();
  }, [part, topicKey, retryNonce.prompts]);

  const go = useCallback((nextPart: PracticePart | null, nextTopic: string | null) => {
    setSearch(""); setSelectedId(null);
    const qs = new URLSearchParams();
    if (nextPart) qs.set("part", nextPart);
    if (nextTopic) qs.set("topic", nextTopic);
    const query = qs.toString();
    window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [pathname]);

  const onBusyChange = useCallback((id: string, busy: boolean) => {
    setBusyId((current) => (busy ? id : current === id ? null : current));
  }, []);

  const locked = busyId !== null;
  const selected = prompts?.find((p) => p.id === selectedId) ?? prompts?.[0] ?? null;

  /*
   * A topic in the URL counts as chosen while its page is still loading, so the questions step can show
   * its own loading state instead of flashing back to the topic list. Once the server has answered, an
   * unknown or empty topic resolves to "no topic chosen" — the same behaviour `resolveTopic` had when it
   * returned null for a key that was not in the groups.
   */
  /*
   * §02 — a null page means "no answer yet", whether that is still loading or has failed, and in both
   * cases the learner must stay on the topic they opened. The previous condition treated a failure as
   * "not resolved", which dropped `step` back to "topic": a learner who deep-linked to
   * ?part=part1&topic=hometown was silently thrown back to the topic list with no error and no retry,
   * and a network failure became indistinguishable from an empty topic. Only a *successful* empty page
   * should fall back, because that genuinely means the topic key is unknown.
   */
  const topicResolved = topicKey !== null && (prompts === null ? true : promptTotal > 0);
  const step = !part ? "part" : !topicResolved ? "topic" : "questions";

  // Study support for the selected question only, fetched when it is selected. §4.3: never prefetched
  // for the bank, and never left showing the previous question's support.
  useEffect(() => {
    const token = ++tokens.current.support;
    if (!selected) {
      setSupport(null);
      setSupportFailed(false);
      setLoadingSupport(false);
      return;
    }
    const controller = new AbortController();
    setSupport(null);
    setSupportFailed(false);
    setLoadingSupport(true);
    fetch(`/api/speaking/prompts/${selected.id}/support?channel=practice_alone`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`support ${response.status}`);
        return (await response.json()) as SupportResponse;
      })
      .then((payload) => {
        if (token !== tokens.current.support) return;
        // The server echoes the prompt id; refusing a mismatch is what guarantees a slow response for
        // question B can never be rendered under question C's heading.
        const parsed = payload.promptId === selected.id ? studySupportSchema.safeParse(payload.support) : null;
        if (!parsed?.success) {
          setSupport(null);
          setSupportFailed(true);
        } else {
          setSupport({ promptId: payload.promptId, support: parsed.data });
        }
        setLoadingSupport(false);
      })
      .catch((error: unknown) => {
        if (token !== tokens.current.support) return;
        if ((error as Error)?.name === "AbortError") return;
        setSupport(null);
        setSupportFailed(true);
        setLoadingSupport(false);
      });
    return () => controller.abort();
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMoreTopics = useCallback(async () => {
    if (!part || !topicCursor) return;
    const token = tokens.current.topics;
    const query = new URLSearchParams({ channel: "practice_alone", part, topicCursor });
    if (debouncedSearchRef.current) query.set("q", debouncedSearchRef.current);
    setLoadingTopics(true);
    try {
      const response = await fetch(`/api/speaking/practice/facets?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`facets ${response.status}`);
      const facets = (await response.json()) as FacetsResponse;
      if (token !== tokens.current.topics) return; // the part or search changed underneath us
      setTopics((current) => {
        const seen = new Set((current ?? []).map((topic) => topic.key));
        // Append, de-duplicated by key: a page must never show one topic twice.
        return [...(current ?? []), ...facets.topics.filter((topic) => !seen.has(topic.key))];
      });
      setTopicTotal(facets.topicCount);
      setTopicCursor(facets.nextTopicCursor);
    } catch {
      if (token === tokens.current.topics) setTopicsFailed(true);
    } finally {
      if (token === tokens.current.topics) setLoadingTopics(false);
    }
  }, [part, topicCursor]);

  const loadMoreQuestions = useCallback(async () => {
    if (!part || !topicKey || !promptCursor) return;
    const token = tokens.current.prompts;
    const query = new URLSearchParams({ channel: "practice_alone", part, topic: topicKey, cursor: promptCursor });
    setLoadingPrompts(true);
    try {
      const response = await fetch(`/api/speaking/practice/questions?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`questions ${response.status}`);
      const page = (await response.json()) as QuestionsResponse;
      if (token !== tokens.current.prompts) return;
      setPrompts((current) => {
        const seen = new Set((current ?? []).map((prompt) => prompt.id));
        return [...(current ?? []), ...page.prompts.filter((prompt) => !seen.has(prompt.id))];
      });
      setPromptTotal(page.matching);
      setPromptCursor(page.nextCursor);
    } catch {
      if (token === tokens.current.prompts) setPromptsFailed(true);
    } finally {
      if (token === tokens.current.prompts) setLoadingPrompts(false);
    }
  }, [part, topicKey, promptCursor]);

  const retrySupport = useCallback(async () => {
    if (!selected) return;
    const token = ++tokens.current.support;
    setSupportFailed(false);
    setLoadingSupport(true);
    try {
      const response = await fetch(`/api/speaking/prompts/${selected.id}/support?channel=practice_alone`, { cache: "no-store" });
      if (!response.ok) throw new Error(`support ${response.status}`);
      const payload = (await response.json()) as SupportResponse;
      if (token !== tokens.current.support) return;
      const parsed = payload.promptId === selected.id ? studySupportSchema.safeParse(payload.support) : null;
      if (!parsed?.success) {
        setSupportFailed(true);
      } else {
        setSupport({ promptId: payload.promptId, support: parsed.data });
      }
    } catch {
      if (token === tokens.current.support) setSupportFailed(true);
    } finally {
      if (token === tokens.current.support) setLoadingSupport(false);
    }
  }, [selected]);

  // The topics actually on screen — the same list the learner sees, so the status region can never
  // announce a count that disagrees with what is rendered.
  const visibleTopicCount = step === "topic" ? (topics?.length ?? 0) : 0;
  const topicTitle = useMemo(() => {
    if (!topicKey) return null;
    const fromFacets = topics?.find((topic) => topic.key === topicKey);
    if (fromFacets) return fromFacets.title;
    // A deep link or reload can name a topic that is not on the first discovery page. The question rows
    // carry their own topic, so the heading is still the teacher's real wording rather than a guess.
    const fromPrompt = (selected ?? prompts?.[0])?.topic?.trim();
    return fromPrompt || null;
  }, [topicKey, topics, selected, prompts]);

  /*
   * Status region (WCAG 4.1.3). Every step change here replaces the whole content region through
   * history.pushState, and the topic list re-filters on each keystroke. Neither causes a server
   * navigation or moves focus, so a screen reader announces nothing: a learner who activated "Part 2"
   * got silence while the entire visible page was swapped out. The browser matrix measured this.
   *
   * The message is composed only from strings the dictionary already carries in BOTH locales, so nothing
   * can be announced in a language the dictionary lacks. It is visually hidden, which keeps the
   * protected theme and layout exactly as they were. The question count is now the server's true total
   * for the topic rather than the length of a loaded page, so it no longer under-reports a long topic.
   */
  const statusMessage =
    step === "part" ? t.choosePart
    : step === "topic"
      ? `${part ? t.part[part] : ""} — ${(visibleTopicCount === 1 ? t.topicCountOne : t.topicCount).replace("{n}", String(visibleTopicCount))}`
      // `dict.common.error` rather than `errorLabel`: statusMessage is computed above those label
      // constants, so referencing one here is a use-before-declaration.
      : prompts === null && promptsFailed ? dict.common.error
      : `${topicTitle ?? t.untitledTopic} — ${t.questionCount.replace("{n}", String(promptTotal))}`;

  const loadingLabel = dict.common.loading;
  const errorLabel = dict.common.error;
  const retryLabel = dict.errorPage.retry;

  return (
    <div className="flex flex-col gap-5" data-practice-step={step}>
      <p role="status" aria-live="polite" className="sr-only" data-practice-status>{statusMessage}</p>

      <nav aria-label={t.stepsLabel} className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <button type="button" className="min-h-11 rounded-md px-2 hover:text-ink-900 disabled:opacity-50" disabled={locked} onClick={() => go(null, null)} data-practice-crumb="part">{t.choosePart}</button>
        {part && <><span aria-hidden>›</span><button type="button" className="min-h-11 rounded-md px-2 hover:text-ink-900 disabled:opacity-50" disabled={locked} onClick={() => go(part, null)} data-practice-crumb="topic">{t.part[part]}</button></>}
        {step === "questions" && <><span aria-hidden>›</span><span className="px-2 text-ink-900" aria-current="page">{topicTitle ?? t.untitledTopic}</span></>}
      </nav>

      {step === "part" && (
        partsFailed ? (
          <p className="text-sm text-ink-500" data-practice-error="parts">
            {errorLabel}{" "}
            <button type="button" className="min-h-11 rounded-md underline" onClick={retryParts} data-practice-retry="parts">{retryLabel}</button>
          </p>
        ) : (
          <div className="motion-enter-stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4" data-practice-parts>
            {PRACTICE_PARTS.map((p, index) => (
              <button key={p} type="button" onClick={() => go(p, null)} data-practice-part={p}
                className="practice-part-card motion-lift relative flex min-h-64 flex-col items-start gap-3 overflow-hidden rounded-3xl border p-6 text-left disabled:cursor-not-allowed disabled:opacity-50">
                <span aria-hidden="true" className="practice-part-number">{index + 1}</span>
                <span className="practice-part-mic" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/></svg></span>
                <span className="practice-part-label text-sm font-bold uppercase tracking-widest">{t.part[p]}</span>
                <span className="relative font-display text-3xl font-bold text-ink-900">{t.partTitle[p]}</span>
                <span className="relative text-base text-ink-500">{t.partBody[p]}</span>
                <span className="mt-auto text-xs text-ink-500" data-practice-part-count={p}>
                  {partCounts === null ? loadingLabel : t.questionCount.replace("{n}", String(partCounts[p] ?? 0))}
                </span>
              </button>
            ))}
          </div>
        )
      )}

      {step === "topic" && part && (
        topicsFailed && topics === null ? (
          <p className="text-sm text-ink-500" data-practice-error="topics">
            {errorLabel}{" "}
            <button type="button" className="min-h-11 rounded-md underline" onClick={retryTopics} data-practice-retry="topics">{retryLabel}</button>
          </p>
        ) : (
          <div className="space-y-4">
            <input aria-label={study.searchTopics} className="input" placeholder={study.searchTopics} value={search} onChange={(e) => setSearch(e.target.value)} data-practice-search />
            {topics === null ? (
              <p className="text-sm text-ink-500" data-practice-loading="topics">{loadingLabel}</p>
            ) : topics.length === 0 ? (
              // A search that matched nothing says so; an empty Part says the Part is empty. Reusing
              // `shell.noResults` keeps both locales correct without adding a dictionary key.
              <p className="text-sm text-ink-500" data-practice-empty="topics">{debouncedSearch ? dict.shell.noResults : t.noQuestionsInPart}</p>
            ) : (
              <>
                <ul className="grid gap-3 sm:grid-cols-2" data-practice-topics>
                  {topics.map((g) => (
                    <li key={g.key}>
                      <button type="button" onClick={() => go(part, g.key)} data-practice-topic={g.key}
                        className="card flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-paper-sunken">
                        <span className="text-base text-ink-900">{g.title ?? t.untitledTopic}</span>
                        <span className="shrink-0 text-xs text-ink-500">{t.questionCount.replace("{n}", String(g.count))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {/*
                 * Continuation, not automatic exhaustion. A centre with more topics than one page carries
                 * must be able to reach the rest; fetching every page on entry would rebuild the very
                 * unbounded payload this component exists to remove.
                 */}
                {topicCursor && (
                  <button type="button" onClick={() => void loadMoreTopics()} disabled={locked || loadingTopics}
                    className="btn-secondary min-h-11 disabled:opacity-50" data-practice-more-topics>
                    {loadingTopics ? loadingLabel : `${dict.common.continue} · ${t.topicCount.replace("{n}", String(Math.max(topicTotal - topics.length, 0)))}`}
                  </button>
                )}
                {topicsFailed && (
                  <p className="text-sm text-ink-500" data-practice-error="topics-more">
                    {errorLabel}{" "}
                    {/* The cursor survives a failed continuation, so re-running it resumes from the same
                        place — this is a retry of page N, not a restart from page 1. */}
                    <button type="button" className="min-h-11 rounded-md underline" disabled={loadingTopics}
                      onClick={() => void loadMoreTopics()} data-practice-retry="topics-more">{retryLabel}</button>
                  </p>
                )}
              </>
            )}
          </div>
        )
      )}

      {step === "questions" && prompts === null && promptsFailed && (
        <p className="text-sm text-ink-500" data-practice-error="questions">
          {errorLabel}{" "}
          <button type="button" className="min-h-11 rounded-md underline" onClick={retryPrompts} data-practice-retry="questions">{retryLabel}</button>
        </p>
      )}

      {step === "questions" && selected && (
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2" data-practice-questions={topicKey ?? ""}>
          <section className="card min-w-0 space-y-4 p-5 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto" data-practice-question-column>
            <h2 className="font-display text-xl">{part === "part2" ? study.yourCue : study.questions}</h2>
            {prompts === null ? (
              <p className="text-sm text-ink-500" data-practice-loading="questions">{loadingLabel}</p>
            ) : (
              <>
                <ol className="space-y-3">
                  {prompts.map((p, i) => <li key={p.id} className={`rounded-2xl border p-4 ${selected.id === p.id ? "border-accent-500 bg-paper-sunken" : "border-ink-100"}`}>
                    <button type="button" className="w-full text-left text-lg font-semibold" disabled={locked && selected.id !== p.id} onClick={() => setSelectedId(p.id)} data-practice-question={p.id}>{i + 1}. {p.promptText}</button>
                    <div hidden={selected.id !== p.id}>
                      {p.cueCard && <p className="mt-3 whitespace-pre-wrap text-ink-500">{p.cueCard}</p>}
                      {part === "part2" && <p className="mt-3 text-sm">{study.prepare} 1:00 · {study.talk} 2:00</p>}
                      <LocalAnswerRecorder dict={dict} id={p.id} part={p.part} active={selected.id === p.id} lockedBy={busyId} onBusyChange={onBusyChange} />
                    </div>
                  </li>)}
                </ol>
                {promptCursor && (
                  <button type="button" onClick={() => void loadMoreQuestions()} disabled={locked || loadingPrompts}
                    className="btn-secondary min-h-11 disabled:opacity-50" data-practice-more-questions>
                    {loadingPrompts ? loadingLabel : `${dict.common.continue} · ${t.questionCount.replace("{n}", String(Math.max(promptTotal - prompts.length, 0)))}`}
                  </button>
                )}
                {promptsFailed && (
                  <p className="text-sm text-ink-500" data-practice-error="questions-more">
                    {errorLabel}{" "}
                    <button type="button" className="min-h-11 rounded-md underline" disabled={loadingPrompts}
                      onClick={() => void loadMoreQuestions()} data-practice-retry="questions-more">{retryLabel}</button>
                  </p>
                )}
              </>
            )}
          </section>
          <div className="min-w-0 space-y-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto" data-practice-support-column>
            <h2 className="text-lg font-semibold" data-practice-selected>{selected.promptText}</h2>
            {/*
             * §4.3 — loading and failure are visually and programmatically distinct, and neither can be
             * mistaken for the previous question's support: the panel is keyed by prompt id AND rendered
             * only when the payload in state belongs to that same id.
             */}
            {loadingSupport || (support !== null && support.promptId !== selected.id) ? (
              <section className="card relative flex min-h-96 items-center p-5 text-sm text-ink-500" data-practice-support="loading">{loadingLabel}</section>
            ) : supportFailed || support === null ? (
              <section className="card relative flex min-h-96 flex-col items-start justify-center gap-3 p-5 text-sm text-ink-500" data-practice-support="error">
                <span>{errorLabel}</span>
                <button type="button" className="btn-secondary min-h-11" onClick={() => void retrySupport()} data-practice-support-retry>{retryLabel}</button>
              </section>
            ) : (
              <StudySupportPanel dict={dict} key={selected.id} promptId={selected.id} support={support.support} />
            )}
          </div>
        </div>
      )}

      {step === "questions" && !selected && (
        <p className="text-sm text-ink-500" data-practice-loading="questions">
          {promptsFailed ? errorLabel : loadingLabel}
        </p>
      )}
    </div>
  );
}
