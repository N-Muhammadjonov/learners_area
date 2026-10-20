import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

/**
 * Part 1 interaction closure — the owner-found defects that are not Retention.
 *
 * These assertions are source-level contracts: they pin the behaviour that the
 * implementation must keep (which control exists, what it is wired to, what may
 * not happen), and they are honestly labelled as such — the pixel-level part of
 * each one still needs a browser.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");

test("Multiple Choice keeps an unmistakable verdict and then advances by itself, once", () => {
  const panel = read("src/components/vocabulary/VocabGamesPanel.tsx");
  const choice = panel.slice(panel.indexOf("const MCQ_CORRECT_HOLD_MS"), panel.indexOf("function MatchingPairs"));

  assert.match(choice, /const MCQ_CORRECT_HOLD_MS = 900/);
  assert.match(choice, /const MCQ_WRONG_HOLD_MS = 1800/, "a miss must stay readable longer than a hit");
  assert.match(choice, /advanceTimer\.current = window\.setTimeout\(advance, isRight \? MCQ_CORRECT_HOLD_MS : MCQ_WRONG_HOLD_MS\)/);
  // The verdict itself is untouched: the picked option is green, a wrong pick is red.
  assert.match(choice, /state === "right"[\s\S]*?border-band-good/);
  assert.match(choice, /state === "wrong"[\s\S]*?border-band-bad/);
  assert.match(choice, /disabled=\{picked !== null\}/, "a question accepts one answer, so it can be scored once");
  assert.match(choice, /if \(picked \|\| !current\) return;/);
  // Manual Next and the timer share one path, so neither can advance twice.
  assert.match(choice, /function advance\(\)[\s\S]*?clearTimeout\(advanceTimer\.current\)/);
  assert.match(choice, /data-mcq-next onClick=\{advance\}/);
  assert.match(choice, /void answer\(current\.id, \{ kind: "spelling", text: option \}\)/);

  // Points stay server-side and deduplicated; the client never reports a score.
  assert.doesNotMatch(choice, /awarded\s*=|correct: true|points\s*=/);
});

test("Profile exposes an explicit Edit name control in the menu and on the profile page", () => {
  const menu = read("src/components/shell/ProfileMenu.tsx");
  assert.match(menu, /href="\/app\/profile\?edit=name"/, "the menu reaches the real edit-name flow");
  assert.match(menu, /data-profile-menu-edit-name/);
  assert.match(menu, /\{dict\.profile\.editName\}/);

  const page = read("src/app/app/(shell)/profile/page.tsx");
  assert.match(page, /searchParams: Promise<\{ edit\?: string \}>/);
  assert.match(page, /const editName = \(await searchParams\)\?\.edit === "name"/);
  assert.match(page, /<ProfileNameEditor dict=\{dict\} initialName=\{user\.name\} initiallyEditing=\{editName\} \/>/);

  const editor = read("src/components/profile/ProfileNameForm.tsx");
  assert.match(editor, /export function ProfileNameEditor/);
  assert.match(editor, /data-profile-edit-name/);
  assert.match(editor, /aria-expanded=\{editing\}/);
  assert.match(editor, /aria-controls="profile-name-form"/);
  assert.match(editor, /data-profile-current-name/);
  assert.match(editor, /\{editing \? dict\.common\.cancel : dict\.profile\.editName\}/);
  // The form is revealed, not duplicated: one PATCH /api/profile contract.
  assert.match(editor, /const result = await requestJson<\{ name: string \}>\("\/api\/profile"/);
  assert.equal(editor.match(/data-profile-name-form/g)?.length, 1);

  assert.equal(en.profile.editName, "Edit name");
  assert.equal(uz.profile.editName, "Ismni tahrirlash");
  assert.equal(en.nav.videoLessons, "TED / PODCAST");
});

test("the utility stack is collapsed behind one launcher in both locales", () => {
  const shell = read("src/components/shell/ShellUtilities.tsx");
  assert.match(shell, /const \[open, setOpen\] = useState\(false\)/, "the stack starts collapsed");
  assert.match(shell, /data-utilities-launcher/);
  assert.match(shell, /aria-expanded=\{open\}/);
  assert.match(shell, /aria-controls="shell-utilities-panel"/);
  assert.match(shell, /\{open && \(/, "the controls render only when the launcher is opened");
  assert.match(shell, /data-shell-utilities-panel/);
  // Escape closes the stack, and it is registered independently of Focus.
  assert.match(shell, /function onEscape\(event: KeyboardEvent\) \{\s*if \(event\.key === "Escape"\) setOpen\(false\)/);
  // The learner can always see that Focus is on and always reach the exit.
  assert.match(shell, /\{on && \([\s\S]*?dict\.focus\.onLabel/);
  assert.match(shell, /data-focus-toggle/);
  assert.equal(en.shell.utilities, "Study tools");
  assert.equal(uz.shell.utilities, "O'quv vositalari");
});

test("the Reading hub keeps Reading concepts only", () => {
  const page = read("src/app/app/(shell)/reading/page.tsx");
  const destinations=read("src/lib/reading/destinations.ts");
  assert.match(destinations,/READING_DESTINATIONS = \["lessons", "academic", "general", "retention"\]/);
  assert.match(read("src/lib/nav/module-sections.ts"), /READING_DESTINATIONS.map/);
  assert.match(read("src/components/shell/Topbar.tsx"), /<ModuleHeaderNavigation dict=\{dict\}/);
  assert.doesNotMatch(read("src/app/app/(shell)/reading/layout.tsx"), /<ModuleNavigation/);
  // A comment records why the tab left; no code may reintroduce it.
  assert.doesNotMatch(code(page), /video/i);
  assert.doesNotMatch(code(page), /data-reading-videos/);
  // TED / PODCAST stays a standalone section with its own navigation entry.
  const shell = read("src/components/shell/SidebarNav.tsx");
  assert.match(shell, /\/video-lessons/);
});
