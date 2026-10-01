"use client";

import { privateResources } from "@/lib/client/private-resource";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import type { Dictionary } from "@/lib/i18n/en";

/** Shared, selectable learning text with one keyboard stop per text region. */
export function ClickableText(props: {
  dict: Dictionary;
  text: string;
  sourceType: string;
  sourceId: string;
  className?: string;
  occurrences?: OccurrenceSpan[];
  catalogueLookup?: boolean;
}) {
  // A changed source/text cannot keep an anchor or an async form from the old text.
  return <LexicalText key={JSON.stringify([props.sourceType, props.sourceId, props.text])} {...props} />;
}

function LexicalText({ dict, text, sourceType, sourceId, className = "", occurrences = [], catalogueLookup = false }: Parameters<typeof ClickableText>[0]) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ x: number; y: number; started: number; cancelled: boolean } | null>(null);
  const tokens = useMemo(() => tokenise(text), [text]);
  const words = useMemo(() => tokens.flatMap((token, index) => token.isWord ? [index] : []), [tokens]);
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
    const word = wrapperRef.current?.querySelector<HTMLElement>(`[data-token="${index}"]`);
    if (!word) return;
    setAnchor(word);
    setActive((previous) => previous === index ? null : index);
  }

  const selected = active === null ? null : tokens[active]!;
  const contextualHits = selected ? occurrences.filter((row) => row.startChar <= selected.start && row.endChar >= selected.end) : [];
  const occurrence = contextualHits.length === 1 ? contextualHits[0] : undefined;

  return (
    <div className={className}>
      <p id={hintId} className="sr-only">{dict.vocabulary.textLookupHint}</p>
      <div
        ref={wrapperRef}
        className="relative whitespace-pre-line outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-600"
        data-clickable-text
        role="group"
        tabIndex={words.length ? 0 : undefined}
        aria-label={dict.vocabulary.textLookup}
        aria-describedby={hintId}
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
        onKeyDown={(event) => {
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
        {tokens.map((token, index) => token.isWord ? (
          <span key={index} data-word={token.clean} data-token={index}
            className={active === index || cursor === index ? "rounded-sm bg-signal-50 text-ink-900" : undefined}>
            {token.value}
          </span>
        ) : token.value)}
      </div>
      <span id={cursorId} role="status" className="sr-only">{cursor === null ? "" : tokens[cursor]?.value}</span>
      {active !== null && anchor && <WordPopover key={`${sourceType}:${sourceId}:${active}:${occurrence?.id ?? ""}`}
        anchor={anchor} dict={dict} word={occurrence?.surfaceForm ?? tokens[active]!.clean} sourceType={sourceType} sourceId={sourceId} occurrenceId={occurrence?.id} catalogueLookup={catalogueLookup}
        onClose={() => close(true)} />}
    </div>
  );
}

function WordPopover({
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
  const [contextual, setContextual] = useState<{ definitionEn: string; translationUz: string | null; verificationStatus: string | null; sourceLabel?: string } | null>(null);
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
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      const box = popup.getBoundingClientRect();
      const textBounds = anchor.closest("[data-clickable-text]")?.getBoundingClientRect();
      // Keep the popup inside its text column when it fits there, so a Reading
      // lookup does not unnecessarily cover the adjacent answer controls.
      const rightEdge = textBounds && textBounds.width >= box.width
        ? Math.min(width - 8, textBounds.right) : width - 8;
      const below = rect.bottom + 6;
      const top = below + box.height <= height - 8 ? below : rect.top - box.height - 6;
      setPosition({
        left: Math.max(8, Math.min(rect.left, rightEdge - box.width)),
        top: Math.max(8, Math.min(top, height - box.height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popup);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  const positioned = position !== null;
  useEffect(() => {
    if (positioned) popupRef.current?.focus({ preventScroll: true });
  }, [positioned]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      const [lookup, folderResult] = await Promise.all([
        requestJson<{ contextual?: { definitionEn: string; translationUz: string | null; verificationStatus: string | null; sourceLabel?: string }; known?: { id: string; mastery: string } | null; results?: { id: string; term: string; definitionEn: string; translationUz: string | null; mastery: string }[] }>(occurrenceId ? `/api/vocabulary/lookup?sourceId=${encodeURIComponent(sourceId)}&occurrenceId=${encodeURIComponent(occurrenceId)}` : catalogueLookup ? `/api/vocabulary/meaning?sourceId=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(word)}` : `/api/vocabulary/search?q=${encodeURIComponent(word)}`, { method: "GET", signal: controller.signal }),
        requestJson<{ folders: { id: string; name: string }[] }>("/api/vocabulary/folders", { method: "GET", signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if ((occurrenceId || catalogueLookup) && lookup.ok && typeof lookup.data?.contextual?.definitionEn === "string") {
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
  }, [word, dict.auth, lookupVersion, occurrenceId, sourceId, catalogueLookup]);

  async function save() {
    setBusy(true);
    setError(null);
    setNeedsMeaning(false);
    const result = await requestJson<{ ok: boolean }>("/api/vocabulary", {
      body: {
        items: [{ term: word, ...(meaning.trim() ? { definitionEn: meaning.trim() } : {}), translationUz: uzbek.trim() || null }],
        sourceType, sourceId, occurrenceId, folderId: folderId || null,
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
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden", maxHeight: "calc(100dvh - 16px)" }}
      className="fixed z-50 w-[min(20rem,calc(100vw-16px))] overflow-y-auto whitespace-normal rounded-md border border-ink-100 bg-paper-raised p-3 shadow-raised"
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
          {known.translationUz && <p className="text-ink-500">{known.translationUz}</p>}
          <p className="text-ink-300">
            {t.tab.words} · {t.mastery[known.mastery as keyof typeof t.mastery] ?? known.mastery}
          </p>
        </div>
      )}

      {!loading && !known && !saved && (
        <div className="mt-2 flex flex-col gap-2">
          {contextual ? <div className="text-sm text-ink-700">
            <p>{contextual.definitionEn}</p>
            {contextual.translationUz && <p>{contextual.translationUz}</p>}
            <p className="mt-1 text-xs text-ink-500">{catalogueLookup ? contextual.sourceLabel : contextual.verificationStatus === "verified" ? t.contextVerified : t.contextUnverified}</p>
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
              <option value="">{t.folders.unassigned}</option>
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

type Token = { value: string; clean: string; isWord: boolean; start: number; end: number };

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
