import assert from "node:assert/strict";
import test from "node:test";
import { describeParseFailure, embedUrlFor, parseVideoInput, watchUrlFor } from "@/lib/services/video/provider";
import { buildCsp } from "@/lib/http/security-headers";

test("a normal YouTube link becomes a validated provider reference", () => {
  const cases = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
  ];
  for (const input of cases) {
    const parsed = parseVideoInput(input);
    assert.equal(parsed.ok, true, `${input} should parse`);
    if (parsed.ok) {
      assert.equal(parsed.provider, "youtube");
      assert.equal(parsed.videoId, "dQw4w9WgXcQ");
    }
  }
});

test("a placeholder or malformed id is refused instead of embedded", () => {
  // This is the shape the demo seed used to ship: a video id that never existed.
  assert.deepEqual(parseVideoInput("https://www.youtube.com/watch?v=PLACEHOLDER1"), {
    ok: false,
    reason: "invalid_id",
  });
  assert.equal(parseVideoInput("https://www.youtube.com/watch?v=").ok, false);
  assert.equal(parseVideoInput("https://www.youtube.com/").ok, false);
  assert.equal(parseVideoInput("not a url at all !").ok, false);
  assert.equal(parseVideoInput("").ok, false);
});

test("another host is reported as unsupported, never silently framed", () => {
  assert.deepEqual(parseVideoInput("https://vimeo.com/12345678"), { ok: false, reason: "unsupported_host" });
  assert.deepEqual(parseVideoInput("https://player.vimeo.com/video/12345678"), {
    ok: false,
    reason: "unsupported_host",
  });
  // A javascript: URL is not a video, and it is refused as a URL rather than
  // being passed through to an href anywhere.
  assert.equal(parseVideoInput("javascript:alert(1)").ok, false);
  assert.match(describeParseFailure("unsupported_host"), /YouTube/);
});

test("the embed url is privacy enhanced and carries no arbitrary parameters", () => {
  const url = embedUrlFor("youtube", "dQw4w9WgXcQ", { origin: "https://learnersarea.uz" });
  assert.match(url, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("rel"), "0", "no suggestion feed");
  assert.equal(params.get("playsinline"), "1");
  assert.equal(params.get("origin"), "https://learnersarea.uz");
  assert.throws(() => embedUrlFor("youtube", "short"), /invalid video id/);
});

test("the honest fallback link points at the provider, not at an embed", () => {
  assert.equal(watchUrlFor("youtube", "dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("the policy allows exactly the providers the parser accepts", () => {
  const csp = buildCsp({ nonce: "n", secure: true, dev: false, host: "learnersarea.uz" });
  const frameSrc = csp.split(";").find((directive) => directive.trim().startsWith("frame-src")) ?? "";
  assert.match(frameSrc, /youtube-nocookie\.com/);
  assert.ok(!frameSrc.includes("vimeo"), "an unsupported host must not be framed");
  assert.ok(!frameSrc.includes("*"), "framing is a named list, never a wildcard");
});

test("no user-supplied HTML can reach the player component", async () => {
  const { readFileSync } = await import("node:fs");
  const studio = readFileSync("src/components/courses/VideoLessonStudio.tsx", "utf8");
  // The iframe src is always built from the stored provider reference…
  assert.match(studio, /embedUrlFor\(/);
  // …and no component renders a transcript value with dangerouslySetInnerHTML.
  assert.ok(!studio.includes("dangerouslySetInnerHTML"), "authored text is rendered as text");
});
