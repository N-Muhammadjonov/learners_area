import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const read = (path: string) => readFileSync(path, "utf8");

test("Day and Night use their original opaque surfaces without wallpaper or glass overrides", () => {
  const css = read("src/app/globals.css");
  const root = postcss.parse(css);
  const palettes = new Map<string, Record<string, string>>();
  root.walkRules((rule) => {
    if (![":root,\n[data-theme=\"day\"]", "[data-theme=\"night\"]"].includes(rule.selector)) return;
    const tokens: Record<string, string> = {};
    rule.walkDecls((decl) => { tokens[decl.prop] = decl.value; });
    palettes.set(rule.selector.includes("night") ? "night" : "day", tokens);
  });
  assert.equal(palettes.get("day")?.["--paper"], "251 250 254");
  assert.equal(palettes.get("day")?.["--paper-raised"], "255 255 255");
  assert.equal(palettes.get("night")?.["--paper"], "11 13 24");
  assert.equal(palettes.get("night")?.["--paper-raised"], "17 20 33");
  assert.doesNotMatch(css, /LA_(?:DAY|NIGHT)_\w*BACKGROUND|data:image\/webp|--la-surface-glass|--la-(?:day|night)-/);
  root.walkRules((rule) => {
    if (rule.selector.includes('[data-focus="on"]')) {
      rule.walkDecls((decl) => {
        assert.ok(!decl.prop.startsWith("--paper"), "Focus does not select a different surface palette");
      });
    }
  });
});

test("the server preserves theme selection without downloading removed wallpaper; Welcome is unchanged", () => {
  const root = read("src/app/layout.tsx");
  assert.match(root, /themeFromCookie/);
  assert.match(root, /data-theme=\{theme\}/);
  assert.doesNotMatch(root, /BACKGROUND_ASSETS|as="image"/);
  const intro = read("src/components/brand/DesktopIntro.tsx");
  assert.ok(intro.includes("(min-width: 1024px) and (hover: hover) and (pointer: fine)"));
  assert.ok(intro.includes("data-touch-welcome>{children}"));
});
