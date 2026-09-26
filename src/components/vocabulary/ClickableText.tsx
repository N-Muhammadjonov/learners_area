"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const t = dict.vocabulary;
  const [active, setActive] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const tokens = useMemo(() => tokenise(text), [text]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
    }
    function onClickAway(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setActive(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickAway);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickAway);
    };
  }, []);

  return (
    <div ref={wrapperRef} className={`relative whitespace-pre-line ${className}`} data-clickable-text>
      {tokens.map((token, index) =>
        token.isWord ? (
          <button
            key={`${token.value}-${index}`}
            type="button"
            data-word={token.clean}
            aria-expanded={active === `${token.clean}-${index}`}
            onClick={() => setActive(active === `${token.clean}-${index}` ? null : `${token.clean}-${index}`)}
            className="rounded-sm px-0.5 text-left underline decoration-dotted decoration-ink-300 underline-offset-4 hover:bg-signal-50 hover:text-ink-900"
          >
            {token.value}
          </button>
        ) : (
          <span key={`sep-${index}`}>{token.value}</span>
        )
      )}

      {active && (
        <WordPopover
          dict={dict}
          word={active.slice(0, active.lastIndexOf("-"))}
          sourceType={sourceType}
          sourceId={sourceId}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function WordPopover({
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
}) {
  const t = dict.vocabulary;
  const [known, setKnown] = useState<{ id: string; definitionEn: string; translationUz: string | null; mastery: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [meaning, setMeaning] = useState("");
  const [uzbek, setUzbek] = useState("");
  const [saved, setSaved] = useState(false);
  const [needsMeaning, setNeedsMeaning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSaved(false);
    setKnown(null);
    void (async () => {
      const res = await fetch(`/api/vocabulary/search?q=${encodeURIComponent(word)}`);
      const payload = await res.json().catch(() => null);
      if (cancelled) return;
      const exact = (payload?.results ?? []).find(
        (hit: { term: string; match?: string }) => hit.term.toLowerCase() === word.toLowerCase()
      );
      setKnown(exact ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [word]);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/vocabulary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            term: word,
            // Only what the student actually typed. An empty meaning is left
            // empty on purpose: the server asks the centre's lexical sources,
            // and if nothing knows the word it says so instead of storing the
            // word as its own definition.
            ...(meaning.trim() ? { definitionEn: meaning.trim() } : {}),
            translationUz: uzbek.trim() || null,
          },
        ],
        sourceType,
        sourceId,
      }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setSaved(true);
      setMeaning("");
      setUzbek("");
      return;
    }
    // The word is real but its meaning is not known to us. Asking the student is
    // the honest move; inventing a definition would teach the wrong thing.
    if (body?.error === "needs_definition") {
      setNeedsMeaning(true);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={word}
      data-word-popover
      className="absolute left-0 top-full z-40 mt-1 w-[min(20rem,90vw)] rounded-md border border-ink-100 bg-paper-raised p-3 shadow-raised"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-lg text-ink-900">{word}</span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" aria-label={t.games.pronounce} onClick={() => speak(word)}>
          🔊
        </button>
      </div>

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
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary text-xs" disabled={busy} data-word-save onClick={() => void save()}>
              {busy ? dict.common.saving : t.add.button}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={onClose}>
              {t.add.close}
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
    </div>
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
