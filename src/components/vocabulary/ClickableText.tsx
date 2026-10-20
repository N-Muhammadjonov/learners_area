"use client";

import { privateResources } from "@/lib/client/private-resource";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import { phraseTarget } from "@/lib/services/lexical/phrase-target";
import type { Dictionary } from "@/lib/i18n/en";

/** Shared, selectable learning text with one keyboard stop per text region. */
export function ClickableText(props: {
  dict: Dictionary;
  text: string;
  sourceType: string;
  sourceId: string;
  className?: string;
  inline?: boolean;
  occurrences?: OccurrenceSpan[];
  catalogueLookup?: boolean;
  /** General Reading: an authored phrase wins over its individual words. */
  phraseAware?: boolean;
  /**
   * False where the Listening mode forbids lexical help (src/lib/listening/lexical-policy.ts):
   * no word targets, lookup or vocabulary styling. Highlighting is independently opt-in.
   */
  lexicalAssistance?: boolean;
  /**
   * The learner's own highlights over THIS text, as character ranges in `text`.
   *
   * Optional and off by default: every existing surface renders exactly as it did. The
   * ranges decorate the visible text only — they are never derived from an answer, a key or
   * an explanation, and they never change what is rendered as text.
   */
  highlights?: TextHighlight[];
  /**
   * Called with the range of the learner's current selection inside this text. Providing it
   * turns on the small highlight control; leaving it out keeps the surface read-only.
   */
  onHighlightRange?: (range: { start: number; end: number }) => void;
  /** Remove one of the learner's own highlights (by its id). */
  onRemoveHighlight?: (id: string) => void;
}) {
  const Plain = props.inline ? "span" : "div";
  if (props.lexicalAssistance === false && !props.onHighlightRange && !props.highlights?.length) return <Plain className={`whitespace-pre-line ${props.className ?? ""}`} data-plain-text>{props.text}</Plain>;
  // A changed source/text cannot keep an anchor or an async form from the old text.
  return <LexicalText key={JSON.stringify([props.sourceType, props.sourceId, props.text])} {...props} />;
}

function LexicalText({ dict, text, sourceType, sourceId, className = "", inline = false, occurrences = [], catalogueLookup = false, phraseAware = ["reading", "listening", "retention"].includes(sourceType), lexicalAssistance = true, highlights = [], onHighlightRange, onRemoveHighlight }: Parameters<typeof ClickableText>[0]) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const gesture = useRef<{ x: number; y: number; started: number; cancelled: boolean } | null>(null);
  const tokens = useMemo(() => tokenise(text), [text]);
  const words = useMemo(() => tokens.flatMap((token, index) => token.isWord ? [index] : []), [tokens]);
  const doubleClickLookup = ["reading", "listening", "retention"].includes(sourceType);
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pendingClick.current) clearTimeout(pendingClick.current); }, []);
  const hintId = useId();
  const cursorId = useId();
  const close = (restoreFocus = false) => {
    setActive(null);
    if (restoreFocus) wrapperRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (active === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setActive(null); wrapperRef.current?.focus({ preventScroll: true }); }
    }
    function onClickAway(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && !wrapperRef.current?.contains(target) && !target.closest("[data-word-popover]")) setActive(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClickAway);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onClickAway);
    };
  }, [active]);

  function open(index: number) {
    if (!lexicalAssistance) return;
    const word = wrapperRef.current?.querySelector<HTMLElement>(`[data-token="${index}"]`);
    if (!word) return;
    setAnchor(word);
    setActive((previous) => previous === index ? null : index);
  }

  // --- the learner's own highlights -----------------------------------------------------
  // A range is stored as plain character offsets, so it survives re-rendering, a reload and
  // any later layout: nothing about it depends on the DOM. Highlight permission is
  // separate from lexical permission; an exam can annotate already-visible text.
  const [selection, setSelection] = useState<{ start: number; end: number; box: { left: number; top: number } } | null>(null);
  const highlightAt = (start: number, end: number) =>
    highlights.find((highlight) => start < highlight.end && end > highlight.start) ?? null;
  const selected = active === null ? null : tokens[active]!;
  const contextualHits = selected ? occurrences.filter((row) => row.startChar <= selected.start && row.endChar >= selected.end) : [];
  const phrase = phraseAware && selected ? phraseTarget(text,selected,occurrences) : undefined;
  const occurrence = phrase ? phrase.occurrence : contextualHits.length === 1 ? contextualHits[0] : undefined;

  function captureSelection() {
    // A selection the learner made INSIDE this text is a highlight candidate. The
    // ranges are character offsets in the ORIGINAL string (never DOM nodes), so they
    // survive a re-render and a reload unchanged.
    if (!onHighlightRange) return;
    const block = wrapperRef.current;
    const native = window.getSelection();
    if (!block || !native || native.isCollapsed || native.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = native.getRangeAt(0);
    if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) {
      setSelection(null);
      return;
    }
    const start = offsetWithin(block, range.startContainer, range.startOffset);
    const end = offsetWithin(block, range.endContainer, range.endOffset);
    if (start === null || end === null) return;
    const [from, to] = start <= end ? [start, end] : [end, start];
    if (to - from < 1 || to > text.length) return;
    // Some engines (and jsdom) do not implement Range.getBoundingClientRect; the
    // control then simply sits at the top of the viewport instead of failing.
    let left = 8;
    let top = 8;
    try {
      const rect = range.getBoundingClientRect?.();
      if (rect) {
        left = rect.left + rect.width / 2;
        top = rect.top;
      }
    } catch {
      /* the placement is cosmetic; the range itself is already computed */
    }
    setSelection({ start: from, end: to, box: { left, top } });
  }

  const Region = inline ? "span" : "div";
  return (
    <Region className={className}>
      {lexicalAssistance && <span id={hintId} className="sr-only">{doubleClickLookup ? dict.vocabulary.textLookupDoubleHint : dict.vocabulary.textLookupHint}</span>}
      <Region
        ref={node => { wrapperRef.current = node; }}
        className="relative whitespace-pre-line outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-600"
        data-clickable-text={lexicalAssistance ? "true" : undefined}
        data-highlight-text={!lexicalAssistance ? "true" : undefined}
        data-highlight-surface={onHighlightRange ? "true" : undefined}
        role="group"
        tabIndex={words.length || onHighlightRange ? 0 : undefined}
        aria-label={lexicalAssistance ? dict.vocabulary.textLookup : dict.listening.general.highlight}
        aria-describedby={lexicalAssistance ? hintId : undefined}
        onPointerDown={(event) => {
          if (pendingClick.current) clearTimeout(pendingClick.current);
          setActive(null);
          gesture.current = { x: event.clientX, y: event.clientY, started: Date.now(), cancelled: event.button !== 0 };
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.cancelled = true;
        }}
        onPointerCancel={() => { if (gesture.current) gesture.current.cancelled = true; }}
        onContextMenu={() => { if (gesture.current) gesture.current.cancelled = true; }}
        onClick={(event) => {
          if (!lexicalAssistance || (doubleClickLookup && event.detail !== 0)) return;
          const start = gesture.current;
          gesture.current = null;
          if (event.detail > 1 || (start && (start.cancelled || Date.now() - start.started >= 500))) return;
          // Native selection/copy/highlighting owns this gesture, even for one word.
          if (!window.getSelection()?.isCollapsed) return;
          const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-token]") : null;
          if (target && wrapperRef.current?.contains(target)) {
            const index = Number(target.dataset.token);
            // Let a second click become native word selection before moving
            // focus into a dialog. Keyboard/assistive activation is immediate.
            if (event.detail === 0) open(index);
            else pendingClick.current = setTimeout(() => {
              if (window.getSelection()?.isCollapsed) open(index);
            }, 240);
          }
        }}
        onDoubleClick={(event) => {
          if (!lexicalAssistance || !doubleClickLookup || event.button !== 0 || gesture.current?.cancelled) return;
          const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-token]") : null;
          if (target && wrapperRef.current?.contains(target)) {
            if (pendingClick.current) clearTimeout(pendingClick.current);
            setSelection(null);
            open(Number(target.dataset.token));
          }
        }}
        onMouseUp={captureSelection}
        onKeyUp={onHighlightRange ? captureSelection : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && selection) {
            setSelection(null);
            return;
          }
          if (!lexicalAssistance) return;
          if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const previous = cursor === null ? -1 : words.indexOf(cursor);
            const next = event.key === "Home" ? 0 : event.key === "End" ? words.length - 1
              : event.key === "ArrowRight" ? Math.min(words.length - 1, previous + 1) : Math.max(0, previous - 1);
            const index = words[next];
            if (index !== undefined) {
              setCursor(index);
              wrapperRef.current?.querySelector<HTMLElement>(`[data-token="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
          } else if (event.key === "Enter" && words.length) {
            event.preventDefault();
            open(cursor ?? words[0]!);
          }
        }}
      >
        {tokens.map((token, index) => {
          const pieces = splitByHighlights(token, highlights);
          const body = pieces
            ? pieces.map((piece, pieceIndex) =>
                piece.highlightId ? (
                  <mark key={pieceIndex} data-highlight-id={piece.highlightId} className="rounded-sm bg-signal-100 text-ink-900">
                    {piece.value}
                  </mark>
                ) : (
                  <span key={pieceIndex}>{piece.value}</span>
                ),
              )
            : token.value;
          // A word keeps its own span (the popover finds it by `data-token`) even when it is
          // partly highlighted; the pieces above only choose the colours.
          return lexicalAssistance && token.isWord ? (
            <span key={index} data-word={token.clean} data-token={index}
              className={active === index || cursor === index ? "rounded-sm bg-signal-50 text-ink-900" : undefined}>
              {body}
            </span>
          ) : (
            <Fragment key={index}>{body}</Fragment>
          );
        })}
      </Region>
      <span id={cursorId} role="status" className="sr-only">{cursor === null ? "" : tokens[cursor]?.value}</span>
      {selection && onHighlightRange && (
        <span
          data-highlight-control
          role="group"
          aria-label={lexicalAssistance ? dict.vocabulary.textLookup : dict.listening.general.highlight}
          className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-ink-100 bg-paper px-2 py-1 shadow-lg"
          style={{ left: selection.box.left, top: Math.max(8, selection.box.top - 44) }}
        >
          {highlightAt(selection.start, selection.end) && onRemoveHighlight ? (
            <button
              type="button"
              className="btn-secondary min-h-9"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                const existing = highlightAt(selection.start, selection.end)!;
                onRemoveHighlight(existing.id);
                setSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              {dict.listening.general.clearHighlight}
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary min-h-9"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                onHighlightRange({ start: selection.start, end: selection.end });
                setSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              {dict.listening.general.highlight}
            </button>
          )}
        </span>
      )}
      {lexicalAssistance && active !== null && anchor && <WordPopover key={`${sourceType}:${sourceId}:${active}:${occurrence?.id ?? ""}`}
        anchor={anchor} dict={dict} word={phrase?.word ?? occurrence?.surfaceForm ?? tokens[active]!.clean} sourceType={sourceType} sourceId={sourceId} occurrenceId={occurrence?.id} catalogueLookup={catalogueLookup}
        onClose={() => close(true)} />}
    </Region>
  );
}

export function WordPopover({
  catalogueLookup = false,
  occurrenceId,
  anchor,
  dict,
  word,
  sourceType,
  sourceId,
  onClose,
}: {
  dict: Dictionary;
  word: string;
  sourceType: string;
  sourceId: string;
  onClose: () => void;
  anchor: HTMLElement;
  occurrenceId?: string;
  catalogueLookup?: boolean;
}) {
  const t = dict.vocabulary;
  const [contextual, setContextual] = useState<{ definitionEn: string; translationUz: string | null; verificationStatus: string | null; sourceLabel?: string; partOfSpeech?: string | null; lexicalType?: string | null; ipa?: string | null } | null>(null);
  /** The server knows this place in the text but has no checked meaning for it. */
  const [unresolved, setUnresolved] = useState(false);
  const [known, setKnown] = useState<{ id: string; definitionEn: string; translationUz: string | null; mastery: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [meaning, setMeaning] = useState("");
  const [uzbek, setUzbek] = useState("");
  const [saved, setSaved] = useState(false);
  const [needsMeaning, setNeedsMeaning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [folderId, setFolderId] = useState("");
  const [lookupVersion, setLookupVersion] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    popupRef.current?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setUnresolved(false);
    // A Listening or Reading word without a server-proven occurrence has no knowable
    // sense. No spelling lookup is made at all: the learner sees "Meaning not checked
    // yet" and may only save their own meaning. (Other sources keep the library search.)
    const spellingOnlyContextual = ["listening", "reading", "retention"].includes(sourceType) && !occurrenceId;
    void (async () => {
      if (spellingOnlyContextual) {
        const folderResult = await requestJson<{ folders: { id: string; name: string }[] }>("/api/vocabulary/folders", { method: "GET", signal: controller.signal });
        if (controller.signal.aborted) return;
        setContextual(null);
        setUnresolved(true);
        if (folderResult.ok && Array.isArray(folderResult.data?.folders)) setFolders(folderResult.data.folders.filter((folder) => typeof folder?.id === "string" && typeof folder.name === "string"));
        else setError(folderResult.ok ? dict.auth.errorServer : failureMessage(folderResult, dict.auth));
        setLoading(false);
        return;
      }
      const [lookup, folderResult] = await Promise.all([
        requestJson<{ status?: "resolved" | "unresolved"; contextual?: { definitionEn: string; translationUz: string | null; verificationStatus: string | null; sourceLabel?: string; partOfSpeech?: string | null; lexicalType?: string | null; ipa?: string | null } | null; known?: { id: string; mastery: string } | null; results?: { id: string; term: string; definitionEn: string; translationUz: string | null; mastery: string }[] }>(occurrenceId ? `/api/vocabulary/lookup?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}&occurrenceId=${encodeURIComponent(occurrenceId)}` : catalogueLookup ? `/api/vocabulary/meaning?sourceId=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(word)}` : `/api/vocabulary/search?q=${encodeURIComponent(word)}`, { method: "GET", signal: controller.signal }),
        requestJson<{ folders: { id: string; name: string }[] }>("/api/vocabulary/folders", { method: "GET", signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if ((occurrenceId || catalogueLookup) && lookup.ok && lookup.data?.status === "unresolved") {
        setContextual(null);
        setUnresolved(true);
      } else if ((occurrenceId || catalogueLookup) && lookup.ok && typeof lookup.data?.contextual?.definitionEn === "string") {
        setContextual(lookup.data.contextual);
        if (lookup.data.known) setKnown({ ...lookup.data.known, ...lookup.data.contextual });
      } else if (catalogueLookup && lookup.ok && lookup.data?.contextual === null) {
        setContextual(null);
      } else if (!occurrenceId && lookup.ok && Array.isArray(lookup.data?.results)) {
        const exact = lookup.data.results.filter((hit) => typeof hit?.term === "string" && typeof hit.definitionEn === "string" && hit.term.toLowerCase() === word.toLowerCase());
        // Multiple saved senses are not enough evidence to pick one for this text.
        setKnown(exact.length === 1 ? exact[0]! : null);
      } else setError(lookup.ok ? dict.auth.errorServer : failureMessage(lookup, dict.auth));
      if (folderResult.ok && Array.isArray(folderResult.data?.folders)) setFolders(folderResult.data.folders.filter((folder) => typeof folder?.id === "string" && typeof folder.name === "string"));
      else setError(folderResult.ok ? dict.auth.errorServer : failureMessage(folderResult, dict.auth));
      setLoading(false);
    })();
    return () => controller.abort();
  }, [word, dict.auth, lookupVersion, occurrenceId, sourceId, sourceType, catalogueLookup]);

  async function save() {
    setBusy(true);
    setError(null);
    setNeedsMeaning(false);
    const result = await requestJson<{ ok: boolean }>("/api/vocabulary", {
      body: {
        items: [{ term: word, ...(meaning.trim() ? { definitionEn: meaning.trim() } : {}), translationUz: uzbek.trim() || null }],
        // An unresolved occurrence has no sense to attach: the learner's own meaning is saved without it.
        sourceType, sourceId, occurrenceId: unresolved ? undefined : occurrenceId, folderId: folderId || null,
      },
    });
    setBusy(false);
    if (result.ok && result.data?.ok === true) {
      // Saving a word changes only the vocabulary library/summary resources.
      privateResources.invalidate("vocabulary:");
      setSaved(true);
      return;
    }
    if (!result.ok && result.error === "needs_definition") setNeedsMeaning(true);
    else setError(result.ok ? dict.auth.errorServer : failureMessage(result, dict.auth));
  }

  return createPortal(
    <div
      ref={popupRef}
      tabIndex={-1}
      role="dialog"
      aria-label={word}
      data-word-popover
      className="dictionary-context-panel fixed w-[min(20rem,calc(100vw-24px))] overflow-y-auto whitespace-normal rounded-md border border-ink-100 bg-paper-raised p-3 shadow-raised"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-lg text-ink-900">{word}</span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" aria-label={t.games.pronounce} onClick={() => speak(word)}>
          🔊
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>{t.add.close}</button>
      </div>

      {error && <div className="mt-2 text-xs text-band-warn">
        <p role="alert">{error}</p>
        <button type="button" className="btn-ghost mt-1 text-xs" disabled={loading || busy} onClick={() => setLookupVersion((value) => value + 1)}>{dict.errorPage.retry}</button>
      </div>}
      {loading && <p className="mt-2 text-xs text-ink-300">{dict.common.loading}</p>}

      {!loading && known && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <p className="text-ink-700">{known.definitionEn}</p>
          {known.translationUz && <><hr className="dictionary-translation-divider" /><p className="text-ink-500">{known.translationUz}</p></>}
          <p className="text-ink-300">
            {t.tab.words} · {t.mastery[known.mastery as keyof typeof t.mastery] ?? known.mastery}
          </p>
        </div>
      )}

      {!loading && !known && !saved && (
        <div className="mt-2 flex flex-col gap-2">
          {unresolved && <div role="status" className="text-xs text-ink-500" data-word-unresolved>
            <p className="font-medium text-ink-700">{t.meaningUnchecked}</p>
            <p>{t.meaningUncheckedHint}</p>
          </div>}
          {contextual ? <div className="text-sm text-ink-700">
            {(contextual.partOfSpeech || contextual.lexicalType || contextual.ipa) && <p className="text-xs text-ink-500" data-word-lexical>
              {[contextual.partOfSpeech, contextual.lexicalType && contextual.lexicalType !== "word" ? t.lexicalTypeLabel[contextual.lexicalType as keyof typeof t.lexicalTypeLabel] ?? null : null].filter(Boolean).join(" · ")}
              {contextual.ipa && <span className="ml-1 font-mono" data-word-ipa>/{contextual.ipa}/</span>}
            </p>}
            <p>{contextual.definitionEn}</p>
            {contextual.translationUz && <><hr className="dictionary-translation-divider" /><p>{contextual.translationUz}</p></>}
          </div> : <>
          <label className="text-xs text-ink-500">
            {t.add.definition}
            <input className="input mt-1" value={meaning} onChange={(event) => setMeaning(event.target.value)} />
          </label>
          <label className="text-xs text-ink-500">
            {t.add.translation}
            <input className="input mt-1" value={uzbek} onChange={(event) => setUzbek(event.target.value)} />
          </label>
          </>}
          <label className="text-xs text-ink-500">
            {t.games.set.folder}
            <select className="input mt-1" value={folderId} onChange={(event) => setFolderId(event.target.value)}>
              <option value="">{sourceType === "listening" ? "Listening" : sourceType === "reading" ? "Reading" : sourceType === "retention" ? "Retention" : t.folders.unassigned}</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary text-xs" disabled={busy} data-word-save onClick={() => void save()}>
              {busy ? dict.common.saving : t.add.button}
            </button>
          </div>
        </div>
      )}

      {saved && (
        <p className="mt-2 text-xs text-band-good" data-word-saved>
          {t.add.added} · {t.tab.words}
        </p>
      )}

      {needsMeaning && (
        <p className="mt-2 text-xs text-band-warn" data-word-needs-meaning>
          {t.add.needsMeaning}
        </p>
      )}
    </div>,
    document.body,
  );
}

function speak(word: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-GB";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export type TextHighlight = { id: string; start: number; end: number };

type Token = { value: string; clean: string; isWord: boolean; start: number; end: number };

/**
 * The character offset of a DOM position inside a text region, counted over the region's
 * VISIBLE text. Only text nodes count, so a highlighted `<mark>` or a word `<span>` does not
 * shift the numbering — a range stored once keeps pointing at the same characters.
 */
function offsetWithin(block: HTMLElement, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let counted = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return counted + offset;
    counted += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return null;
}

/**
 * Split ONE token into at most three pieces so a highlight can start or end in the middle of
 * a word. Returns null when the token is untouched, so the common path renders exactly what
 * it always did (the same elements, the same markup).
 */
function splitByHighlights(token: Token, highlights: TextHighlight[]): { value: string; highlightId: string | null }[] | null {
  if (!highlights.length) return null;
  const edges = new Set<number>([token.start, token.end]);
  const parts: { value: string; highlightId: string | null }[] = [];
  const covering = (position: number) => highlights.find((highlight) => highlight.start <= position && highlight.end > position) ?? null;
  for (const highlight of highlights) {
    if (highlight.start > token.start && highlight.start < token.end) edges.add(highlight.start);
    if (highlight.end > token.start && highlight.end < token.end) edges.add(highlight.end);
  }
  const points = [...edges].sort((a, b) => a - b);
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (from === to) continue;
    parts.push({ value: token.value.slice(from - token.start, to - token.start), highlightId: covering(from)?.id ?? null });
  }
  if (!parts.some((part) => part.highlightId)) return null;
  return parts;
}

/** Split text into words and separators, keeping the original characters. */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /([A-Za-z][A-Za-z'-]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ value: text.slice(lastIndex, match.index), clean: "", isWord: false, start: lastIndex, end: match.index });
    }
    const value = match[0];
    // Single letters are not worth a popover.
    tokens.push({ value, clean: value, isWord: value.length > 1, start: match.index, end: match.index + value.length });
    lastIndex = match.index + value.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ value: text.slice(lastIndex), clean: "", isWord: false, start: lastIndex, end: text.length });
  }
  return tokens;
}
