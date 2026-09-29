import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const engine = readFileSync(join(ROOT, "src/lib/services/vocabulary/engine.ts"), "utf8");
const points = readFileSync(join(ROOT, "src/lib/services/vocabulary/points.ts"), "utf8");
const board = readFileSync(join(ROOT, "src/components/vocabulary/VocabBoardPanel.tsx"), "utf8");
const games = readFileSync(join(ROOT, "src/components/vocabulary/VocabGamesPanel.tsx"), "utf8");

test("leaderboard totals use current effective event-kind values, not stored historical amounts", () => {
  const source = engine.slice(engine.indexOf("function effectivePointRows()"), engine.indexOf("export async function getStanding"));
  assert.match(source, /kind} = 'new_word'[\s\S]*?POINT_VALUES\.new_word/);
  assert.match(source, /kind} = 'revision'[\s\S]*?POINT_VALUES\.revision/);
  assert.match(source, /kind} = 'game_answer'[\s\S]*?POINT_VALUES\.game_answer/);
  assert.match(source, /kind} = 'sentence'[\s\S]*?POINT_VALUES\.sentence/);
  assert.match(source, /ELSE 0/);

  const standing = engine.slice(engine.indexOf("export async function getStanding"), engine.indexOf("export async function recentAwards"));
  assert.match(standing, /sum\(\$\{effectiveRows\.effectivePoints\}\)/);
  assert.match(standing, /having\(sql`sum\(\$\{effectiveRows\.effectivePoints\}\) > 0`\)/);
  assert.doesNotMatch(standing, /sum\(\$\{vocabPointEvents\.points\}\)/);
  assert.match(source, /PARTITION BY[\s\S]*?vocabPointEvents\.userId[\s\S]*?vocabPointEvents\.createdAt[\s\S]*?AT TIME ZONE \$\{TIMEZONE\}/);
});

test("game award dedupe is learner + saved word + Tashkent day across game modes", () => {
  assert.match(points, /gameAnswer: \(userId: string, vocabularyId: string, tashkentDay: string\)/);
  assert.match(points, /`game:\$\{userId\}:\$\{vocabularyId\}:\$\{tashkentDay\}`/);
  assert.doesNotMatch(points, /gameAnswer:[^\n]*gameId/);
  assert.match(engine, /legacy game-answer duplicates are collapsed per learner\/entry\/day/i);
});

test("legitimate game awards refresh the private board from the authoritative ledger", () => {
  assert.match(games, /result\.awarded > 0[\s\S]*?vocab:ledger-changed/);
  assert.match(board, /fetch\("\/api\/vocabulary\/leaderboard", \{ cache: "no-store" \}\)/);
  assert.match(board, /addEventListener\("vocab:ledger-changed"/);
});
