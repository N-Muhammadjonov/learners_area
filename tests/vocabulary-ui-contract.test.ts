import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Games is a lightweight library with history-aware dedicated routes for all seven games", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  const vocabPage = read("src/app/(app)/vocabulary/page.tsx");
  const gamePage = read("src/app/(app)/vocabulary/games/[gameId]/page.tsx");
  assert.match(panel, /data-games-library/);
  assert.match(panel, /hrefFor\(game\)/);
  assert.match(panel, /data-dedicated-game/);
  assert.match(panel, /data-game-back/);
  assert.match(panel, /loadedKey === requestKey/);
  assert.match(panel, /key=\{gameViewKey\}/);
  assert.match(studio, /navigate\("\/vocabulary\/games"\)/);
  assert.match(studio, /setTab\(next\)/);
  assert.doesNotMatch(studio, /<VocabGamesPanel/);
  assert.ok(vocabPage.indexOf('if (tab === "games") redirect') < vocabPage.indexOf('timed("vocabulary.library"'), "legacy Games query redirects before full Studio data is read");
  for (const gameId of ["cards", "choice", "match", "gap", "race", "translation", "builder"]) {
    assert.ok(panel.includes(`gameId === "${gameId}"`), `${gameId} has a dedicated view branch`);
  }
  assert.match(gamePage, /requireActiveUser\(\)/);
  assert.match(gamePage, /isGameId\(gameId\)/);
});

test("Typing Race has an answer-first timer, authoritative result, reveal, skip, and no fake WPM", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const race = panel.slice(panel.indexOf("function TypingRace"), panel.indexOf("function RaceMetric"));
  assert.match(race, /uniqueGameRound\(eligible, 10\)/);
  assert.match(race, /startedAt === null && \/\\S\/\.test\(next\)/);
  assert.match(race, /elapsedTenths\(startedAt, ticker\)/);
  assert.match(race, /aria-hidden="true" data-race-answer-boxes/);
  assert.match(race, /data-race-input/);
  assert.match(race, /event\.key === "Enter"/);
  assert.match(race, /data-race-feedback/);
  assert.match(race, /data-race-skip/);
  const skip = race.slice(race.indexOf("function skip()"), race.indexOf("const advance = useCallback"));
  assert.doesNotMatch(skip, /answer\(/, "Skip never sends a point-bearing submission");
  assert.match(race, /setStatus\("checking"\)/);
  assert.match(race, /result\?\.verified === true/);
  assert.match(race, /honestWordsPerMinute\(stats\.typedCharacters, stats\.totalSeconds\)/);
  assert.match(read("src/lib/services/vocabulary/game-round.ts"), /typedCharacters < 25 \|\| elapsedSeconds < 5/);
});

test("Matching Pairs sends both selected identities for server-side verification", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const engine = read("src/lib/services/vocabulary/engine.ts");
  assert.match(panel, /kind: "pair", pairEntryId: word\.id/);
  assert.match(engine, /input\.submission\.pairEntryId/);
  assert.match(engine, /correct = entry\.id === pairedEntry\.id/);
  assert.match(engine, /await isEntryInGameSet\([\s\S]*?entry: pairedEntry/);
});

test("definition-first flashcards keep answers hidden in the queue, reveal them accessibly, and award no mastery", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const cards = panel.slice(panel.indexOf("function Flashcards"), panel.indexOf("function MultipleChoice"));
  assert.match(cards, /data-flashcard-queue/);
  assert.match(cards, /<p>\{word\.definitionEn\}<\/p>/);
  assert.doesNotMatch(cards.slice(cards.indexOf("data-flashcard-queue"), cards.indexOf('<section className="min-w-0"')), /word\.term|translationUz|partOfSpeech/);
  assert.match(cards, /data-flashcard-scene/);
  assert.match(cards, /data-flashcard-inner/);
  assert.match(cards, /aria-hidden=\{flipped\} inert=\{flipped\}/);
  assert.match(cards, /aria-hidden=\{!flipped\} inert=\{!flipped\}/);
  assert.match(cards, /onKeyDown=\{\(event\) =>/);
  assert.match(cards, /setMarks/);
  assert.match(read("src/app/globals.css"), /\.flashcard-3d-card\[data-flipped="true"\] \.flashcard-3d-inner/);
  assert.match(read("src/app/globals.css"), /\.flashcard-queue \{[\s\S]*?overflow-y: auto/);
});

test("Vocabulary points refresh only after an authoritative positive award", () => {
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  const usePanel = read("src/components/vocabulary/VocabUsePanel.tsx");
  const revision = read("src/components/vocabulary/VocabRevisionPanel.tsx");
  const board = read("src/components/vocabulary/VocabBoardPanel.tsx");
  assert.match(usePanel, /onSaved\(res\.ok && payload\.accepted === true && Number\(payload\.points\) > 0\)/);
  assert.ok(usePanel.indexOf("onSaved(res.ok") < usePanel.indexOf('fetch("\/api\/vocabulary\/sentences")', usePanel.indexOf("onSaved(res.ok")), "the ledger refresh is not blocked on a separate sentence-list request");
  assert.match(studio, /onSaved=\{\(awarded\) => \{\s*if \(awarded\) window\.dispatchEvent/);
  assert.match(revision, /onFinished: \(remaining: number, pointsAwarded: number\)/);
  assert.match(studio, /if \(pointsAwarded > 0\) window\.dispatchEvent/);
  assert.match(board, /window\.addEventListener\("vocab:ledger-changed", refreshLedger\)/);
  assert.match(board, /cache: "no-store"/);
});

test("Typing Race animates the complete verified verdict from left to right", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const race = panel.slice(panel.indexOf("function TypingRace"), panel.indexOf("function RaceMetric"));
  assert.match(race, /status === "correct" \? "race-answer-box--correct"/);
  assert.match(race, /status === "incorrect" \? "race-answer-box--incorrect"/);
  assert.match(race, /transitionDelay: resolved \? `\$\{Math\.round\(charIndexInAnswer \* characterDelayMs\)\}ms`/);
  assert.match(race, /characterDelayMs = Math\.min\(35, 600 \/ animationCharacterCount\)/);
  assert.match(race, /status === "skipped" \|\| status === "unverified" \? expected/);
  assert.match(read("src/app/globals.css"), /\.race-answer-box--correct/);
  assert.match(read("src/app/globals.css"), /\.race-answer-box--incorrect/);
});

test("Pronounce is isolated; self-assessment alone marks and then advances", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const cards = panel.slice(panel.indexOf("function Flashcards"), panel.indexOf("function MultipleChoice"));
  const decideStart = cards.indexOf("function decide");
  const decideEnd = cards.indexOf("\n\n  if (!current) {", decideStart);
  const decide = cards.slice(decideStart, decideEnd);
  assert.match(cards, /<article[\s\S]*data-flashcard/);
  assert.doesNotMatch(cards, /role="button"[\s\S]*data-flashcard/);
  assert.match(cards, /<Speaker word=\{current\.term\}/);
  assert.match(decide, /setMarks/);
  assert.match(decide, /answer\(current\.id, \{ kind: "self"/);
  assert.match(decide, /window\.setTimeout/);
  assert.match(decide, /setIndex/);
  assert.match(cards, /data-mark="known"/);
  assert.match(cards, /data-mark="notYet"/);
  const speakerStart = panel.indexOf("function Speaker(");
  const speaker = panel.slice(speakerStart, panel.indexOf("function ResultBanner(", speakerStart));
  assert.match(speaker, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(speaker, /setFlipped|setMarks|setIndex|answer\(/);
});

test("navigation acknowledges immediately, and automatic prefetch stops at the safe private boundary", () => {
  assert.equal(read("src/lib/nav/progress.ts").match(/NAVIGATION_FEEDBACK_DELAY_MS = (\d+)/)?.[1], "60");
  const link = read("src/components/shell/LinkPending.tsx");
  assert.match(link, /NAVIGATION_FEEDBACK_DELAY_MS/);
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  const sidebar = read("src/components/shell/SidebarNav.tsx");
  assert.match(provider, /setNavigation\(intent\)/);
  assert.match(outlet, /data-workspace-loading/);
  assert.match(read("src/components/interaction/InstantLink.tsx"), /prefetch=\{prefetch \?\? null\}/);
  assert.doesNotMatch(sidebar, /prefetch=\{false\}/);
  assert.match(read("src/app/(app)/loading.tsx"), /data-private-loading-boundary/);
  assert.match(read("src/app/(app)/layout.tsx"), /getCurrentUser\(\)/);
  assert.match(read("src/app/(app)/layout.tsx"), /hasPrivateAccess\(user\.accountStatus\)/);
});

test("responsive shell has explicit small-screen sidebar hiding and width-safe content containers", () => {
  const layout = read("src/app/(app)/layout.tsx");
  const globals = read("src/app/globals.css");
  assert.match(layout, /hidden h-full[^\n]*md:flex/);
  assert.match(layout, /min-w-0 flex-1/);
  assert.match(layout, /overflow-x-hidden/);
  assert.match(globals, /--shell-pad-x/);
  // These structural assertions do not substitute for real browser viewport measurements.
});

test("every requested dedicated route file exists", () => {
  assert.ok(existsSync(join(root, "src/app/(app)/vocabulary/games/page.tsx")));
  assert.ok(existsSync(join(root, "src/app/(app)/vocabulary/games/[gameId]/page.tsx")));
});
