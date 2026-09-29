import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the private shell keeps the DB-backed account gate and does not await unread-count chrome", () => {
  const layout = read("src/app/(app)/layout.tsx");
  assert.match(layout, /Promise\.all\(\[getCurrentUser\(\), getLocale\(\)\]\)/);
  assert.match(layout, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.doesNotMatch(layout, /countUnread/);
  assert.doesNotMatch(layout, /dynamic = "force-dynamic"/);

  const bell = read("src/components/shell/NotificationBell.tsx");
  assert.match(bell, /void refresh\(\)/);
  assert.match(bell, /\/api\/notifications\?count=1/);
});

test("locale lookup is request-memoized, while Grammar's independent reads start together", () => {
  const i18n = read("src/lib/i18n/index.ts");
  assert.match(i18n, /getLocale = cache\(async/);

  const grammar = read("src/lib/data/grammar.ts");
  assert.match(grammar, /Promise\.all\(\[\s*timed\("grammar\.topics"/);
  assert.match(grammar, /timed\("grammar\.exercises"/);
  assert.match(grammar, /timed\("grammar\.attempts"/);
});
