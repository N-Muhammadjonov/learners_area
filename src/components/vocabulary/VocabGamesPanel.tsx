"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { collocationChips } from "./types";
import type { GameSetKey, GameSetResponse, GameWord, VocabFolder, VocabPack } from "./types";

type GameId = "cards" | "choice" | "match" | "gap" | "race" | "translation" | "builder";

const GAMES: GameId[] = ["cards", "choice", "match", "gap", "race", "translation", "builder"];

/**
 * GAMES — casual practice over the same library.
 *
 * The set selector chooses which words are in play (all / due / weak / from
 * Reading / from Listening / topic pack / folder / teacher-assigned). Answers are
 * scored by the server, which re-derives eligibility itself: a correct answer on
 * a word that was genuinely due earns one practice point, and replaying the same
 * set on the same day earns nothing. No game can move the revision schedule.
 */
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
  const [active, setActive] = useState<GameId | null>(null);
  const [set, setSet] = useState<GameSetResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ set: setKey });
    if (setKey === "topic" && topicPack) params.set("topicPack", topicPack);
    if (setKey === "folder" && folderId) params.set("folderId", folderId);
    const res = await fetch(`/api/vocabulary/games?${params.toString()}`);
    const payload = await res.json().catch(() => null);
    setLoading(false);
    if (payload?.ok) setSet(payload as GameSetResponse);
  }, [setKey, topicPack, folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const words = set?.words ?? [];
  const setLabel = useMemo(() => {
    const base = t.games.set[setKey];
    if (setKey === "topic" && topicPack) {
      const pack = packs.find((item) => item.id === topicPack);
      return pack ? `${base} · ${pack.label}` : base;
    }
    if (setKey === "folder" && folderId) {
      const folder = folders.find((item) => item.id === folderId);
      return folder ? `${base} · ${folder.name}` : base;
    }
    return base;
  }, [setKey, topicPack, folderId, packs, folders, t]);

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <h2 className="text-sm font-medium text-ink-900">{t.games.title}</h2>
        <p className="mt-1 text-xs text-ink-500">{t.games.hint}</p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            {t.games.set.label}
            <select
              className="input"
              aria-label={t.games.set.label}
              data-game-set
              value={setKey}
              onChange={(event) => setSetKey(event.target.value as GameSetKey)}
            >
              {(
                ["all", "due", "weak", "reading", "listening", "topic", "folder", "assigned"] as GameSetKey[]
              ).map((key) => (
                <option key={key} value={key}>
                  {t.games.set[key]}
                </option>
              ))}
            </select>
          </label>

          {setKey === "topic" && packs.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              {t.packs.title}
              <select
                className="input"
                aria-label={t.packs.title}
                value={topicPack}
                onChange={(event) => setTopicPack(event.target.value)}
              >
                {packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.label} · {pack.wordCount}
                  </option>
                ))}
              </select>
            </label>
          )}

          {setKey === "folder" && folders.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              {t.folders.title}
              <select
                className="input"
                aria-label={t.folders.title}
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name} · {folder.count}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="mt-3 text-xs text-ink-500" data-game-set-status>
          {loading
            ? dict.common.loading
            : `${setLabel} · ${words.length} ${t.packs.words}${set ? ` · ${set.due} ${t.summary.dueToday}` : ""}`}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game) => (
          <button
            key={game}
            type="button"
            data-game={game}
            disabled={words.length === 0}
            onClick={() => setActive(game)}
            className={`card flex flex-col gap-1 p-4 text-left transition-colors disabled:opacity-50 ${
              active === game ? "border-signal-600 bg-signal-50" : "hover:border-signal-600"
            }`}
          >
            <span className="text-sm font-medium text-ink-900">
              {game === "cards"
                ? t.games.cards
                : game === "choice"
                  ? t.games.choice
                  : game === "match"
                    ? t.games.match
                    : game === "gap"
                      ? t.games.gap
                      : game === "race"
                        ? t.games.race
                        : game === "translation"
                          ? t.games.translation
                          : t.games.builder}
            </span>
            <span className="text-xs text-ink-500">
              {game === "cards"
                ? t.games.cardsHint
                : game === "choice"
                  ? t.games.choiceHint
                  : game === "match"
                    ? t.games.matchHint
                    : game === "gap"
                      ? t.games.gapHint
                      : game === "race"
                        ? t.games.raceHint
                        : game === "translation"
                          ? t.games.translationHint
                          : t.games.builderHint}
            </span>
          </button>
        ))}
      </div>

      {words.length === 0 && !loading && (
        <p className="text-sm text-ink-500">{t.games.noWords}</p>
      )}

      {active && words.length > 0 && (
        <div data-active-game={active}>
          {active === "cards" && <Flashcards dict={dict} words={words} />}
          {active === "choice" && <MultipleChoice dict={dict} words={words} />}
          {active === "match" && <MatchingPairs dict={dict} words={words} />}
          {active === "gap" && <FillTheGap dict={dict} words={words} />}
          {active === "race" && <TypingRace dict={dict} words={words} />}
          {active === "translation" && <TranslationChallenge dict={dict} words={words} />}
          {active === "builder" && <SentenceBuilder dict={dict} words={words} />}
        </div>
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

function normalise(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One answered word, reported to the ledger. */
function useAnswer(setKey: GameSetKey) {
  return useCallback(
    async (entryId: string, correct: boolean) => {
      await fetch("/api/vocabulary/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, correct, set: setKey }),
      }).catch(() => null);
    },
    [setKey]
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
// 1. Flashcards — definition first, side queue, 0.5 s flip-back and auto-advance
// ---------------------------------------------------------------------------

function Flashcards({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const [deck, setDeck] = useState(() => shuffle(words).slice(0, 20));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState<Record<string, "known" | "notYet">>({});
  const [correct, setCorrect] = useState(0);
  const answer = useAnswer("all");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const current = deck[index];
  const remaining = deck.slice(index);

  function restart() {
    setDeck(shuffle(words).slice(0, 20));
    setIndex(0);
    setFlipped(false);
    setMarks({});
    setCorrect(0);
  }

  function decide(known: boolean) {
    if (!current || timer.current) return;
    setMarks((current) => ({ ...current, [deck[index]!.id]: known ? "known" : "notYet" }));
    if (known) setCorrect((value) => value + 1);
    void answer(current.id, known);
    // The card turns back over first, then the deck advances by itself.
    timer.current = setTimeout(() => {
      setFlipped(false);
      timer.current = setTimeout(() => {
        setIndex((value) => value + 1);
        timer.current = null;
      }, 500);
    }, 500);
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
        <div
          role="button"
          tabIndex={0}
          aria-label={flipped ? current.term : current.definitionEn}
          data-flashcard={flipped ? "answer" : "definition"}
          onClick={() => setFlipped((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setFlipped((value) => !value);
            }
          }}
          className="flex min-h-[230px] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-ink-100 bg-paper-sunken p-6 text-center"
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
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button type="button" className="btn-secondary" onClick={() => setFlipped((value) => !value)}>
            {flipped ? t.games.showDefinition : t.games.flip}
          </button>
          {flipped && (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <button type="button" className="btn-primary" data-mark="known" onClick={() => decide(true)}>
                {t.games.known}
              </button>
              <button type="button" className="btn-gold" data-mark="notYet" onClick={() => decide(false)}>
                {t.games.notYet}
              </button>
            </div>
          )}
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
  const [deck] = useState(() => shuffle(words).slice(0, 12));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const answer = useAnswer("all");

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
    const isRight = normalise(option) === normalise(current.term);
    if (isRight) setCorrect((value) => value + 1);
    void answer(current.id, isRight);
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
          const isRight = normalise(option) === normalise(current.term);
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
            {normalise(picked) === normalise(current.term) ? t.games.score : t.games.wrongAnswer}: {current.term}
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
  const answer = useAnswer("all");

  function pickRight(word: GameWord) {
    if (!picked || matched.includes(word.id)) return;
    const right = picked.id === word.id;
    void answer(picked.id, right);
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
  const answer = useAnswer("all");

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
    const isRight = normalise(value) === normalise(current.term);
    setChecked(isRight);
    if (isRight) setCorrect((row) => row + 1);
    void answer(current.id, isRight);
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
// 5. Typing race — the clock starts on the first keystroke
// ---------------------------------------------------------------------------

function TypingRace({ dict, words }: { dict: Dictionary; words: GameWord[] }) {
  const t = dict.vocabulary;
  const [deck] = useState(() => shuffle(words).slice(0, 15));
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [typedChars, setTypedChars] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const answer = useAnswer("all");

  useEffect(() => {
    if (startedAt === null || finished) return;
    const id = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= 60) setFinished(true);
    }, 100);
    return () => clearInterval(id);
  }, [startedAt, finished]);

  const current = deck[index];
  const wpm = elapsed > 0 ? Math.round(typedChars / 5 / (elapsed / 60)) : 0;
  const accuracy = attempts > 0 ? Math.round((correct / attempts) * 100) : 100;

  function submit() {
    if (!current || finished) return;
    const isRight = normalise(value) === normalise(current.term);
    setAttempts((row) => row + 1);
    setTypedChars((row) => row + Math.min(value.length, current.term.length));
    if (isRight) setCorrect((row) => row + 1);
    void answer(current.id, isRight);
    setValue("");
    if (index + 1 >= deck.length) setFinished(true);
    else setIndex((row) => row + 1);
  }

  return (
    <GameFrame
      dict={dict}
      title={t.games.race}
      hint={t.games.raceHint}
      counter={`${t.games.seconds}: ${Math.min(60, Math.floor(elapsed))} · ${wpm} ${t.games.wpm}`}
    >
      {finished ? (
        <ResultBanner
          dict={dict}
          correct={correct}
          total={Math.max(attempts, 1)}
          onAgain={() => {
            setIndex(0);
            setValue("");
            setStartedAt(null);
            setElapsed(0);
            setFinished(false);
            setTypedChars(0);
            setCorrect(0);
            setAttempts(0);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
            <span>
              {t.games.progress} {index + 1} / {deck.length} · {t.games.score} {correct}
            </span>
            <span>
              {t.games.accuracy}: {accuracy}%
            </span>
          </div>
          <p className="rounded-md bg-paper-sunken p-4 text-center text-lg text-ink-900" data-race-prompt>
            {current?.definitionEn}
          </p>
          <input
            className="input"
            placeholder={t.games.typeAnswer}
            aria-label={t.games.race}
            value={value}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => {
              if (startedAt === null) setStartedAt(Date.now());
              setValue(event.target.value);
            }}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
        </>
      )}
    </GameFrame>
  );
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
  const [deck] = useState(() => shuffle(translatable.length > 0 ? translatable : words).slice(0, 10));
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [correct, setCorrect] = useState(0);
  const answer = useAnswer("all");

  const current = deck[index];

  function check() {
    if (!current || checked !== null) return;
    const isRight = normalise(value) === normalise(current.term);
    setChecked(isRight);
    if (isRight) setCorrect((row) => row + 1);
    void answer(current.id, isRight);
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
  const answer = useAnswer("all");

  useEffect(() => {
    setTiles(shuffle(targetWords.map((word, id) => ({ id, word }))));
    setBuilt([]);
    setChecked(null);
  }, [targetWords, round]);

  function check() {
    if (!current || checked !== null) return;
    const isRight = built.map((tile) => tile.word).join(" ") === targetWords.join(" ");
    setChecked(isRight);
    void answer(current.id, isRight);
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
