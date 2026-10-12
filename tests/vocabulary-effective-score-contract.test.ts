import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const engine = readFileSync(join(ROOT, "src/lib/services/vocabulary/engine.ts"), "utf8");
const points = readFileSync(join(ROOT, "src/lib/services/vocabulary/points.ts"), "utf8");
const board = readFileSync(join(ROOT, "src/components/vocabulary/VocabBoardPanel.tsx"), "utf8");
const games = readFileSync(join(ROOT, "src/components/vocabulary/VocabGamesPanel.tsx"), "utf8");
const leaderboardRoute = readFileSync(join(ROOT, "src/app/api/vocabulary/leaderboard/route.ts"), "utf8");

test("leaderboard totals use current effective event-kind values, not stored historical amounts", () => {
  const source = engine.slice(engine.indexOf("export function buildEffectivePointRows()"), engine.indexOf("export async function getStanding"));
  assert.match(source, /kind} = 'new_word'[\s\S]*?POINT_VALUES\.new_word/);
  assert.match(source, /kind} = 'revision'[\s\S]*?POINT_VALUES\.revision/);
  assert.match(source, /kind} = 'game_answer'[\s\S]*?POINT_VALUES\.game_answer/);
  assert.match(source, /kind} = 'sentence'[\s\S]*?POINT_VALUES\.sentence/);
  assert.match(source, /ELSE 0/);

  assert.match(source, /END::int`\.as\("effective_points"\)/, "the raw SQL projection must be named before Drizzle exposes it through a CTE");
  const queries = engine.slice(engine.indexOf("export function buildStandingQueries"), engine.indexOf("export async function getStanding"));
  assert.match(queries, /sum\(\$\{effectiveRows\.effectivePoints\}\)/);
  assert.match(queries, /having\(sql`sum\(\$\{effectiveRows\.effectivePoints\}\) > 0`\)/);
  assert.match(queries, /where\(eq\(users\.role, "student"\)\)/, "the documented student population is filtered in SQL");
  assert.match(queries, /orderBy\(desc\(sql`sum\(\$\{effectiveRows\.effectivePoints\}\)`\), asc\(users\.name\), asc\(effectiveRows\.userId\)\)/, "same-score order is deterministic and ranks remain ordinal");
  assert.match(engine, /leaderboardQuery\("standing_totals"/);
  assert.match(engine, /leaderboardQuery\("standing_streak_days"/);
  assert.match(engine, /leaderboardQuery\("awards_recent"/);
  const standing = engine.slice(engine.indexOf("export async function getStanding"), engine.indexOf("export function buildRecentAwardsQuery"));
  assert.match(standing, /row\.rank/);
  assert.match(standing, /points: 0,[\s\S]*?rank: 0/);
  assert.doesNotMatch(queries, /sum\(\$\{vocabPointEvents\.points\}\)/);
  assert.match(source, /PARTITION BY[\s\S]*?vocabPointEvents\.userId[\s\S]*?vocabPointEvents\.createdAt[\s\S]*?AT TIME ZONE \$\{TIMEZONE\}/);
});

test("leaderboard failures carry stable local codes and sanitized query-stage diagnostics", () => {
  assert.match(leaderboardRoute, /STANDING_ERROR_CODE = "vocabulary_standing_unavailable"/);
  assert.match(leaderboardRoute, /AWARDS_ERROR_CODE = "vocabulary_awards_unavailable"/);
  assert.match(leaderboardRoute, /safeDatabaseDiagnostic\(error\)/);
  assert.match(leaderboardRoute, /stage=\$\{queryStage\(error, fallbackStage\)\}/);
  assert.match(leaderboardRoute, /Promise\.allSettled/);
  assert.doesNotMatch(leaderboardRoute, /console\.error\([^\n]*\.message|console\.error\([^\n]*query\)/);
});

test("game award dedupe is learner + saved word + Tashkent day across game modes", () => {
  assert.match(points, /gameAnswer: \(userId: string, vocabularyId: string, tashkentDay: string\)/);
  assert.match(points, /`game:\$\{userId\}:\$\{vocabularyId\}:\$\{tashkentDay\}`/);
  assert.doesNotMatch(points, /gameAnswer:[^\n]*gameId/);
  assert.match(engine, /legacy game-answer duplicates are collapsed per learner\/entry\/day/i);
});

test("legitimate game awards refresh the private board from the authoritative ledger", () => {
  assert.match(games, /result\.awarded > 0[\s\S]*?vocab:ledger-changed/);
  assert.match(board, /requestResponse\("\/api\/vocabulary\/leaderboard", \{ cache: "no-store" \}\)/);
  assert.match(board, /addEventListener\("vocab:ledger-changed"/);
});
