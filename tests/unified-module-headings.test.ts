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
    ["tests", "cards.length"],
    ["general", "cards.length"],
    ["mcq", "days.length"],
  ] as const) {
    const src = read(`src/app/app/(shell)/listening/${suffix}/page.tsx`);
    // Owner's final Listening decision: each heading is ABOVE the module tabs,
    // not after the tab strip within the body of an individual section page.
    const moduleLayout = read("src/app/app/(shell)/listening/layout.tsx");
    const sectionHeading = read("src/lib/nav/module-sections.ts");
    assert.doesNotMatch(moduleLayout, /<ListeningSectionHeading|<ModuleNavigation/);
    if (suffix !== "general") assert.ok(sectionHeading.includes(`"/app/listening/${suffix}"`), suffix);
    assert.match(read("src/components/shell/Topbar.tsx"), /<ModuleHeaderNavigation dict=\{dict\}/);
    assert.doesNotMatch(src, /<h1 className="font-display text-2xl text-ink-900">\{t.title\}<\/h1>/, suffix);
    assert.doesNotMatch(src, /<BackLink|t\.subtitle|data-listening-academic-count|data-listening-general-count|data-listening-mcq-days-published|t\.targetNote/, suffix);
    assert.ok(src.includes(key), `${suffix} still shows the actual published content`);
  }
});

test("Writing, Speaking, Video and Vocabulary show section identity without repeated module title", () => {
  const writing = read("src/app/app/(shell)/writing/page.tsx");
  assert.doesNotMatch(writing, /<h1|<WritingNav/);
  assert.match(read("src/components/shell/ModuleHeaderSections.tsx"), /<WritingNav active=/);
  assert.doesNotMatch(writing, /writingWorkspace\.intro|data-writing-history-link|writingWorkspace\.title/);
  const speaking = read("src/app/app/(shell)/speaking/page.tsx");
  assert.match(speaking, /<h1 className="font-display text-2xl text-ink-900">\{dict.speakingPractice.title\}<\/h1>/);
  assert.doesNotMatch(speaking, /\{dict\.speaking\.title\}/);
  const video = read("src/app/app/(shell)/video-lessons/page.tsx");
  assert.doesNotMatch(video, /<h1|t\.intro/);
  assert.match(video, /<VideoLessonsContent/);
  const vocabulary = read("src/components/vocabulary/VocabStudio.tsx");
  assert.doesNotMatch(vocabulary, /<h1/, "Vocabulary section identity moved into the blue fixed header at the owner's request");
  assert.match(read("src/components/shell/Topbar.tsx"), /<ModuleHeaderTitle dict=\{dict\}/);
  assert.match(read("src/components/shell/Topbar.tsx"), /<ModuleHeaderNavigation dict=\{dict\}/);
  assert.doesNotMatch(vocabulary, /<h1[^>]*>\{t.title\}/);
});

test("Grammar empty content banners and author links are hidden without changing lesson and mastery reads", () => {
  const lessons = read("src/app/app/(shell)/grammar/lessons/page.tsx");
  const grammar = read("src/app/app/(shell)/grammar/page.tsx");
  assert.doesNotMatch(lessons, /data-grammar-lessons-empty|authoringPath|className="link-inline"/);
  assert.match(lessons, /listLessonLibrary/);
  assert.doesNotMatch(lessons, /<h1/);
  assert.match(read("src/lib/nav/module-sections.ts"), /dict.grammar.lessonsTitle/);
  assert.doesNotMatch(grammar, /<EmptyState|grammar\.emptyTitle|grammar\.emptyHint|grammar\.manageContent/);
  assert.match(grammar, /getTopicMastery/);
  assert.match(read("src/lib/nav/module-sections.ts"), /dict\.grammar\.forWriting/);
  assert.match(read("src/lib/nav/module-sections.ts"), /dict\.grammar\.forSpeaking/);
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
