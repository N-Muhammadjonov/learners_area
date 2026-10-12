import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVideoInput, directMediaUrls, embedUrlFor } from "../src/lib/services/video/provider";

const ORIGIN = "https://media.learners.example";

test("direct media: only the authorised https origin and /media/<id>.(mp4|webm); never without configuration", () => {
  assert.deepEqual(parseVideoInput(`${ORIGIN}/media/ted-climate_01.mp4`, { mediaOrigin: ORIGIN }), { ok: true, provider: "direct", videoId: "ted-climate_01.mp4" });
  assert.equal(parseVideoInput(`${ORIGIN}/media/ted.mp4`).ok, false, "no origin configured → not accepted");
  assert.equal(parseVideoInput(`https://evil.example/media/ted.mp4`, { mediaOrigin: ORIGIN }).ok, false);
  assert.equal(parseVideoInput(`http://media.learners.example/media/ted.mp4`, { mediaOrigin: ORIGIN }).ok, false);
  assert.equal(parseVideoInput(`${ORIGIN}/media/../secret.mp4`, { mediaOrigin: ORIGIN }).ok, false);
  assert.equal(parseVideoInput(`${ORIGIN}/media/a.mp4?x=1`, { mediaOrigin: ORIGIN }).ok, false);
  assert.equal(parseVideoInput(`${ORIGIN}/media/a.exe`, { mediaOrigin: ORIGIN }).ok, false);
  assert.deepEqual(parseVideoInput("https://youtu.be/dQw4w9WgXcQ", { mediaOrigin: ORIGIN }), { ok: true, provider: "youtube", videoId: "dQw4w9WgXcQ" });
  assert.deepEqual(directMediaUrls("a.mp4", ORIGIN), { src: `${ORIGIN}/media/a.mp4`, captions: `${ORIGIN}/media/a.vtt` });
  assert.throws(() => embedUrlFor("direct", "a.mp4"), "a direct item is never framed");
});

test("YouTube keeps its native player: no overlays, no origin='*', no app advertising or provider note", () => {
  const studio = readFileSync("src/components/courses/VideoLessonStudio.tsx", "utf8");
  assert.doesNotMatch(studio, /postMessage\([^)]*["']\*["']/);
  assert.doesNotMatch(studio, /data-video-note(?:[\s=>])|t\.providerNote|t\.playbackNote/);
  const player = readFileSync("src/components/courses/DirectMediaPlayer.tsx", "utf8");
  assert.match(player, /<track kind="captions"/);
  assert.doesNotMatch(player, /youtube\.com|<iframe/);
});

test("CSP: media-src includes the authorised media origin; connect-src includes the wss signalling origin", async () => {
  process.env.AUTHORIZED_MEDIA_ORIGIN = ORIGIN;
  process.env.LIVE_PARTNER_SIGNAL_URL = "wss://signal.learners.example/signal";
  const { buildCsp } = await import(`../src/lib/http/security-headers.ts?${Date.now()}`);
  const csp = buildCsp({ nonce: "n", secure: true, dev: false }) as string;
  assert.match(csp, /media-src [^;]*https:\/\/media\.learners\.example/);
  assert.match(csp, /connect-src [^;]*wss:\/\/signal\.learners\.example/);
  assert.doesNotMatch(csp, /connect-src [^;]*wss:(?!\/\/)/, "no blanket wss:");
});
