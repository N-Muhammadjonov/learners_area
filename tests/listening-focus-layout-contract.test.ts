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
  assert.equal(existsSync(`${root}/src/app/(app)/listening/tests/[id]/page.tsx`), false);
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
  const layout = read("src/app/(focus)/listening/tests/[id]/layout.tsx");
  assert.match(layout, /data-listening-full-focus/);
  assert.match(layout, /min-h-dvh/);
  assert.match(layout, /w-full/);
  assert.match(layout, /data-listening-focus-backbar/);
  assert.match(layout, /<BackLink/);
  assert.match(layout, /fallbackHref="\/listening"/);
  assert.match(layout, /className="btn-secondary/);
});

test("moved Listening pages retain route-level auth and publication/detail checks", () => {
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
});

test("the full-focus hub does not re-enable the old shell Focus mechanism or shell max-width", () => {
  const page = read("src/app/(focus)/listening/tests/[id]/page.tsx");
  assert.doesNotMatch(page, /TestFocusEntry/);
  assert.doesNotMatch(page, /max-w-\[1840px\]/);
});
