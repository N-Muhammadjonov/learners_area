import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("W18: Retention copy states the real 2-minute read, 3-minute recall and 100-point score", () => {
  for (const path of ["src/lib/i18n/en.ts", "src/lib/i18n/uz.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /four minutes|4 daqiqa|to'rt daqiqa/);
    assert.match(source, /2 (minutes|daqiqa)/);
    assert.match(source, /3 (minutes|daqiqada)/);
    assert.match(source, /100/);
  }
});

test("W14: the utility stack collapses on an outside pointer press but not on inside presses", () => {
  const source = read("src/components/shell/ShellUtilities.tsx");
  assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(source, /container\.contains\(event\.target as Node\)\) return/);
  assert.match(source, /removeEventListener\("pointerdown"/);
  assert.match(source, /if \(hadFocus\) launcherRef\.current\?\.focus\(\)/);
});

test("W09: the durable result route is owner-scoped, terminal-only and learner-safe", () => {
  const page = read("src/app/(app)/reading/retention/results/[attemptId]/page.tsx");
  assert.match(page, /requireActiveUser\(\)/);
  assert.match(page, /findAttemptForUser\(\{ attemptId, userId: user\.id \}\)/);
  assert.match(page, /assertLearnerSafe\(built\)/);
  assert.match(page, /redirect\("\/reading\/retention"\)/);
  const history = read("src/components/reading/RetentionHistory.tsx");
  assert.match(history, /\/reading\/retention\/results\/\$\{row\.attemptId\}`\} prefetch=\{false\}/);
  assert.doesNotMatch(history, /slice\(0, 10\)/);
});

test("W09: recall, payload and history all use the shared countWords", () => {
  for (const path of ["src/components/reading/RetentionSession.tsx", "src/lib/retention/payload.ts", "src/lib/data/retention-attempts.ts"]) {
    const source = read(path);
    assert.match(source, /countWords\(/, path);
    assert.doesNotMatch(source, /split\(\/\\s\+\/u\)/, path);
  }
});
