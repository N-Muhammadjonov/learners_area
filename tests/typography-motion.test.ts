import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");
const fonts = readFileSync("src/lib/ui/fonts.ts", "utf8");

test("T1 Geist Sans is the preloaded body/UI face and Sora the heading face", () => {
  assert.match(fonts, /const ui = localFont\(\{ src: "\.\.\/\.\.\/fonts\/geist-latin-wght-normal\.woff2"[^\n]*variable: "--font-ui", preload: true/);
  assert.match(fonts, /const heading = localFont\(\{ src: "\.\.\/\.\.\/fonts\/sora-latin-wght-normal\.woff2"[^\n]*variable: "--font-heading"/);
  assert.match(css, /--font-sans: var\(--font-ui\)/);
  assert.match(css, /--font-display: var\(--font-heading\)/);
});

test("T2 readable body: 16px, weight 450–500, line-height 1.5–1.7; headings 600–700", () => {
  const body = /body \{[^}]*\}/.exec(css.slice(css.indexOf("@layer base")))![0];
  assert.match(body, /font-size: 1rem/);
  const weight = Number(/font-weight: (\d+)/.exec(body)![1]);
  assert.ok(weight >= 450 && weight <= 500, String(weight));
  const lh = Number(/line-height: ([\d.]+)/.exec(body)![1]);
  assert.ok(lh >= 1.5 && lh <= 1.7, String(lh));
  const h = Number(/h1, h2, h3 \{ font-family: var\(--font-display\); font-weight: (\d+)/.exec(css)![1]);
  assert.ok(h >= 600 && h <= 700);
  assert.match(css, /\.academic-text \{ font-family: var\(--font-ui\)[^}]*line-height: 1\.7/);
});

test("T3 motion is transform/opacity only and fully disabled under reduced motion", () => {
  const block = css.slice(css.indexOf("/* Motion system (§9)"));
  for (const kf of block.matchAll(/@keyframes [\w-]+ \{([^@]*?)\}\s*\}/g)) assert.doesNotMatch(kf[1]!, /width|height|top|left|margin|padding/);
  assert.match(block, /prefers-reduced-motion: reduce\) \{ \.motion-enter, \.motion-enter-stagger > \*, \.motion-tab-panel \{ animation: none; \}/);
  for (const [name, lo, hi] of [["hover", 120, 180], ["press", 80, 140], ["tab", 160, 240], ["enter", 220, 360], ["panel", 180, 280], ["success", 250, 450]] as const) {
    const ms = Number(new RegExp(`--motion-${name}: (\\d+)ms`).exec(block)![1]);
    assert.ok(ms >= lo && ms <= hi, `${name} ${ms}`);
  }
});
