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
  assert.match(studio, /router\.push\("\/vocabulary\/games"\)/);
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
  assert.match(race, /next\.trim\(\)\.length > 0/);
  assert.match(race, /elapsedTenths\(startedAt, ticker\)/);
  assert.match(race, /aria-hidden="true" data-race-answer-boxes/);
  assert.match(race, /data-race-input/);
  assert.match(race, /event\.key === "Enter"/);
  assert.match(race, /data-race-feedback/);
  assert.match(race, /data-race-skip/);
  const skip = race.slice(race.indexOf("function skip()"), race.indexOf("function advance()"));
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

test("Pronounce is a separate semantic control; assessment only marks and does not flip or advance", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const cards = panel.slice(panel.indexOf("function Flashcards"), panel.indexOf("function MultipleChoice"));
  const decideStart = cards.indexOf("function decide");
  const decideEnd = cards.indexOf("\n\n  if (!current) {", decideStart);
  const decide = cards.slice(decideStart, decideEnd);
  assert.match(cards, /<article[\s\S]*data-flashcard/);
  assert.doesNotMatch(cards, /role="button"[\s\S]*data-flashcard/);
  assert.match(cards, /<Speaker word=\{current\.term\}/);
  assert.doesNotMatch(decide, /setFlipped|setIndex/);
  assert.match(decide, /setMarks/);
  assert.match(cards, /data-mark="known"/);
  assert.match(cards, /data-mark="notYet"/);
  assert.match(cards, /target\.tagName === "BUTTON"/);
});

test("navigation feedback is visible within 50–100ms and private sidebar data prefetch is disabled", () => {
  assert.equal(read("src/lib/nav/progress.ts").match(/NAVIGATION_FEEDBACK_DELAY_MS = (\d+)/)?.[1], "60");
  const link = read("src/components/shell/LinkPending.tsx");
  assert.match(link, /NAVIGATION_FEEDBACK_DELAY_MS/);
  const sidebar = read("src/components/shell/SidebarNav.tsx");
  assert.match(sidebar, /prefetch=\{false\}/);
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
