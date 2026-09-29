"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { collocationChips } from "./types";
import type { GameSetKey, GameSetResponse, GameWord, VocabFolder, VocabPack } from "./types";
import { acceptedSpellings, gradeSpelling, normalizeAnswer, type GameSubmission } from "@/lib/services/vocabulary/grading";
import { elapsedTenths, formatRaceTime, honestWordsPerMinute, typingRaceAccuracy, uniqueGameRound } from "@/lib/services/vocabulary/game-round";
import { GAME_IDS, type GameId } from "@/lib/services/vocabulary/game-routes";

const GAMES: readonly GameId[] = GAME_IDS;
const GAME_META: Record<GameId, { title: (dict: Dictionary) => string; hint: (dict: Dictionary) => string }> = {
  cards: { title: (d) => d.vocabulary.games.cards, hint: (d) => d.vocabulary.games.cardsHint },
  choice: { title: (d) => d.vocabulary.games.choice, hint: (d) => d.vocabulary.games.choiceHint },
  match: { title: (d) => d.vocabulary.games.match, hint: (d) => d.vocabulary.games.matchHint },
  gap: { title: (d) => d.vocabulary.games.gap, hint: (d) => d.vocabulary.games.gapHint },
  race: { title: (d) => d.vocabulary.games.race, hint: (d) => d.vocabulary.games.raceHint },
  translation: { title: (d) => d.vocabulary.games.translation, hint: (d) => d.vocabulary.games.translationHint },
  builder: { title: (d) => d.vocabulary.games.builder, hint: (d) => d.vocabulary.games.builderHint },
};

type GameRequest = { gameId: GameId; setKey: GameSetKey; folderId?: string; topicPack?: string };
const GameRequestContext = createContext<GameRequest>({ gameId: "cards", setKey: "all" });

/** Lightweight Games library: it loads only the selected game set, never the full Vocabulary Studio payload. */
export function VocabGamesPanel({
  dict,
  folders,
  packs,
}: {
  dict: Dictionary;
  folders: VocabFolder[];
  packs: VocabPack[];
}) {
  const t = dict.vocabulary;
  const [setKey, setSetKey] = useState<GameSetKey>("due");
  const [topicPack, setTopicPack] = useState<string>(packs[0]?.id ?? "");
  const [folderId, setFolderId] = useState<string>(folders[0]?.id ?? "");
  const [set, setSet] = useState<GameSetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ set: setKey, limit: "1" });
    if (setKey === "topic" && topicPack) params.set("topicPack", topicPack);
    if (setKey === "folder" && folderId) params.set("folderId", folderId);
    return params;
  }, [setKey, topicPack, folderId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    void fetch(`/api/vocabulary/games?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.ok) throw new Error("game_set_unavailable");
        setSet(payload as GameSetResponse);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setSet(null);
        setLoadFailed(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);

  const available = set?.total ?? 0;
  const setLabel = useMemo(() => {
    const base = t.games.set[setKey];
    if (setKey === "topic" && topicPack) return `${base} · ${packs.find((item) => item.id === topicPack)?.label ?? ""}`;
    if (setKey === "folder" && folderId) return `${base} · ${folders.find((item) => item.id === folderId)?.name ?? ""}`;
    return base;
  }, [setKey, topicPack, folderId, packs, folders, t]);
  const hrefFor = (game: GameId) => {
    const params = new URLSearchParams(query);
    params.delete("limit");
    return `/vocabulary/games/${game}?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4" data-games-library>
      <header>
        <h1 className="font-display text-2xl text-ink-900">{t.games.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.games.hint}</p>
      </header>
      <section className="card p-4" aria-label={t.games.set.label}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            {t.games.set.label}
            <select className="input" aria-label={t.games.set.label} data-game-set value={setKey} onChange={(event) => setSetKey(event.target.value as GameSetKey)}>
              {(["all", "due", "weak", "reading", "listening", "topic", "folder", "assigned"] as GameSetKey[]).map((key) => <option key={key} value={key}>{t.games.set[key]}</option>)}
            </select>
          </label>
          {setKey === "topic" && packs.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              {t.packs.title}<select className="input" aria-label={t.packs.title} value={topicPack} onChange={(event) => setTopicPack(event.target.value)}>
                {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.label} · {pack.wordCount}</option>)}
              </select>
            </label>
          )}
          {setKey === "folder" && folders.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              {t.folders.title}<select className="input" aria-label={t.folders.title} value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name} · {folder.count}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="mt-3 text-xs text-ink-500" data-game-set-status aria-live="polite">
          {loading ? dict.common.loading : loadFailed ? t.games.loadError : `${setLabel} · ${available} ${t.packs.words}${set ? ` · ${set.due} ${t.summary.dueToday}` : ""}`}
        </p>
      </section>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game) => (
          <Link key={game} href={hrefFor(game)} prefetch={false} data-game={game} aria-disabled={available === 0 || loading} tabIndex={available === 0 || loading ? -1 : 0}
            onClick={(event) => { if (available === 0 || loading) event.preventDefault(); }}
            className={`card flex min-h-28 flex-col gap-1 p-4 text-left transition-colors hover:border-signal-600 ${available === 0 || loading ? "pointer-events-none opacity-50" : ""}`}>
            <span className="text-sm font-medium text-ink-900">{GAME_META[game].title(dict)}</span>
            <span className="text-xs text-ink-500">{GAME_META[game].hint(dict)}</span>
          </Link>
        ))}
      </div>
      {available === 0 && !loading && !loadFailed && <p className="text-sm text-ink-500">{t.games.noWords}</p>}
      {loadFailed && <p role="alert" className="text-sm text-band-bad">{t.games.loadError}</p>}
    </div>
  );
}

/** Dedicated route content; the per-game dataset is fetched independently from the Vocabulary Studio. */
export function VocabGameView({
  dict, gameId, setKey, folderId, topicPack, sourceDetail,
}: {
  dict: Dictionary;
  gameId: GameId;
  setKey: GameSetKey;
  folderId?: string;
  topicPack?: string;
  sourceDetail?: string;
}) {
  const t = dict.vocabulary;
  const [set, setSet] = useState<GameSetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const context = useMemo(() => ({ gameId, setKey, folderId, topicPack }), [gameId, setKey, folderId, topicPack]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ set: setKey, limit: "24", random: "1", game: gameId });
    if (folderId) params.set("folderId", folderId);
    if (topicPack) params.set("topicPack", topicPack);
    setLoading(true);
    setFailed(false);
    void fetch(`/api/vocabulary/games?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.ok) throw new Error("game_set_unavailable");
        setSet(payload as GameSetResponse);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [gameId, setKey, folderId, topicPack]);

  const source = [t.games.set[setKey], sourceDetail].filter(Boolean).join(" · ");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4" data-dedicated-game={gameId}>
      <Link href="/vocabulary/games" prefetch={false} className="btn-ghost w-fit" data-game-back>← {t.games.backToGames}</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl text-ink-900">{GAME_META[gameId].title(dict)}</h1><p className="mt-1 text-sm text-ink-500">{t.games.source}: {source}</p></div>
        {set && <span className="text-xs text-ink-500">{set.total} {t.packs.words}</span>}
      </header>
      {loading && <p className="card p-4 text-sm text-ink-500" role="status">{dict.common.loading}</p>}
      {failed && <p className="card p-4 text-sm text-band-bad" role="alert">{t.games.loadError}</p>}
      {!loading && !failed && set?.words.length === 0 && <p className="card p-4 text-sm text-ink-500">{set?.total ? t.games.noEligible : t.games.noWords}</p>}
      {!loading && !failed && set && set.words.length > 0 && (
        <GameRequestContext.Provider value={context}>
          {gameId === "cards" && <Flashcards key={gameId} dict={dict} words={set.words} />}
          {gameId === "choice" && <MultipleChoice key={gameId} dict={dict} words={set.words} />}
          {gameId === "match" && <MatchingPairs key={gameId} dict={dict} words={set.words} />}
          {gameId === "gap" && <FillTheGap key={gameId} dict={dict} words={set.words} />}
          {gameId === "race" && <TypingRace key={gameId} dict={dict} words={set.words} />}
          {gameId === "translation" && <TranslationChallenge key={gameId} dict={dict} words={set.words} />}
          {gameId === "builder" && <SentenceBuilder key={gameId} dict={dict} words={set.words} />}
        </GameRequestContext.Provider>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * One answered word, sent to the ledger.
 *
 * The browser no longer reports whether the answer was right: it sends what the
 * student actually did, and the server grades it against the stored word using
 * `normalizeAnswer` — the very same function this file uses for the instant
 * on-screen verdict. Because both sides fold the answer the same way, the
 * feedback a student sees and the verdict that earns a point cannot disagree.
 *
 * Flashcard self-assessment sends `kind: "self"` and earns no points. Matching
 * pairs send both selected entry identities; the server verifies ownership,
 * selected-set membership, and whether the pair refers to the same saved entry.
 */
function useAnswer() {
  const request = useContext(GameRequestContext);
  return useCallback(
    async (entryId: string, submission: GameSubmission) => {
      const res = await fetch("/api/vocabulary/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          set: request.setKey,
          gameId: request.gameId,
          folderId: request.folderId,
          topicPack: request.topicPack,
          submission,
        }),
      }).catch(() => null);
      if (!res?.ok) return null;
      return res.json().catch(() => null) as Promise<{ awarded?: number; correct?: boolean; verified?: boolean } | null>;
    },
    [request],
  );
}

function GameFrame({
  dict,
  title,
  hint,
  counter,
  children,
}: {
  dict: Dictionary;
  title: string;
  hint: string;
  counter: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-900">{title}</h2>
        <span className="text-xs text-ink-500">{counter}</span>
      </div>
      <p className="text-xs text-ink-500">{hint}</p>
      <p className="text-xs text-ink-300">{dict.vocabulary.games.casualNote}</p>
      {children}
    </div>
  );
}

function Speaker({ word, label }: { word: string; label: string }) {
  const [state, setState] = useState<"idle" | "unsupported">("idle");
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      aria-label={`${label}: ${word}`}
      onClick={() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          setState("unsupported");
          return;
        }
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = "en-GB";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }}
    >
      <span aria-hidden="true">🔊</span> {state === "unsupported" ? "—" : label}
    </button>
  );
}

function ResultBanner({
  dict,
  correct,
  total,
  onAgain,
}: {
  dict: Dictionary;
  correct: number;
  total: number;
  onAgain: () => void;
}) {
  const t = dict.vocabulary;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm bg-paper-sunken p-3" data-game-result>
      <span className="text-sm text-ink-900">
        {t.games.result}: {correct} {t.games.resultLine} {total}
      </span>
      <button type="button" className="btn-secondary" onClick={onAgain}>
        {t.games.again}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Flashcards — definition first, side queue, separate assessment and navigation
// ---------------------------------------------------------------------------

function Flashcards({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const [deck, setDeck] = useState(() => shuffle(words).slice(0, 10));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<string, "known" | "notYet">>({});
  const answer = useAnswer();

  const current = deck[index];
  const correct = Object.values(marks).filter((mark) => mark === "known").length;
  const remaining = deck.slice(index);

  /**
   * The keyboard is part of the deck, not an afterthought: space turns the card
   * over, the arrows move through it. The arrows only *navigate* — a card that is
   * skipped keeps no mark and never touches the SRS, because a keystroke is not a
   * judgement. Enter is deliberately not bound: a card should not be judged by
   * the same key that means "activate" everywhere else.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.tagName === "BUTTON" || target.tagName === "A" ||
        target.tagName === "SELECT" || target.isContentEditable
      );
      if (typing) return;

      if (event.key === " ") {
        event.preventDefault();
        setFlipped((value) => !value);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setFlipped(false);
        setIndex((value) => Math.min(value + 1, deck.length));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setFlipped(false);
        setIndex((value) => Math.max(value - 1, 0));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deck.length]);

  function restart() {
    setDeck(shuffle(words).slice(0, 10));
    setIndex(0);
    setFlipped(false);
    setMarks({});
  }

  function decide(known: boolean) {
    if (!current) return;
    setMarks((row) => ({ ...row, [current.id]: known ? "known" : "notYet" }));
    void answer(current.id, { kind: "self", known });
  }

  if (!current) {
    return (
      <GameFrame dict={dict} title={t.games.cards} hint={t.games.cardsHint} counter={`${correct}/${deck.length}`}>
        <ResultBanner dict={dict} correct={correct} total={deck.length} onAgain={restart} />
      </GameFrame>
    );
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.cards}
      hint={t.games.cardsHint}
      counter={`${t.games.progress} ${index + 1} / ${deck.length}`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <article
          aria-label={flipped ? current.term : current.definitionEn}
          data-flashcard={flipped ? "answer" : "definition"}
          className="flex min-h-[230px] flex-col items-center justify-center gap-3 rounded-md border border-ink-100 bg-paper-sunken p-6 text-center"
        >
          {flipped ? (
            <>
              <p className="font-display text-2xl text-ink-900">{current.term}</p>
              {current.partOfSpeech && <p className="text-xs uppercase tracking-wide text-ink-300">{current.partOfSpeech}</p>}
              {current.translationUz && <p className="text-sm text-signal-700">{current.translationUz}</p>}
              {collocationChips(current.collocations).length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5" data-collocations>
                  {collocationChips(current.collocations).map((phrase) => (
                    <span key={phrase} className="rounded-full bg-paper-raised px-2 py-0.5 text-xs text-ink-700">
                      {phrase}
                    </span>
                  ))}
                </div>
              )}
              {current.exampleSentence && (
                <p className="text-xs italic text-ink-500">“{current.exampleSentence}”</p>
              )}
              <Speaker word={current.term} label={t.games.pronounce} />
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-ink-300">{t.add.definition}</p>
              <p className="text-lg text-ink-900">{current.definitionEn}</p>
              <p className="text-xs text-ink-500">
                {t.games.flip} · {t.games.known} / {t.games.notYet}
              </p>
              <p className="text-[11px] text-ink-300" data-flashcard-keys>
                {t.keyboardHint}
              </p>
              <p className="text-[11px] text-ink-300" data-self-assessed>
                {t.games.selfAssessed}
              </p>
            </>
          )}
        </article>

        <div className="flex flex-col gap-2">
          <button type="button" className="btn-secondary" onClick={() => setFlipped((value) => !value)}>
            {flipped ? t.games.showDefinition : t.games.flip}
          </button>
          {flipped && (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <button type="button" className="btn-primary" data-mark="known" aria-pressed={marks[current.id] === "known"} onClick={() => decide(true)}>
                {t.games.known}
              </button>
              <button type="button" className="btn-gold" data-mark="notYet" aria-pressed={marks[current.id] === "notYet"} onClick={() => decide(false)}>
                {t.games.notYet}
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={index === 0} onClick={() => { setFlipped(false); setIndex((value) => Math.max(0, value - 1)); }}>{t.games.previous}</button>
            <button type="button" className="btn-secondary" onClick={() => { setFlipped(false); setIndex((value) => value + 1); }}>{t.games.next}</button>
          </div>
          <div className="rounded-sm border border-ink-100 p-2">
            <p className="text-xs font-medium text-ink-500">{t.games.queue}</p>
            <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-xs">
              {remaining.map((word, offset) => {
                const mark = marks[word.id];
                return (
                  <li
                    key={word.id}
                    className={`flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 ${
                      offset === 0 ? "bg-signal-50 text-ink-900" : "text-ink-500"
                    }`}
                  >
                    <span className="line-clamp-2">{word.definitionEn}</span>
                    <span className="shrink-0">
                      {mark === "known"
                        ? t.games.learned
                        : mark === "notYet"
                          ? t.games.notYetLabel
                          : offset === 0
                            ? t.games.current
                            : t.games.remaining}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </GameFrame>
  );
}

// ---------------------------------------------------------------------------
// 2. Multiple choice — the definition is the prompt, four words are the options
// ---------------------------------------------------------------------------

function MultipleChoice({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const [deck] = useState(() => shuffle(words).slice(0, 10));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const answer = useAnswer();

  const current = deck[index];
  const options = useMemo(() => {
    if (!current) return [];
    const others = shuffle(words.filter((word) => word.id !== current.id && word.term !== current.term))
      .slice(0, 3)
      .map((word) => word.term);
    return shuffle([current.term, ...others]);
  }, [current, words]);

  function choose(option: string) {
    if (picked || !current) return;
    setPicked(option);
    const isRight = normalizeAnswer(option) === normalizeAnswer(current.term);
    if (isRight) setCorrect((value) => value + 1);
    void answer(current.id, { kind: "spelling", text: option });
  }

  if (!current) {
    return (
      <GameFrame dict={dict} title={t.games.choice} hint={t.games.choiceHint} counter={`${correct}`}>
        <ResultBanner
          dict={dict}
          correct={correct}
          total={deck.length}
          onAgain={() => {
            setIndex(0);
            setPicked(null);
            setCorrect(0);
          }}
        />
      </GameFrame>
    );
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.choice}
      hint={t.games.choiceHint}
      counter={`${t.games.progress} ${index + 1} / ${deck.length} · ${t.games.score} ${correct}`}
    >
      <p className="rounded-md bg-paper-sunken p-4 text-center text-lg text-ink-900" data-mcq-prompt>
        {current.definitionEn}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const isRight = normalizeAnswer(option) === normalizeAnswer(current.term);
          const state = picked ? (isRight ? "right" : option === picked ? "wrong" : "idle") : "idle";
          return (
            <button
              key={option}
              type="button"
              data-option={option}
              data-state={state}
              disabled={picked !== null}
              onClick={() => choose(option)}
              className={`btn border text-sm ${
                state === "right"
                  ? "border-band-good bg-band-good/10 text-band-good"
                  : state === "wrong"
                    ? "border-band-bad bg-band-bad/10 text-band-bad"
                    : "border-ink-100 bg-paper-raised text-ink-900"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-ink-500">
            {normalizeAnswer(picked) === normalizeAnswer(current.term) ? t.games.score : t.games.wrongAnswer}: {current.term}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setPicked(null);
              setIndex((value) => value + 1);
            }}
          >
            {t.games.next}
          </button>
        </div>
      )}
    </GameFrame>
  );
}

// ---------------------------------------------------------------------------
// 3. Matching pairs — six words, six meanings
// ---------------------------------------------------------------------------

function MatchingPairs({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const [round, setRound] = useState(0);
  // `round` is part of the key on purpose: replaying the board reshuffles it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pool = useMemo(() => shuffle(words).slice(0, 6), [words, round]);
  const [left] = useState(() => pool);
  const [right] = useState(() => shuffle(pool));
  const [picked, setPicked] = useState<GameWord | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrongPair, setWrongPair] = useState<string | null>(null);
  const answer = useAnswer();

  function pickRight(word: GameWord) {
    if (!picked || matched.includes(word.id)) return;
    const right = picked.id === word.id;
    // The server checks that both entries belong to this learner and selected
    // set, then decides whether both sides refer to the same saved entry.
    void answer(picked.id, { kind: "pair", pairEntryId: word.id });
    if (right) {
      setMatched((rows) => [...rows, word.id]);
      setPicked(null);
    } else {
      setWrongPair(word.id);
      setTimeout(() => {
        setWrongPair(null);
        setPicked(null);
      }, 600);
    }
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.match}
      hint={t.games.matchHint}
      counter={`${matched.length} / ${pool.length}`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ul className="flex flex-col gap-2">
          {left.map((word) => {
            const done = matched.includes(word.id);
            return (
              <li key={word.id}>
                <button
                  type="button"
                  data-left={word.term}
                  disabled={done}
                  aria-pressed={picked?.id === word.id}
                  onClick={() => setPicked(word)}
                  className={`w-full rounded-sm border px-3 py-2 text-left text-sm ${
                    done
                      ? "border-band-good bg-band-good/10 text-band-good"
                      : picked?.id === word.id
                        ? "border-signal-600 bg-signal-100 text-signal-700"
                        : "border-ink-100 bg-paper-raised text-ink-900"
                  }`}
                >
                  {word.term}
                </button>
              </li>
            );
          })}
        </ul>
        <ul className="flex flex-col gap-2">
          {right.map((word) => {
            const done = matched.includes(word.id);
            return (
              <li key={word.id}>
                <button
                  type="button"
                  data-right={word.id}
                  disabled={done || !picked}
                  onClick={() => pickRight(word)}
                  className={`w-full rounded-sm border px-3 py-2 text-left text-xs ${
                    done
                      ? "border-band-good bg-band-good/10 text-band-good"
                      : wrongPair === word.id
                        ? "border-band-bad bg-band-bad/10 text-band-bad"
                        : "border-ink-100 bg-paper-raised text-ink-700"
                  }`}
                >
                  {word.definitionEn}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-[11px] text-ink-300" data-self-assessed>
        {t.games.selfAssessed}
      </p>
      {matched.length === pool.length && (
        <ResultBanner
          dict={dict}
          correct={matched.length}
          total={pool.length}
          onAgain={() => {
            setMatched([]);
            setPicked(null);
            setRound((value) => value + 1);
          }}
        />
      )}
    </GameFrame>
  );
}

// ---------------------------------------------------------------------------
// 4. Fill the gap — the example sentence with the word removed
// ---------------------------------------------------------------------------

function FillTheGap({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const withExamples = useMemo(() => words.filter((word) => word.exampleSentence), [words]);
  const [deck] = useState(() => shuffle(withExamples.length > 0 ? withExamples : words).slice(0, 10));
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [correct, setCorrect] = useState(0);
  const [hint, setHint] = useState(false);
  const answer = useAnswer();

  const current = deck[index];
  const gapText = useMemo(() => {
    if (!current) return "";
    if (!current.exampleSentence) return current.definitionEn;
    const escaped = current.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\w*\\b`, "gi");
    const replaced = current.exampleSentence.replace(pattern, "______");
    return replaced === current.exampleSentence ? `${current.exampleSentence} (${"______"})` : replaced;
  }, [current]);

  function check() {
    if (!current || checked !== null) return;
    const isRight = gradeSpelling(current, value);
    setChecked(isRight);
    if (isRight) setCorrect((row) => row + 1);
    void answer(current.id, { kind: "spelling", text: value });
  }

  if (!current) {
    return (
      <GameFrame dict={dict} title={t.games.gap} hint={t.games.gapHint} counter={`${correct}`}>
        <ResultBanner dict={dict} correct={correct} total={deck.length} onAgain={() => { setIndex(0); setValue(""); setChecked(null); setCorrect(0); }} />
      </GameFrame>
    );
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.gap}
      hint={t.games.gapHint}
      counter={`${t.games.progress} ${index + 1} / ${deck.length} · ${t.games.score} ${correct}`}
    >
      <p className="rounded-md bg-paper-sunken p-4 text-sm text-ink-900" data-gap-sentence>
        {gapText}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder={t.games.typeAnswer}
          aria-label={t.games.gap}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && check()}
        />
        <button type="button" className="btn-primary" disabled={checked !== null} onClick={check}>
          {t.games.check}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => setHint(true)}>
          {t.games.hintLabel}
        </button>
        {hint && (
          <span className="text-xs text-ink-500">
            {t.games.hintLabel}: {current.term.slice(0, Math.max(2, Math.ceil(current.term.length / 3)))}…
          </span>
        )}
      </div>
      {checked !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={checked ? "text-sm text-band-good" : "text-sm text-band-bad"}>
            {checked ? t.games.score : `${t.games.wrongAnswer}: ${current.term}`}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setValue("");
              setChecked(null);
              setHint(false);
              setIndex((row) => row + 1);
            }}
          >
            {t.games.next}
          </button>
        </div>
      )}
    </GameFrame>
  );
}

// ---------------------------------------------------------------------------
// 5. Typing Race — meaning first, one focused input, item clock at tenths
// ---------------------------------------------------------------------------

function TypingRace({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const eligible = useMemo(
    () => words.filter((word) => word.term.trim().length > 0 && word.definitionEn.trim().length > 0),
    [words],
  );
  const [deck, setDeck] = useState(() => uniqueGameRound(eligible, 10));
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [ticker, setTicker] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<null | "checking" | "correct" | "incorrect" | "skipped" | "unverified">(null);
  const [finished, setFinished] = useState(false);
  const [stats, setStats] = useState({ correct: 0, incorrect: 0, skipped: 0, unverified: 0, typedCharacters: 0, totalSeconds: 0 });
  const [records, setRecords] = useState<{ term: string; seconds: number; outcome: string }[]>([]);
  const answer = useAnswer();
  const submitting = useRef(false);

  const current = deck[index];
  const running = startedAt !== null && status === null && !finished;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTicker(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  const liveElapsed = running && startedAt !== null ? elapsedTenths(startedAt, ticker) : elapsed;
  const accuracy = typingRaceAccuracy(stats.correct, stats.incorrect);
  const wpm = records.length === deck.length && stats.correct === deck.length && stats.incorrect === 0 && stats.skipped === 0 && stats.unverified === 0
    ? honestWordsPerMinute(stats.typedCharacters, stats.totalSeconds)
    : null;
  const typedLetters = [...value.replace(/\s/g, "")];

  function startIfRealCharacter(next: string) {
    setValue(next);
    if (startedAt === null && next.trim().length > 0) {
      const now = Date.now();
      setStartedAt(now);
      setTicker(now);
    }
  }

  function stopClock(): number {
    const stoppedAt = Date.now();
    const duration = startedAt === null ? 0 : elapsedTenths(startedAt, stoppedAt);
    setElapsed(duration);
    setTicker(stoppedAt);
    return duration;
  }

  async function submit() {
    if (!current || status !== null || submitting.current || value.trim().length === 0) return;
    submitting.current = true;
    const duration = stopClock();
    setStatus("checking");
    const result = await answer(current.id, { kind: "spelling", text: value });
    const verdict = result?.verified === true
      ? result.correct === true ? "correct" : "incorrect"
      : "unverified";
    setStatus(verdict);
    setStats((row) => ({
      ...row,
      correct: row.correct + (verdict === "correct" ? 1 : 0),
      incorrect: row.incorrect + (verdict === "incorrect" ? 1 : 0),
      unverified: row.unverified + (verdict === "unverified" ? 1 : 0),
      typedCharacters: row.typedCharacters + value.length,
      totalSeconds: row.totalSeconds + duration,
    }));
    setRecords((row) => [...row, { term: current.term, seconds: duration, outcome: verdict }]);
    submitting.current = false;
  }

  function skip() {
    if (!current || status !== null) return;
    const duration = stopClock();
    setStatus("skipped");
    setStats((row) => ({ ...row, skipped: row.skipped + 1, typedCharacters: row.typedCharacters + value.length, totalSeconds: row.totalSeconds + duration }));
    setRecords((row) => [...row, { term: current.term, seconds: duration, outcome: "skipped" }]);
  }

  function advance() {
    if (status === null || status === "checking") return;
    if (index + 1 >= deck.length) {
      setFinished(true);
      return;
    }
    setIndex((row) => row + 1);
    setValue("");
    setStartedAt(null);
    setTicker(Date.now());
    setElapsed(0);
    setStatus(null);
    submitting.current = false;
  }

  function restart() {
    setDeck(uniqueGameRound(eligible, 10));
    setIndex(0);
    setValue("");
    setStartedAt(null);
    setTicker(Date.now());
    setElapsed(0);
    setStatus(null);
    setFinished(false);
    setStats({ correct: 0, incorrect: 0, skipped: 0, unverified: 0, typedCharacters: 0, totalSeconds: 0 });
    setRecords([]);
    submitting.current = false;
  }

  if (deck.length === 0) {
    return <GameFrame dict={dict} title={t.games.race} hint={t.games.raceHint} counter="0 / 0"><p className="text-sm text-ink-500">{t.games.noEligible}</p></GameFrame>;
  }

  if (finished) {
    return (
      <GameFrame dict={dict} title={t.games.race} hint={t.games.raceHint} counter={`${stats.correct} / ${deck.length}`}>
        <section data-race-results aria-labelledby="race-results-title" className="flex flex-col gap-3">
          <h3 id="race-results-title" className="text-base font-medium text-ink-900">{t.games.result}</h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <RaceMetric label={t.games.correctCount} value={`${stats.correct} / ${deck.length}`} />
            <RaceMetric label={t.games.accuracy} value={accuracy === null ? "—" : `${accuracy}%`} />
            <RaceMetric label={t.games.totalTime} value={formatRaceTime(stats.totalSeconds)} />
            <RaceMetric label={t.games.incorrectCount} value={stats.incorrect} />
            <RaceMetric label={t.games.skippedCount} value={stats.skipped} />
            {wpm !== null && <RaceMetric label={t.games.wpm} value={wpm} />}
          </dl>
          <ul className="max-h-48 divide-y divide-ink-100 overflow-y-auto rounded-sm border border-ink-100 px-3" aria-label={t.games.itemTimes}>
            {records.map((record, row) => <li key={`${record.term}-${row}`} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span>{record.term}</span><span className="text-ink-500">{formatRaceTime(record.seconds)} · {record.outcome === "correct" ? t.games.raceCorrect : record.outcome === "incorrect" ? t.games.raceIncorrect : record.outcome === "skipped" ? t.games.raceSkipped : t.games.raceUnverified}</span></li>)}
          </ul>
          {stats.unverified > 0 && <p className="text-xs text-warn-800" role="status">{t.games.raceUnverified}: {stats.unverified}</p>}
          <button type="button" className="btn-primary w-fit" onClick={restart}>{t.games.again}</button>
        </section>
      </GameFrame>
    );
  }

  if (!current) return null;
  const groups = current.term.split(/\s+/).filter(Boolean);
  let offset = 0;
  const resolved = status !== null && status !== "checking";
  const sourceTypeLabel = current.sourceType
    ? t.games.sourceTypes[current.sourceType as keyof typeof t.games.sourceTypes]
    : undefined;

  return (
    <GameFrame dict={dict} title={t.games.race} hint={t.games.raceHint} counter={`${t.games.raceProgress} ${index + 1} / ${deck.length} · ${t.games.itemTime}: ${formatRaceTime(liveElapsed)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <span>{t.games.score}: {stats.correct}</span>
        <span>{t.games.accuracy}: {accuracy === null ? "—" : `${accuracy}%`}</span>
        <span>{t.games.elapsedThisItem}: {formatRaceTime(liveElapsed)}</span>
      </div>
      <section className="rounded-md bg-paper-sunken p-4 text-center" aria-labelledby="race-meaning-label" data-race-prompt>
        <p id="race-meaning-label" className="text-xs uppercase tracking-wide text-ink-300">{t.games.meaning}</p>
        {current.translationUz && <p className="mt-2 text-lg text-ink-900">{current.translationUz}</p>}
        <p className="mt-1 text-sm text-ink-700">{current.definitionEn}</p>
        {sourceTypeLabel && <p className="mt-2 text-xs text-ink-300">{t.games.source}: {sourceTypeLabel}</p>}
      </section>
      <div className="flex min-h-10 flex-wrap items-center justify-center gap-3" aria-hidden="true" data-race-answer-boxes>
        {groups.map((word, groupIndex) => {
          const thisOffset = offset;
          offset += [...word].length;
          return <span key={`${groupIndex}-${word.length}`} className="flex flex-wrap justify-center gap-1">
            {[...word].map((_, charIndex) => <span key={charIndex} className="flex h-9 w-7 items-center justify-center rounded-sm border border-ink-100 bg-paper-raised font-mono text-sm text-ink-900">{typedLetters[thisOffset + charIndex] ?? ""}</span>)}
          </span>;
        })}
      </div>
      <label className="sr-only" htmlFor="typing-race-answer">{t.games.raceInputLabel}</label>
      <input id="typing-race-answer" className="input" data-race-input placeholder={t.games.typeAnswer} aria-describedby="race-answer-help" aria-invalid={status === "incorrect"} value={value} readOnly={status !== null} maxLength={300} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => startIfRealCharacter(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (status === null) void submit();
          else if (resolved) advance();
        }
      }} />
      <p id="race-answer-help" className="text-xs text-ink-500">{t.games.raceKeyboardHint}</p>
      {status === "checking" && <p role="status" aria-live="polite" className="text-sm text-ink-500">{dict.common.loading}</p>}
      {resolved && (
        <div role="status" aria-live="polite" data-race-feedback className={`rounded-sm border p-3 ${status === "correct" ? "border-band-good/40 bg-band-good/10" : status === "incorrect" ? "border-band-bad/40 bg-band-bad/10" : "border-ink-100 bg-paper-sunken"}`}>
          <p className="text-sm font-medium text-ink-900">{status === "correct" ? t.games.raceCorrect : status === "incorrect" ? t.games.raceIncorrect : status === "skipped" ? t.games.raceSkipped : t.games.raceUnverified}</p>
          {status === "incorrect" && <p className="mt-1 text-sm text-ink-700">{t.games.yourAnswer}: {value}</p>}
          {status === "unverified" && <p className="mt-1 text-sm text-ink-700">{t.games.answerUnverified}</p>}
          <p className="mt-1 text-sm text-ink-900">{t.games.revealedAnswer}: <strong>{current.term}</strong></p>
          <p className="mt-1 text-xs text-ink-500">{t.games.itemTime}: {formatRaceTime(elapsed)}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {status === null && <>
          <button type="button" className="btn-primary" data-race-submit disabled={value.trim().length === 0} onClick={() => void submit()}>{t.games.submitAnswer}</button>
          <button type="button" className="btn-secondary" data-race-skip onClick={skip}>{t.games.skip}</button>
        </>}
        {resolved && <button type="button" className="btn-secondary" data-race-next onClick={advance}>{index + 1 === deck.length ? t.games.finish : t.games.next}</button>}
      </div>
    </GameFrame>
  );
}

function RaceMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-sm bg-paper-sunken p-3 text-center"><dt className="text-[11px] uppercase tracking-wide text-ink-300">{label}</dt><dd className="mt-1 text-sm font-medium text-ink-900">{value}</dd></div>;
}

// ---------------------------------------------------------------------------
// 6. Translation challenge — Uzbek in, English out
// ---------------------------------------------------------------------------

function TranslationChallenge({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const translatable = useMemo(
    () => words.filter((word) => word.translationUz && word.translationUz.trim().length > 0),
    [words]
  );
  const [deck] = useState(() => shuffle(translatable).slice(0, 10));
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [correct, setCorrect] = useState(0);
  const answer = useAnswer();

  const current = deck[index];

  /**
   * Every answer the centre accepts, plus the term itself. A wrong answer shows
   * ONE example sentence — enough to think with — and never the answer list; the
   * rest is revealed only after the student actually gets it right.
   */
  /**
   * The accepted set comes from the shared grading module, so the browser and
   * the server agree by construction on what counts as a correct translation.
   */
  function acceptedAnswers(word: GameWord): string[] {
    return acceptedSpellings(word);
  }

  function check() {
    if (!current || checked !== null) return;
    const isRight = gradeSpelling(current, value);
    setChecked(isRight);
    if (isRight) setCorrect((row) => row + 1);
    void answer(current.id, { kind: "spelling", text: value });
  }

  if (deck.length === 0) {
    return <GameFrame dict={dict} title={t.games.translation} hint={t.games.translationHint} counter="0 / 0"><p className="text-sm text-ink-500">{t.games.noEligible}</p></GameFrame>;
  }
  if (!current) {
    return (
      <GameFrame dict={dict} title={t.games.translation} hint={t.games.translationHint} counter={`${correct}`}>
        <ResultBanner dict={dict} correct={correct} total={deck.length} onAgain={() => { setIndex(0); setValue(""); setChecked(null); setCorrect(0); }} />
      </GameFrame>
    );
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.translation}
      hint={t.games.translationHint}
      counter={`${t.games.progress} ${index + 1} / ${deck.length} · ${t.games.score} ${correct}`}
    >
      <p className="rounded-md bg-paper-sunken p-4 text-center text-lg text-ink-900" data-translation-prompt>
        {current.translationUz ?? current.definitionEn}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder={t.games.typeAnswer}
          aria-label={t.games.translation}
          value={value}
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && check()}
        />
        <button type="button" className="btn-primary" disabled={checked !== null} onClick={check}>
          {t.games.check}
        </button>
      </div>
      {checked !== null && (
        <div className="flex flex-col gap-2">
          {checked ? (
            <div className="rounded-md border border-band-good/40 bg-band-good/10 px-3 py-2" data-translation-reveal>
              <p className="text-sm text-band-good">{t.games.score}</p>
              <p className="mt-1 text-sm text-ink-800" data-translation-answer>
                {current.term}
                {(current.acceptedTranslations?.length ?? 0) > 0
                  ? ` · ${current.acceptedTranslations?.join(" · ")}`
                  : ""}
              </p>
              {current.collocations && (
                <p className="mt-1 text-xs text-ink-500">{current.collocations}</p>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2" data-translation-example>
              <p className="text-sm text-warn-800">{t.games.tryAgain}</p>
              {current.exampleSentence && (
                <p className="mt-1 text-sm text-ink-700">{current.exampleSentence}</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!checked && (
              <button
                type="button"
                className="btn-secondary"
                data-translation-retry
                onClick={() => {
                  setValue("");
                  setChecked(null);
                }}
              >
                {t.games.tryAgain}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setValue("");
                setChecked(null);
                setIndex((row) => row + 1);
              }}
            >
              {t.games.next}
            </button>
          </div>
        </div>
      )}
    </GameFrame>
  );
}

// ---------------------------------------------------------------------------
// 7. Sentence builder — rebuild the example sentence from shuffled words
// ---------------------------------------------------------------------------

function SentenceBuilder({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const withExamples = useMemo(() => words.filter((word) => word.exampleSentence), [words]);
  const pool = withExamples.length > 0 ? withExamples : words;
  const [round, setRound] = useState(0);
  const [deck] = useState(() => shuffle(pool).slice(0, 8));
  const [index, setIndex] = useState(0);
  const current = deck[index];
  const targetWords = useMemo(() => (current?.exampleSentence ?? current?.definitionEn ?? "").split(/\s+/).filter(Boolean), [current]);
  const [tiles, setTiles] = useState<{ id: number; word: string }[]>([]);
  const [built, setBuilt] = useState<{ id: number; word: string }[]>([]);
  const [checked, setChecked] = useState<null | boolean>(null);
  const answer = useAnswer();

  useEffect(() => {
    setTiles(shuffle(targetWords.map((word, id) => ({ id, word }))));
    setBuilt([]);
    setChecked(null);
  }, [targetWords, round]);

  function check() {
    if (!current || checked !== null) return;
    const assembled = built.map((tile) => tile.word).join(" ");
    const isRight = assembled === targetWords.join(" ");
    setChecked(isRight);
    void answer(current.id, { kind: "sentence", text: assembled });
  }

  if (!current) {
    return (
      <GameFrame dict={dict} title={t.games.builder} hint={t.games.builderHint} counter={`${deck.length}`}>
        <ResultBanner dict={dict} correct={deck.length} total={deck.length} onAgain={() => { setRound((row) => row + 1); setIndex(0); }} />
      </GameFrame>
    );
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.builder}
      hint={t.games.builderHint}
      counter={`${t.games.progress} ${index + 1} / ${deck.length}`}
    >
      <p className="text-xs text-ink-500">
        {t.games.builderHint} · {current.term}
      </p>
      <div
        className="flex min-h-[52px] flex-wrap items-center gap-1.5 rounded-md border border-dashed border-ink-100 bg-paper-sunken p-2"
        data-builder-answer
      >
        {built.length === 0 && <span className="px-1 text-xs text-ink-300">{t.games.scrambleHint}</span>}
        {built.map((tile) => (
          <button
            key={`built-${tile.id}`}
            type="button"
            className="rounded-sm bg-signal-600 px-2 py-1 text-xs text-signal-contrast"
            onClick={() => {
              if (checked !== null) return;
              setBuilt((row) => row.filter((item) => item.id !== tile.id));
              setTiles((row) => [...row, tile]);
            }}
          >
            {tile.word}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tiles.map((tile) => (
          <button
            key={`tile-${tile.id}`}
            type="button"
            className="rounded-sm border border-ink-100 px-2 py-1 text-xs text-ink-900 hover:border-signal-600"
            onClick={() => {
              if (checked !== null) return;
              setTiles((row) => row.filter((item) => item.id !== tile.id));
              setBuilt((row) => [...row, tile]);
            }}
          >
            {tile.word}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={checked !== null || tiles.length > 0} onClick={check}>
          {t.games.check}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            setBuilt([]);
            setTiles(shuffle(targetWords.map((word, id) => ({ id, word }))));
            setChecked(null);
          }}
        >
          {t.games.clear}
        </button>
      </div>
      {checked !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={checked ? "text-sm text-band-good" : "text-sm text-band-bad"}>
            {checked ? t.games.score : `${t.games.wrongAnswer}: ${targetWords.join(" ")}`}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setIndex((row) => row + 1);
              setRound((row) => row + 1);
            }}
          >
            {t.games.next}
          </button>
        </div>
      )}
    </GameFrame>
  );
}
