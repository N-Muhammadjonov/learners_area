"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The clickable-word layer, shared by every reading surface.
 *
 * Every word of a text is a real button, so a student can look a word up without
 * leaving the passage. The popover:
 *
 *   - shows the meaning if the word is already in the student's own library;
 *   - offers to save it (with the meaning) if it is not — through the same
 *     vocabulary engine every other module uses, tagged with where it came from;
 *   - can pronounce the word with the browser's own voice.
 *
 * Two deliberate limits. It only wraps plain text, never an input or a textarea,
 * so the popover can never cover a field being edited; and it never invents a
 * definition — the meaning field starts empty and the student writes it.
 */
export function ClickableText({
  dict,
  text,
  sourceType,
  sourceId,
  className = "",
}: {
  dict: Dictionary;
  text: string;
  sourceType: string;
  sourceId: string;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const tokens = useMemo(() => tokenise(text), [text]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && active) { setActive(null); anchor?.focus(); }
    }
    function onClickAway(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node) && !(event.target as Element).closest("[data-word-popover]")) setActive(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickAway);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickAway);
    };
  }, [anchor, active]);

  return (
    <div ref={wrapperRef} className={`relative whitespace-pre-line ${className}`} data-clickable-text>
      {tokens.map((token, index) =>
        token.isWord ? (
          <button
            key={`${token.value}-${index}`}
            type="button"
            data-word={token.clean}
            aria-expanded={active === `${token.clean}-${index}`}
            onClick={(event) => { setAnchor(event.currentTarget); setActive(active === `${token.clean}-${index}` ? null : `${token.clean}-${index}`); }}
            className="rounded-sm px-0.5 text-left underline decoration-dotted decoration-ink-300 underline-offset-4 hover:bg-signal-50 hover:text-ink-900"
          >
            {token.value}
          </button>
        ) : (
          <span key={`sep-${index}`}>{token.value}</span>
        )
      )}

      {active && anchor && (
        <WordPopover
          key={`${sourceType}:${sourceId}:${active}`}
          anchor={anchor}
          dict={dict}
          word={active.slice(0, active.lastIndexOf("-"))}
          sourceType={sourceType}
          sourceId={sourceId}
          onClose={() => { setActive(null); anchor.focus(); }}
        />
      )}
    </div>
  );
}

function WordPopover({
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
  anchor: HTMLButtonElement;
}) {
  const t = dict.vocabulary;
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
        requestJson<{ results: { id: string; term: string; definitionEn: string; translationUz: string | null; mastery: string }[] }>(`/api/vocabulary/search?q=${encodeURIComponent(word)}`, { method: "GET", signal: controller.signal }),
        requestJson<{ folders: { id: string; name: string }[] }>("/api/vocabulary/folders", { method: "GET", signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (lookup.ok && Array.isArray(lookup.data?.results)) {
        const exact = lookup.data.results.filter((hit) => typeof hit?.term === "string" && typeof hit.definitionEn === "string" && hit.term.toLowerCase() === word.toLowerCase());
        // Multiple saved senses are not enough evidence to pick one for this text.
        setKnown(exact.length === 1 ? exact[0]! : null);
      } else setError(lookup.ok ? dict.auth.errorServer : failureMessage(lookup, dict.auth));
      if (folderResult.ok && Array.isArray(folderResult.data?.folders)) setFolders(folderResult.data.folders.filter((folder) => typeof folder?.id === "string" && typeof folder.name === "string"));
      else setError(folderResult.ok ? dict.auth.errorServer : failureMessage(folderResult, dict.auth));
      setLoading(false);
    })();
    return () => controller.abort();
  }, [word, dict.auth, lookupVersion]);

  async function save() {
    setBusy(true);
    setError(null);
    setNeedsMeaning(false);
    const result = await requestJson<{ ok: boolean }>("/api/vocabulary", {
      body: {
        items: [{ term: word, ...(meaning.trim() ? { definitionEn: meaning.trim() } : {}), translationUz: uzbek.trim() || null }],
        sourceType, sourceId, folderId: folderId || null,
      },
    });
    setBusy(false);
    if (result.ok && result.data?.ok === true) {
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
          <label className="text-xs text-ink-500">
            {t.add.definition}
            <input className="input mt-1" value={meaning} onChange={(event) => setMeaning(event.target.value)} />
          </label>
          <label className="text-xs text-ink-500">
            {t.add.translation}
            <input className="input mt-1" value={uzbek} onChange={(event) => setUzbek(event.target.value)} />
          </label>
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

type Token = { value: string; clean: string; isWord: boolean };

/** Split text into words and separators, keeping the original characters. */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /([A-Za-z][A-Za-z'-]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ value: text.slice(lastIndex, match.index), clean: "", isWord: false });
    }
    const value = match[0];
    // Single letters are not worth a popover.
    tokens.push({ value, clean: value, isWord: value.length > 1 });
    lastIndex = match.index + value.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ value: text.slice(lastIndex), clean: "", isWord: false });
  }
  return tokens;
}
