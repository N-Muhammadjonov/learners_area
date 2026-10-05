import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Listening library remains in the ordinary app shell while test routes live under the focus route group", () => {
  assert.ok(existsSync(`${root}/src/app/(app)/listening/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/(focus)/listening/tests/[id]/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/(focus)/listening/tests/[id]/study/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/(focus)/listening/tests/[id]/[activity]/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/(focus)/listening/tests/[id]/mcq/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/(focus)/listening/attempts/[id]/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/(focus)/listening/attempts/[id]/revision/page.tsx`));
  assert.equal(existsSync(`${root}/src/app/(app)/listening/tests/[id]/page.tsx`), false);
  assert.equal(existsSync(`${root}/src/app/(app)/listening/attempts/[id]/page.tsx`), false);
});

test("focus layout preserves the same database-backed admission gate without mounting shell chrome", () => {
  const layout = read("src/app/(focus)/layout.tsx");
  assert.match(layout, /getCurrentUser\(\)/);
  assert.match(layout, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(layout, /redirect\("\/login"\)/);
  assert.match(layout, /redirect\("\/pending"\)/);
  assert.match(layout, /PrivateResourceScope scope=\{user\.id\}/);
  assert.doesNotMatch(layout, /<Sidebar|<Topbar|<ShellUtilities|InstantWorkspaceOutlet/);
});

test("every Listening test surface has one design-system BackLink with a safe library fallback", () => {
  const layout = read("src/app/(focus)/listening/layout.tsx");
  assert.match(layout, /data-listening-full-focus/);
  assert.match(layout, /listening-full-focus/);
  assert.match(layout, /min-h-dvh/);
  assert.match(layout, /w-full/);
  assert.match(layout, /data-listening-focus-backbar/);
  assert.match(layout, /<BackLink/);
  assert.match(layout, /fallbackHref="\/listening"/);
  assert.match(layout, /className="btn-secondary/);
});

test("moved Listening pages retain route-level auth and the correct ownership/publication checks", () => {
  for (const path of [
    "src/app/(focus)/listening/tests/[id]/page.tsx",
    "src/app/(focus)/listening/tests/[id]/study/page.tsx",
    "src/app/(focus)/listening/tests/[id]/[activity]/page.tsx",
    "src/app/(focus)/listening/tests/[id]/mcq/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /requireActiveUser\(\)/, path);
    assert.match(source, /fullListeningDetail\(/, path);
  }

  for (const path of [
    "src/app/(focus)/listening/attempts/[id]/page.tsx",
    "src/app/(focus)/listening/attempts/[id]/revision/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /requireActiveUser\(\)/, path);
    assert.match(source, /getAttemptDetail\(id, user\.id\)/, path);
  }
});

test("the full-focus hub does not re-enable the old shell Focus mechanism or shell max-width", () => {
  const page = read("src/app/(focus)/listening/tests/[id]/page.tsx");
  assert.doesNotMatch(page, /TestFocusEntry/);
  assert.doesNotMatch(page, /max-w-\[1840px\]/);
});

test("focus CSS gives authored runtime and study workspace the remaining dynamic viewport", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.listening-full-focus \{ --listening-focus-bar-h:/);
  assert.match(css, /\[data-listening-focus-content\] \{ min-height: calc\(100dvh - var\(--listening-focus-bar-h\)\)/);
  assert.match(css, /\.listening-full-focus \.listening-workspace \{ min-height: calc\(100dvh - var\(--listening-focus-bar-h\)\); border-radius: 0;/);
  assert.match(css, /\[data-authored-listening\] iframe \{ height: calc\(100dvh - var\(--listening-focus-bar-h\)\); min-height: 0;/);
});

test("the actual exam attempt and revision routes stay under the same Listening focus frame", () => {
  const attempt = read("src/app/(focus)/listening/attempts/[id]/page.tsx");
  const revision = read("src/app/(focus)/listening/attempts/[id]/revision/page.tsx");
  assert.match(attempt, /requireActiveUser\(\)/);
  assert.match(attempt, /getAttemptDetail\(id, user\.id\)/);
  assert.match(revision, /requireActiveUser\(\)/);
  assert.match(revision, /getAttemptDetail\(id, user\.id\)/);
  assert.doesNotMatch(attempt, /<BackLink/, "the shared focus frame owns the single top-left Back control");
});
