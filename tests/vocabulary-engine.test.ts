import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MASTERY_ORDER,
  NEW_STAGE,
  SRS_INTERVALS,
  applyReview,
  dueAtFrom,
  intervalDaysFor,
  isNewEntry,
  isWeak,
  masteryFor,
  nextStage,
} from "../src/lib/services/vocabulary/srs";
import {
  VOCAB_POINTS,
  POINT_VALUES,
  TIMEZONE,
  dayKey,
  dedupeKeys,
  streakFromDays,
  sentenceDedupeHash,
} from "../src/lib/services/vocabulary/points";
import {
  dedupeBulk,
  normalizePartOfSpeech,
  normalizeTerm,
  senseKeyOf,
} from "../src/lib/services/vocabulary/dedupe";
import {
  searchRows,
  SEARCH_LIMIT,
} from "../src/lib/services/vocabulary/search";
import {
  acceptedSpellings,
  gradeSentence,
  gradeSpelling,
  isVerifiableKind,
  normalizeAnswer,
  shouldAwardGamePoint,
  submissionMatchesGame,
} from "../src/lib/services/vocabulary/grading";
import { elapsedTenths, formatRaceTime, honestWordsPerMinute, typingRaceAccuracy, uniqueGameRound } from "../src/lib/services/vocabulary/game-round";
import {
  TOPIC_PACKS,
  findPack,
  isPackId,
} from "../src/lib/services/vocabulary/packs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

// ---------------------------------------------------------------------------
// The spaced-repetition ladder
// ---------------------------------------------------------------------------

test("the official intervals are 1 / 3 / 7 / 16 / 35 days", () => {
  assert.deepEqual([...SRS_INTERVALS], [1, 3, 7, 16, 35]);
  assert.equal(intervalDaysFor(0), 1);
  assert.equal(intervalDaysFor(1), 3);
  assert.equal(intervalDaysFor(2), 7);
  assert.equal(intervalDaysFor(3), 16);
  assert.equal(intervalDaysFor(4), 35);
  // Never scheduled yet.
  assert.equal(intervalDaysFor(NEW_STAGE), 0);
  assert.equal(isNewEntry(NEW_STAGE), true);
});

test("a correct recall advances one stage and stops at 35 days", () => {
  assert.equal(nextStage(NEW_STAGE, "correct"), 0);
  assert.equal(nextStage(0, "correct"), 1);
  assert.equal(nextStage(1, "correct"), 2);
  assert.equal(nextStage(3, "correct"), 4);
  assert.equal(nextStage(4, "correct"), 4, "the last stage cannot overflow");
});

test("a missed recall returns to the first stage, not to zero progress", () => {
  assert.equal(nextStage(4, "incorrect"), 0);
  assert.equal(nextStage(0, "incorrect"), 0);
  // And the word comes back tomorrow rather than in a month.
  const now = new Date("2026-03-01T09:00:00.000Z");
  const next = dueAtFrom(0, now);
  assert.equal(next.toISOString().slice(0, 10), "2026-03-02");
});

test("a word reviewed today is never due today again", () => {
  const now = new Date("2026-03-01T09:00:00.000Z");
  for (const stage of [0, 1, 2, 3, 4]) {
    assert.ok(
      dueAtFrom(stage, now).getTime() > now.getTime(),
      `stage ${stage} must schedule forward`,
    );
  }
});

test("mastery climbs NEW -> LEARNING -> KNOWN -> ACTIVE -> MASTERED", () => {
  assert.equal(
    masteryFor({
      srsStage: NEW_STAGE,
      correctCount: 0,
      incorrectCount: 0,
      activeUseCount: 0,
    }),
    "new",
  );
  assert.equal(
    masteryFor({
      srsStage: 1,
      correctCount: 2,
      incorrectCount: 0,
      activeUseCount: 0,
    }),
    "learning",
  );
  assert.equal(
    masteryFor({
      srsStage: 2,
      correctCount: 3,
      incorrectCount: 1,
      activeUseCount: 0,
    }),
    "known",
  );
  assert.equal(
    masteryFor({
      srsStage: 2,
      correctCount: 3,
      incorrectCount: 1,
      activeUseCount: 1,
    }),
    "active",
  );
  // Used in a sentence AND at the final stage: the only way to MASTERED.
  assert.equal(
    masteryFor({
      srsStage: 4,
      correctCount: 6,
      incorrectCount: 0,
      activeUseCount: 1,
    }),
    "mastered",
  );
  assert.deepEqual(MASTERY_ORDER, [
    "new",
    "learning",
    "known",
    "active",
    "mastered",
  ]);
});

test("a game score cannot produce MASTERED — only recall plus real use can", () => {
  const asIfGamesAdvanced = masteryFor({
    srsStage: 4,
    correctCount: 40,
    incorrectCount: 0,
    activeUseCount: 0,
  });
  assert.notEqual(asIfGamesAdvanced, "mastered");
  assert.equal(asIfGamesAdvanced, "known");
});

test("applyReview keeps counters and the schedule consistent", () => {
  const now = new Date("2026-03-01T09:00:00.000Z");
  const correct = applyReview(
    {
      srsStage: NEW_STAGE,
      correctCount: 0,
      incorrectCount: 0,
      activeUseCount: 0,
    },
    "correct",
    now,
  );
  assert.equal(correct.srsStage, 0);
  assert.equal(correct.correctCount, 1);
  assert.equal(correct.intervalDays, 1);
  assert.equal(correct.mastery, "learning");

  const wrong = applyReview(
    { srsStage: 3, correctCount: 4, incorrectCount: 0, activeUseCount: 0 },
    "incorrect",
    now,
  );
  assert.equal(wrong.srsStage, 0);
  assert.equal(wrong.incorrectCount, 1);
  assert.equal(wrong.intervalDays, 1);
});

test("weak words are the ones remembered less than 60% of the time", () => {
  assert.equal(
    isWeak({ correctCount: 0, incorrectCount: 0, mastery: "new" }),
    true,
  );
  assert.equal(
    isWeak({ correctCount: 1, incorrectCount: 3, mastery: "learning" }),
    true,
  );
  assert.equal(
    isWeak({ correctCount: 4, incorrectCount: 1, mastery: "learning" }),
    false,
  );
  assert.equal(
    isWeak({ correctCount: 0, incorrectCount: 5, mastery: "mastered" }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Points, leaderboard and streak
// ---------------------------------------------------------------------------

test("the point contract is save 0, scheduled revision 1, verified game answer 1, accepted RIWI sentence 2", () => {
  assert.equal(VOCAB_POINTS.newWord, 0);
  assert.equal(VOCAB_POINTS.revision, 1);
  assert.equal(VOCAB_POINTS.gameAnswer, 1);
  assert.equal(VOCAB_POINTS.sentence, 2);
  assert.deepEqual(POINT_VALUES, { new_word: 0, revision: 1, game_answer: 1, sentence: 2 });
});

test("the timezone is Asia/Tashkent and day keys use it", () => {
  assert.equal(TIMEZONE, "Asia/Tashkent");
  // 2026-01-01T20:00Z is already 01:00 on 2 January in Tashkent (UTC+5).
  assert.equal(dayKey(new Date("2026-01-01T20:00:00.000Z")), "2026-01-02");
  assert.equal(dayKey(new Date("2026-01-01T18:59:00.000Z")), "2026-01-01");
});

test("a streak survives until the day after the last study day", () => {
  const today = new Date("2026-03-10T10:00:00.000Z");
  assert.equal(streakFromDays([], today), 0);
  assert.equal(
    streakFromDays(["2026-03-10", "2026-03-09", "2026-03-08"], today),
    3,
  );
  // Nothing today, but yesterday counts — a streak should not die at midnight.
  assert.equal(streakFromDays(["2026-03-09", "2026-03-08"], today), 2);
  // A gap ends the run.
  assert.equal(streakFromDays(["2026-03-10", "2026-03-08"], today), 1);
  // Something old is not a streak.
  assert.equal(streakFromDays(["2026-02-01"], today), 0);
});

test("revision, game, and sentence ledger keys deduplicate the intended replay scopes", () => {
  const scheduledAt = new Date("2026-03-10T12:00:00.000Z");
  assert.equal(dedupeKeys.revision("u1", "v1", scheduledAt), dedupeKeys.revision("u1", "v1", scheduledAt));
  assert.notEqual(dedupeKeys.revision("u1", "v1", scheduledAt), dedupeKeys.revision("u1", "v1", new Date("2026-03-11T12:00:00.000Z")));
  const a = dedupeKeys.gameAnswer("u1", "race", "due:2026-03-10", "v1");
  const replay = dedupeKeys.gameAnswer("u1", "race", "due:2026-03-10", "v1");
  assert.equal(a, replay, "same game/set/day/word replay has one key");
  assert.notEqual(a, dedupeKeys.gameAnswer("u1", "choice", "due:2026-03-10", "v1"));
  assert.notEqual(a, dedupeKeys.gameAnswer("u1", "race", "due:2026-03-11", "v1"));
  assert.equal(dedupeKeys.sentence("u1", "v1", "hash"), dedupeKeys.sentence("u1", "v1", "hash"));
  assert.notEqual(dedupeKeys.sentence("u1", "v1", "hash"), dedupeKeys.sentence("u1", "v2", "hash"));
  assert.equal(sentenceDedupeHash("  I like apples! "), sentenceDedupeHash("i like apples"));
});

test("verified answer point gate rejects wrong, skipped, self-assessed, and mismatched game submissions", () => {
  assert.equal(submissionMatchesGame("race", "spelling"), true);
  assert.equal(submissionMatchesGame("builder", "sentence"), true);
  assert.equal(submissionMatchesGame("cards", "self"), true);
  assert.equal(submissionMatchesGame("match", "pair"), true);
  assert.equal(submissionMatchesGame("cards", "spelling"), false);
  assert.equal(submissionMatchesGame("match", "spelling"), false);
  assert.equal(shouldAwardGamePoint({ gameId: "race", kind: "spelling", verified: true, correct: true }), true);
  assert.equal(shouldAwardGamePoint({ gameId: "race", kind: "spelling", verified: true, correct: false }), false);
  assert.equal(shouldAwardGamePoint({ gameId: "cards", kind: "self", verified: false, correct: true }), false);
  assert.equal(shouldAwardGamePoint({ gameId: "match", kind: "pair", verified: true, correct: true }), true);
  assert.equal(shouldAwardGamePoint({ gameId: "match", kind: "pair", verified: true, correct: false }), false);
  assert.equal(shouldAwardGamePoint({ gameId: "race", kind: "spelling", verified: false, correct: true }), false);
  assert.equal(shouldAwardGamePoint({ gameId: "cards", kind: "spelling", verified: true, correct: true }), false);
});

test("Typing Race clock rounds tenths; zero input starts at zero; WPM is withheld on tiny samples", () => {
  assert.equal(elapsedTenths(1000, 1049), 0);
  assert.equal(elapsedTenths(1000, 1050), 0.1);
  assert.equal(elapsedTenths(1000, 1999), 1);
  assert.equal(elapsedTenths(1000, 900), 0);
  assert.equal(formatRaceTime(3.26), "3.3 s");
  assert.equal(typingRaceAccuracy(2, 1), 67);
  assert.equal(typingRaceAccuracy(0, 0), null);
  assert.equal(honestWordsPerMinute(4, 1), null);
  assert.equal(honestWordsPerMinute(25, 5), 60);
});

test("Typing Race round has at most ten distinct usable items and never repeats ids", () => {
  const source = Array.from({ length: 12 }, (_, index) => ({ id: `v${index}` }));
  const round = uniqueGameRound([...source, source[0]!], 10, () => 0.5);
  assert.equal(round.length, 10);
  assert.equal(new Set(round.map((item) => item.id)).size, 10);
  assert.equal(uniqueGameRound(source.slice(0, 3), 10).length, 3);
});

test("the ledger makes replaying a request a no-op", () => {
  const engine = read("src/lib/services/vocabulary/engine.ts");
  assert.match(
    engine,
    /onConflictDoNothing\(\{ target: vocabPointEvents\.dedupeKey \}\)/,
  );
  // Paid actions are looked up from constants; saving a word has no write path.
  for (const kind of ["revision", "gameAnswer", "sentence"]) {
    assert.match(
      engine,
      new RegExp(`VOCAB_POINTS\\.${kind}`),
      `${kind} must be awarded from VOCAB_POINTS`,
    );
  }
  const addBatch = engine.slice(engine.indexOf("export async function addVocabularyBatch"), engine.indexOf("// ---------------------------------------------------------------------------\n// Scheduled revision"));
  assert.doesNotMatch(addBatch, /kind:\s*"new_word"/, "a saved word must not create a zero-point ledger event");
  assert.ok(
    !/points:\s*input\.points/.test(engine),
    "a caller-supplied point value must never be written",
  );
});

// ---------------------------------------------------------------------------
// Sense-aware deduplication
// ---------------------------------------------------------------------------

test("the same sense is one word, different senses are two", () => {
  assert.equal(normalizeTerm("  The  BANK "), "bank");

  const river = senseKeyOf({
    term: "bank",
    partOfSpeech: "noun",
    meaning: "the side of a river",
  });
  const money = senseKeyOf({
    term: "bank",
    partOfSpeech: "noun",
    meaning: "a place that keeps money",
  });
  assert.notEqual(river, money, "two senses of one spelling must not collapse");

  const again = senseKeyOf({
    term: "Bank",
    partOfSpeech: "noun",
    meaning: "The side of a river.",
  });
  assert.equal(river, again, "the same sense typed differently is a duplicate");
});

test("part-of-speech forms are normalized", () => {
  assert.equal(normalizePartOfSpeech("n."), "noun");
  assert.equal(normalizePartOfSpeech("Noun"), "noun");
  assert.equal(normalizePartOfSpeech("v"), "verb");
  assert.equal(normalizePartOfSpeech("phr"), "phrase");
});

test("a bulk add collapses its own duplicates and keeps the first", () => {
  const { unique, duplicates } = dedupeBulk([
    { term: "curious", partOfSpeech: "adjective", meaning: "wanting to know" },
    { term: "Curious", partOfSpeech: "adj", meaning: "wanting to know" },
    { term: "curious", partOfSpeech: "adjective", meaning: "strange" },
  ]);
  assert.equal(unique.length, 2);
  assert.equal(duplicates.length, 1);
  assert.equal(unique[0]!.term, "curious");
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const LIBRARY = [
  {
    id: "1",
    term: "reliable",
    definitionEn: "can be trusted",
    translationUz: "ishonchli",
  },
  {
    id: "2",
    term: "reliance",
    definitionEn: "the state of depending on something",
    translationUz: "tayanish",
  },
  {
    id: "3",
    term: "self-reliant",
    definitionEn: "able to work alone",
    translationUz: "mustaqil",
  },
  {
    id: "4",
    term: "trustworthy",
    definitionEn: "reliable and honest",
    translationUz: "ishonchli",
  },
];

test("search ranks exact, then prefix, then meaning, in both languages", () => {
  assert.equal(searchRows(LIBRARY, "reliable")[0]!.row.term, "reliable");
  const prefix = searchRows(LIBRARY, "rel");
  assert.equal(prefix[0]!.row.term, "reliable");
  assert.ok(
    prefix.length >= 3,
    "prefix matches must include every related term",
  );

  const uzbek = searchRows(LIBRARY, "ishonchli");
  assert.equal(uzbek.length, 2, "Uzbek translations must be searchable");
  assert.ok(uzbek.every((hit) => hit.match === "translation"));

  const meaning = searchRows(LIBRARY, "trusted");
  assert.equal(meaning[0]!.row.term, "reliable");
  assert.equal(meaning[0]!.match, "definition");
});

test("search is capped so the dropdown stays readable", () => {
  assert.equal(SEARCH_LIMIT, 12);
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    term: `word${i}`,
  }));
  assert.equal(searchRows(many, "word").length, SEARCH_LIMIT);
  assert.equal(searchRows(many, "word", 5).length, 5);
});

test("an empty query returns nothing instead of the whole library", () => {
  assert.deepEqual(searchRows(LIBRARY, "   "), []);
});

// ---------------------------------------------------------------------------
// Topic packs
// ---------------------------------------------------------------------------

test("topic packs carry real authored content in both languages", () => {
  const ids = TOPIC_PACKS.map((pack) => pack.id);
  assert.ok(ids.includes("health_medicine"));
  assert.ok(ids.includes("work_career"));
  for (const pack of TOPIC_PACKS) {
    assert.ok(pack.words.length >= 10, `${pack.id} should be a usable set`);
    assert.ok(pack.label.en && pack.label.uz, `${pack.id} needs both labels`);
    for (const word of pack.words) {
      assert.ok(
        word.term && word.definitionEn && word.translationUz && word.example,
        `${pack.id}:${word.term} is incomplete`,
      );
    }
  }
  assert.equal(findPack("work_career")?.label.uz, "Ish va karyera");
  assert.equal(isPackId("health_medicine"), true);
  assert.equal(isPackId("../../etc/passwd"), false);
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

test("only scheduled revision touches the official ladder", () => {
  const engine = read("src/lib/services/vocabulary/engine.ts");
  const gameBlock = engine.slice(
    engine.indexOf("export async function recordGameAnswer"),
    engine.indexOf("// Sentence Bank"),
  );
  assert.ok(
    !/srsStage:/.test(gameBlock),
    "a game answer must not write the SRS stage",
  );
  assert.ok(
    !/update\(userVocabulary\)/.test(gameBlock),
    "a game answer must not update the word row",
  );
  assert.match(gameBlock, /srsUntouched: true/);
});

test("the engine is the single path: modules must not insert words directly", () => {
  const files = [
    "src/app/api/vocabulary/route.ts",
    "src/app/api/vocabulary/[id]/review/route.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.ok(
      !/insert\(userVocabulary\)/.test(source),
      `${file} must go through the vocabulary engine, not insert words itself`,
    );
  }
});

// ---------------------------------------------------------------------------
// Game answers are graded by the server, never asserted by the browser
// ---------------------------------------------------------------------------

test("an answer is folded the way the browser folds it, so both agree", () => {
  assert.equal(normalizeAnswer("  Traffic   Congestion. "), "traffic congestion");
  assert.equal(normalizeAnswer("o\u2019clock"), "o'clock");
  assert.equal(normalizeAnswer("DON'T"), "don't");
  // The retired client rule used a locale-aware lower-casing, which turns "I"
  // into a dotless letter on a Turkish machine. The shared rule is locale-free.
  assert.equal(normalizeAnswer("I"), "i");
});

test("the accepted set is the word plus its authored alternatives, deduplicated", () => {
  const set = acceptedSpellings({ term: "Commence", acceptedTranslations: ["commence", "start", "begin"] });
  assert.deepEqual(set.sort(), ["begin", "commence", "start"]);
  assert.deepEqual(acceptedSpellings({ term: "solo", acceptedTranslations: [] }), ["solo"]);
  assert.deepEqual(acceptedSpellings({ term: "solo", acceptedTranslations: null }), ["solo"]);
});

test("a typed answer is graded against the stored word, punctuation and case aside", () => {
  const word = { term: "resilient", acceptedTranslations: ["tough"] };
  assert.equal(gradeSpelling(word, " Resilient! "), true);
  assert.equal(gradeSpelling(word, "tough"), true);
  assert.equal(gradeSpelling(word, "resilience"), false);
  assert.equal(gradeSpelling(word, ""), false);
  // A word authored without alternatives has exactly one correct answer.
  assert.equal(gradeSpelling({ term: "resilient", acceptedTranslations: [] }, "tough"), false);
});

test("an assembled sentence is compared with the sentence it was built from", () => {
  assert.equal(gradeSentence("Cities ease congestion.", "cities  ease congestion."), true);
  assert.equal(gradeSentence("Cities ease congestion.", "cities ease"), false);
  assert.equal(gradeSentence("Cities ease congestion.", "   "), false);
});

test("only the two checkable kinds count as verified, so a claim cannot earn a point", () => {
  assert.equal(isVerifiableKind("spelling"), true);
  assert.equal(isVerifiableKind("sentence"), true);
  assert.equal(isVerifiableKind("self"), false);
});
