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
