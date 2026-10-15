import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { convertLegacyPackage } from "../src/lib/listening/source-parser";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = "content/listening/academic/test-01/";

test("owner Listening Test 1 source lives only in non-public GitHub content; MP3 stays in private R2", () => {
  const html = read(home + "source.html");
  const raw = JSON.parse(read(home + "data.json"));
  const manifest = JSON.parse(read(home + "manifest.json"));
  assert.equal(raw.test_id, "listening-test-1");
  assert.equal(Object.keys(raw.questions).length, 40);
  assert.equal(Object.keys(raw.part_audio_boundaries).length, 4);
  assert.match(html, /const DATA=/);
  assert.match(html, /const PARTS=/);
  assert.match(html, /const TRANSCRIPTS=/);
  assert.doesNotMatch(html, /data:audio\/(?:mpeg|mp3);base64,/);
  assert.match(html, /src="audio\/full\.mp3"/);
  assert.equal(manifest.audio.objectKey, "listening/academic/test-01/full.mp3");
  assert.equal(manifest.audio.bytes, 16450918);
  assert.equal(manifest.audio.sha256, "c8d072e719dd00f53df9cc8fa916f35343d21ddffb0336c768e2a3f33aa1b34f");
  assert.equal(manifest.deployment.status, "waiting_for_r2_upload_and_safe_database_activation");
});

test("owner's real Test 1 converts to 4-part 40-question native Listening data without rewriting authored answers", () => {
  const html = read(home + "source.html");
  const parsed = convertLegacyPackage(
    { "source.html": html }, 1645.061224,
    source => new JSDOM(source).window.document,
    { audioPath: "listening/academic/test-01/full.mp3" },
  );
  assert.equal(parsed.testId, "listening-test-1");
  assert.equal(parsed.questions.length, 40);
  assert.equal(parsed.sections.length, 4);
  assert.equal(parsed.sections.filter(s => s.transcript.trim().length > 0).length, 4);
  assert.equal(parsed.audio.path, "listening/academic/test-01/full.mp3");
  for (const q of parsed.questions) assert.ok(q.key.length > 0, `Q${q.number} cannot lose its answer`);
  const paired = parsed.questions.filter(q => q.pair.length > 0);
  for (const q of paired) {
    assert.equal(q.options.length, 5, `Choose TWO Q${q.number} must keep A-E`);
    assert.deepEqual(parsed.questions[q.pair[0]! - 1]!.pair, [q.number]);
  }
});

test("admin DELETE genuinely removes unused Listening tests; never destroys attempt or MCQ history", () => {
  const api = read("src/app/api/admin/listening/tests/[id]/route.ts");
  const admin = read("src/lib/data/full-listening.ts");
  assert.match(api, /await requireAdministrator\(\)/);
  assert.match(api, /eq\(listeningAttempts\.testId, id\)/);
  assert.match(api, /eq\(listeningActivityRuns\.testId, id\)/);
  assert.match(api, /eq\(listeningMcqSessions\.testId, id\)/);
  assert.match(api, /has_learner_history/);
  assert.match(api, /await tx\.delete\(listeningTests\)/);
  assert.match(admin, /where\(management \? sql`true` : liveWhere\(listeningTests\)\)/);
});

test("main, authenticated and login Learners Area wordmarks open the requested Telegram channel", () => {
  for (const path of ["src/app/page.tsx", "src/components/shell/Sidebar.tsx", "src/components/auth/AuthShell.tsx"]) {
    const src = read(path);
    assert.match(src, /https:\/\/t\.me\/learners_area/, path);
    assert.match(src, /rel="noopener noreferrer"/, path);
    assert.match(src, /target="_blank"/, path);
  }
});
