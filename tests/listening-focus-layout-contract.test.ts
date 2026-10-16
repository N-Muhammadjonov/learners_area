import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Listening library remains in the ordinary app shell while test routes live under the focus route group", () => {
  assert.ok(existsSync(`${root}/src/app/app/(shell)/listening/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/app/(focus)/listening/tests/[id]/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/app/(focus)/listening/tests/[id]/study/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/app/(focus)/listening/tests/[id]/mcq/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/app/(focus)/listening/attempts/[id]/page.tsx`));
  assert.ok(existsSync(`${root}/src/app/app/(focus)/listening/attempts/[id]/revision/page.tsx`));
  assert.equal(existsSync(`${root}/src/app/app/(shell)/listening/tests/[id]/page.tsx`), false);
  assert.equal(existsSync(`${root}/src/app/app/(shell)/listening/attempts/[id]/page.tsx`), false);
});

test("the namespace gate covers the focus group, and the focus layout mounts no shell chrome", () => {
  // The admission gate moved one level up, to the /app namespace layout, so it now
  // covers the shell group AND the focus group with ONE database-backed check
  // (`getCurrentUser` is React-cached, so this is still one query per request).
  const gate = read("src/app/app/layout.tsx");
  assert.match(gate, /getCurrentUser\(\)/);
  assert.match(gate, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(gate, /redirect\("\/login"\)/);
  assert.match(gate, /redirect\("\/pending"\)/);
  assert.match(gate, /PrivateResourceScope scope=\{user\.id\}/);
  // Focus routes are siblings of the ordinary shell group — not children of it.
  assert.ok(existsSync(`${root}/src/app/app/(focus)/layout.tsx`));
  const layout = read("src/app/app/(focus)/layout.tsx");
  assert.match(layout, /getCurrentUser\(\)/);
  assert.doesNotMatch(layout, /<Sidebar|<Topbar|<ShellUtilities|InstantWorkspaceOutlet|<InstantInteractionProvider/);
});

test("the Listening hub has a design-system BackLink; authored activities hide that bar and own their Activities control", () => {
  const layout = read("src/app/app/(focus)/listening/layout.tsx");
  assert.match(layout, /data-listening-full-focus/);
  assert.match(layout, /listening-full-focus/);
  assert.match(layout, /min-h-dvh/);
  assert.match(layout, /w-full/);
  assert.match(layout, /data-listening-focus-backbar/);
  assert.match(layout, /<BackLink/);
  assert.match(layout, /fallbackHref="\/app\/listening"/);
  assert.match(layout, /className="btn-secondary/);
  const css=read("src/app/globals.css");
  assert.ok(css.includes(':has([data-authored-listening][data-activity-active="true"]) [data-listening-focus-backbar] { display: none; }'));
});

test("moved Listening pages retain route-level auth and the correct ownership/publication checks", () => {
  for (const path of [
    "src/app/app/(focus)/listening/tests/[id]/page.tsx",
    "src/app/app/(focus)/listening/tests/[id]/study/page.tsx",
    "src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx",
    "src/app/app/(focus)/listening/tests/[id]/mcq/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /requireActiveUser\(\)/, path);
    assert.match(source, /fullListeningDetail\(/, path);
  }

  for (const path of [
    "src/app/app/(focus)/listening/attempts/[id]/page.tsx",
    "src/app/app/(focus)/listening/attempts/[id]/revision/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /requireActiveUser\(\)/, path);
    assert.match(source, /getAttemptDetail\(id, user\.id\)/, path);
  }
});

test("the full-focus hub does not re-enable the old shell Focus mechanism or shell max-width", () => {
  const page = read("src/app/app/(focus)/listening/tests/[id]/page.tsx");
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
  const attempt = read("src/app/app/(focus)/listening/attempts/[id]/page.tsx");
  const revision = read("src/app/app/(focus)/listening/attempts/[id]/revision/page.tsx");
  assert.match(attempt, /requireActiveUser\(\)/);
  assert.match(attempt, /getAttemptDetail\(id, user\.id\)/);
  assert.match(revision, /requireActiveUser\(\)/);
  assert.match(revision, /getAttemptDetail\(id, user\.id\)/);
  assert.doesNotMatch(attempt, /<BackLink/, "the shared focus frame owns the single top-left Back control");
});
