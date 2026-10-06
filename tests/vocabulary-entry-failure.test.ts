import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("Vocabulary route performs only server identity/locale work before the client frame", () => {
  const page = read("src/app/app/(shell)/vocabulary/page.tsx");
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\), searchParams\]\)/);
  assert.doesNotMatch(page, /listLibrary|listDue|listFolders|getStanding|listSentenceBank/);
  assert.match(studio, /if \(tab === "words"\)[\s\S]*?void loadLibrary\(\)[\s\S]*?void loadSummary\(\)[\s\S]*?void loadFolders\(\)/);
  assert.match(studio, /else if \(tab === "revision"\)[\s\S]*?void loadDue\(\)/);
  const tabEffect = studio.slice(studio.indexOf("useEffect(() => {"), studio.indexOf("const refreshWords"));
  const tabEffectBody = tabEffect.slice(0, tabEffect.indexOf("}, [tab"));
  const wordsBranch = tabEffectBody.slice(tabEffectBody.indexOf('if (tab === "words")'), tabEffectBody.indexOf('else if (tab === "revision")'));
  const revisionBranch = tabEffectBody.slice(tabEffectBody.indexOf('else if (tab === "revision")'));
  assert.doesNotMatch(wordsBranch, /loadDue/);
  assert.doesNotMatch(revisionBranch, /loadLibrary|loadFolders/);
});

test("the core library is authenticated, paginated, and converts query failures into a local region state", () => {
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  const libraryApi = read("src/app/api/vocabulary/route.ts");
  assert.match(studio, /LIBRARY_PAGE_SIZE = 50/);
  assert.match(studio, /libraryStatus === "error"[\s\S]*?loadLibrary\(true\)/);
  assert.match(studio, /data-vocabulary-core="library"/);
  assert.match(libraryApi, /requireActiveUser\(\)/);
  assert.match(libraryApi, /listLibrary\(user\.id, \{ limit: limit \+ 1, offset \}\)/);
  assert.match(libraryApi, /status: 503/);
  assert.match(libraryApi, /Cache-Control.*private, no-store/);
  assert.doesNotMatch(libraryApi, /listLibrary\(user\.id\)\s*;/);
  const engine = read("src/lib/services/vocabulary/engine.ts");
  const librarySelection = engine.slice(engine.indexOf("const librarySelection"), engine.indexOf("export async function listLibrary"));
  assert.match(librarySelection, /entry: \{/);
  assert.match(librarySelection, /lexeme: \{/);
  assert.match(librarySelection, /acceptedTranslations: lexemes\.acceptedTranslations/);
  assert.match(librarySelection, /sourceSnapshot: userVocabulary\.sourceSnapshot/);
  assert.match(engine.slice(engine.indexOf("export async function listLibrary"), engine.indexOf("export async function listDue")), /\.select\(librarySelection\)/);
  assert.match(engine.slice(engine.indexOf("export async function listDue"), engine.indexOf("/** Search the student's own library")), /\.select\(librarySelection\)/);
});

test("each optional Vocabulary API independently authorizes, catches query failures, and disables caching", () => {
  for (const path of [
    "src/app/api/vocabulary/summary/route.ts",
    "src/app/api/vocabulary/folders/route.ts",
    "src/app/api/vocabulary/due/route.ts",
    "src/app/api/vocabulary/sentences/route.ts",
    "src/app/api/vocabulary/leaderboard/route.ts",
  ]) {
    const route = read(path);
    assert.match(route, /requireActiveUser\(\)/, `${path} must authorize on the server`);
    assert.match(route, /status: 503/, `${path} must isolate failed data as a region response`);
    assert.match(route, /Cache-Control.*private, no-store/);
  }
});

test("Vocabulary panels retain independent loading, error and retry scopes", () => {
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  const words = read("src/components/vocabulary/VocabWordsPanel.tsx");
  const use = read("src/components/vocabulary/VocabUsePanel.tsx");
  const board = read("src/components/vocabulary/VocabBoardPanel.tsx");
  assert.match(studio, /data-vocabulary-core="library"/);
  assert.match(studio, /data-region-retry/);
  assert.match(words, /data-vocabulary-secondary="summary"/);
  assert.match(words, /data-vocabulary-secondary="folders"/);
  assert.match(words, /data-library-load-more/);
  assert.match(use, /data-region-retry="sentence-history"|data-region-retry=\{name\}/);
  assert.match(use, /loadSentences\(\)/);
  assert.match(use, /loadWords\(\)/);
  assert.match(board, /data-region-retry="leaderboard"/);
  assert.match(board, /requestResponse\("\/api\/vocabulary\/leaderboard\?view=standing", \{ cache: "no-store" \}\)/);
  assert.match(board, /data-vocabulary-region-error="award-history"/);
  assert.match(board, /refreshAwards\(\)/);
  assert.match(board, /requestAwards\("\/api\/vocabulary\/leaderboard\?view=awards", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(board, /standing\?: VocabStanding/);
  const leaderboard = read("src/app/api/vocabulary/leaderboard/route.ts");
  assert.match(leaderboard, /Promise\.allSettled/);
  assert.match(leaderboard, /view === "awards"/);
  assert.match(leaderboard, /view === "standing"/);
  assert.match(leaderboard, /awardsUnavailable: awardsResult\.status === "rejected"/);
  assert.match(leaderboard, /PRIVATE_NO_STORE/);
});

test("summary reads aggregate rather than loading the 500-row default library, preserving zero and all-source counts", () => {
  const engine = read("src/lib/services/vocabulary/engine.ts");
  const summary = engine.slice(engine.indexOf("export async function librarySummary"), engine.indexOf("\n}\n", engine.indexOf("export async function librarySummary")));
  assert.match(summary, /count\(\*\)/);
  assert.match(summary, /groupBy\(userVocabulary\.mastery, userVocabulary\.sourceType\)/);
  assert.match(summary, /const byMastery: Record<string, number> = \{ new: 0/);
  assert.match(summary, /const bySource: Record<string, number> = \{\}/);
  assert.doesNotMatch(summary, /listLibrary\(/);
});

test("historical nullable vocabulary fields and legacy ledger entries remain explicit and safe", () => {
  const types = read("src/components/vocabulary/types.ts");
  const words = read("src/components/vocabulary/VocabWordsPanel.tsx");
  const engine = read("src/lib/services/vocabulary/engine.ts");
  assert.match(types, /translationUz: string \| null/);
  assert.match(types, /evaluationId: string \| null/);
  assert.match(types, /sourceSnapshot\?:[\s\S]*\| null/);
  assert.match(words, /word\.sourceSnapshot &&/);
  assert.match(words, /word\.translationUz &&/);
  assert.match(engine, /evaluationId: vocabularyUsages\.evaluationId/);
  assert.match(engine, /function buildEffectivePointRows\(\)/);
  assert.match(engine, /row_number\(\) OVER/);
  assert.match(engine, /PARTITION BY[\s\S]*?vocabPointEvents\.userId[\s\S]*?vocabPointEvents\.createdAt/);
});
