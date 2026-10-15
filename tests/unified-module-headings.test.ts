import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("one module identity in persistent topbar, not a second heading in the scrollable page", () => {
  const topbar = read("src/components/shell/Topbar.tsx");
  const shell = read("src/app/app/(shell)/layout.tsx");
  const context = read("src/components/shell/ModuleContextHeading.tsx");
  assert.match(topbar, /<ModuleContextHeading dict=\{dict\} \/>/);
  assert.doesNotMatch(shell, /<ModuleContextHeading/);
  for (const [module, path] of [
    ["listening", "/app/listening"],
    ["reading", "/app/reading"],
    ["writing", "/app/writing"],
    ["speaking", "/app/speaking"],
    ["grammar", "/app/grammar"],
    ["vocabulary", "/app/vocabulary"],
    ["video-lessons", "/app/video-lessons"],
  ]) {
    assert.ok(context.includes(`key: "${module}", path: "${path}"`), module);
  }
  assert.match(context, /if \(!activeModule\) return <Breadcrumbs dict=\{dict\} \/>/,
    "unrelated screens retain their existing navigation");
  assert.match(context, /parentFor\(pathname, dict\)/, "staff subsections retain direct-link Back navigation");
});

test("Listening section headings remain but duplicate back banner, subtitle and headline counts are gone", () => {
  for (const [suffix, key] of [
    ["lessons", "library.rows"],
    ["academic", "cards.length"],
    ["general", "cards.length"],
    ["mcq", "days.length"],
  ]) {
    const src = read(`src/app/app/(shell)/listening/${suffix}/page.tsx`);
    assert.match(src, /<h1 className="font-display text-2xl text-ink-900">\{t.title\}<\/h1>/, suffix);
    assert.doesNotMatch(src, /<BackLink|t\.subtitle|data-listening-academic-count|data-listening-general-count|data-listening-mcq-days-published|t\.targetNote/, suffix);
    assert.ok(src.includes(key), `${suffix} still shows the actual published content`);
  }
});

test("Writing, Speaking, Video and Vocabulary show section identity without repeated module title", () => {
  const writing = read("src/app/app/(shell)/writing/page.tsx");
  assert.match(writing, /<h1 className="font-display text-2xl text-ink-900">\{labels\[tab\]\}<\/h1>/);
  assert.doesNotMatch(writing, /writingWorkspace\.intro|data-writing-history-link|writingWorkspace\.title/);
  const speaking = read("src/app/app/(shell)/speaking/page.tsx");
  assert.match(speaking, /<h1 className="font-display text-2xl text-ink-900">\{dict.speakingPractice.title\}<\/h1>/);
  assert.doesNotMatch(speaking, /\{dict\.speaking\.title\}/);
  const video = read("src/app/app/(shell)/video-lessons/page.tsx");
  assert.doesNotMatch(video, /<h1|t\.intro/);
  assert.match(video, /<VideoLessonsContent/);
  const vocabulary = read("src/components/vocabulary/VocabStudio.tsx");
  assert.match(vocabulary, /<h1 className="font-display text-2xl text-ink-900">\{t.tab\[tab\]\}<\/h1>/);
  assert.doesNotMatch(vocabulary, /<h1[^>]*>\{t.title\}/);
});

test("Grammar empty content banners and author links are hidden without changing lesson and mastery reads", () => {
  const lessons = read("src/app/app/(shell)/grammar/lessons/page.tsx");
  const grammar = read("src/app/app/(shell)/grammar/page.tsx");
  assert.doesNotMatch(lessons, /data-grammar-lessons-empty|authoringPath|className="link-inline"/);
  assert.match(lessons, /listLessonLibrary/);
  assert.match(lessons, /<h1 className="page-title">\{dict.grammar.lessonsTitle\}<\/h1>/);
  assert.doesNotMatch(grammar, /<EmptyState|grammar\.emptyTitle|grammar\.emptyHint|grammar\.manageContent/);
  assert.match(grammar, /getTopicMastery/);
  assert.match(grammar, /dict\.grammar\.forWriting/);
  assert.match(grammar, /dict\.grammar\.forSpeaking/);
});

test("Night mode writing tabs and typing instruction are white, Day palette unchanged", () => {
  const css = read("src/app/globals.css");
  const nav = read("src/components/writing/workspace/WritingNav.tsx");
  const trainer = read("src/components/writing/TypingTrainer.tsx");
  assert.match(css, /\[data-theme="night"\] \[data-shell\] \[data-writing-tablist\] \[role="tab"\]/);
  assert.match(css, /\[data-theme="night"\] \[data-shell\] \.typing-footer \{/);
  assert.match(css, /color: #ffffff/);
  assert.match(nav, /dark:text-white/);
  assert.match(trainer, /phase === "ready" \? t\.typeHint/);
});
