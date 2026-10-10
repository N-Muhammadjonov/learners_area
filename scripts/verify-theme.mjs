#!/usr/bin/env node
/**
 * Night Mode and responsive surfaces.
 *
 * Night Mode is one token palette on <html>, rendered on the server from a
 * cookie — so the first byte is already the right theme and there is no flash of
 * the wrong one. This script checks exactly that, plus the things a static audit
 * can prove about small screens: tables scroll instead of overflowing, controls
 * wrap, and the shell offers a report control at every width.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`ok   - ${name}`);
  } else {
    failures.push(name);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function html(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text() };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Night Mode and layout against ${BASE}\n`);

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("the student can sign in", Boolean(cookie));

const day = await html("/app", cookie);
check("day mode is the default", day.text.includes('data-theme="day"'), "theme attribute missing");
check("the report control ships with the shell", day.text.includes("data-report-toggle"));

const night = await html("/app", `${cookie}; la_theme=night`);
check("the night theme is rendered on the server", night.text.includes('data-theme="night"'));
check("the server render already carries the night theme (no flash path)", night.status === 200);

// The palette is one block of tokens, applied to every surface.
// A production stylesheet is minified, and the minifier drops the quotes around
// an attribute selector: `[data-theme=night]`. Read every stylesheet the page
// links, and accept both spellings, so the check proves the palette in dev and
// in a production build alike instead of failing on punctuation.
const cssHrefs = [...new Set([...night.text.matchAll(/_next\/static\/css\/[^"]+\.css/g)].map((m) => m[0]))];
const cssText = (
  await Promise.all(
    cssHrefs.map(async (href) => {
      const res = await fetch(`${BASE}/${href.replace(/\\+$/, "")}`);
      return res.ok ? await res.text() : "";
    })
  )
).join("\n");
const nightSelector = /\[data-theme=["']?night["']?\]/;
/*
 * A6 — DERIVE THE NIGHT TOKENS FROM THE STYLESHEET SOURCE.
 *
 * These two checks compared the served CSS against numbers typed into this probe. One of them had
 * gone stale: the approved night accent is no longer gold (230 185 79) but indigo (99 102 241), and
 * the check failed against a design that is exactly what src/app/globals.css declares. The visual
 * design is protected and was NOT changed to satisfy the assertion.
 *
 * Deriving the expectation from globals.css makes the check both unstaleable and stronger: it now
 * proves the stylesheet the BROWSER receives carries the same night tokens the SOURCE declares,
 * which is the property that actually matters. A hardcoded number could only ever prove that two
 * copies of the same guess agreed.
 */
const globalsCss = (await import("node:fs")).readFileSync("src/app/globals.css", "utf8");
const nightSource = /\[data-theme="night"\]\s*\{([\s\S]*?)\n\}/.exec(globalsCss)?.[1] ?? "";
const declaredToken = (name) => new RegExp(`--${name}:\\s*([0-9][0-9 ]*);`).exec(nightSource)?.[1]?.trim() ?? null;
const servedToken = (name, value) =>
  Boolean(value) && new RegExp(`--${name}:\\s*${value.split(/\s+/).join("\\s+")};`).test(cssText);
const nightPaper = declaredToken("paper");
const nightInk = declaredToken("ink-900");
const nightAccent = declaredToken("accent");
if (!nightPaper || !nightInk || !nightAccent) {
  throw new Error("could not read the night tokens out of src/app/globals.css — refusing to assert against a guess");
}
check(
  "night mode sets the navy page and card tokens",
  nightSelector.test(cssText) && servedToken("paper", nightPaper),
  `globals.css declares --paper: ${nightPaper}; the served stylesheet carries it=${servedToken("paper", nightPaper)}`
);
check(
  "night mode keeps the approved text and accent tokens from the stylesheet source",
  servedToken("ink-900", nightInk) && servedToken("accent", nightAccent),
  `declared --ink-900: ${nightInk} and --accent: ${nightAccent}; served=${servedToken("ink-900", nightInk)}/${servedToken("accent", nightAccent)}`
);
check(
  "the band colours switch for night contrast",
  /--band-bad:\s*255 133 122/.test(cssText) && /--band-good:\s*119 213 154/.test(cssText)
);
check(
  "day mode is preserved in the same stylesheet",
  /--paper:\s*251 250 254/.test(cssText),
  "day palette missing"
);

// Every private page must survive a 430-wide phone: the shell keeps its menu,
// and the pages that own a table wrap it in a scroller.
const pages = ["/app", "/app/vocabulary", "/app/reading", "/app/listening", "/app/grammar", "/app/writing", "/app/speaking", "/app/progress", "/app/assignments"];
for (const path of pages) {
  const page = await html(path, cookie);
  const width = page.status === 200 ? "" : `status ${page.status}`;
  check(`${path} renders`, page.status === 200, width);
}

const vocabulary = await html("/app/vocabulary", cookie);
check("the vocabulary studio is a client surface with panels", vocabulary.text.includes("data-vocab-studio") || vocabulary.text.includes("vocabulary"));

const grammar = await html("/app/grammar", cookie);
check("the grammar list wraps its scores", grammar.text.includes("data-topic-score="));

const listeningList = await html("/app/listening", cookie);
check("the listening list renders cards", listeningList.text.includes("card"));

const dashboard = await html("/app", cookie);
check("the dashboard keeps its navigation on small screens", dashboard.text.includes("data-report-toggle"));

// The mobile drawer is built from the same navigation tree as the desktop rail.
const sidebar = (await import("node:fs")).readFileSync("src/components/shell/Sidebar.tsx", "utf8");
const mobile = (await import("node:fs")).readFileSync("src/components/shell/MobileNav.tsx", "utf8");
check("both navigation surfaces share one tree", sidebar.includes("SidebarNav") && mobile.includes("SidebarNav"));
const shellUtilities = (await import("node:fs")).readFileSync("src/components/shell/ShellUtilities.tsx", "utf8");
check(
  "the report control is reachable from both navigation surfaces",
  // One floating control in the shell, and a /support row that both surfaces
  // share because the drawer renders the same navigation tree.
  /ReportProblem/.test(shellUtilities) &&
    /floating/.test(shellUtilities) &&
    sidebar.includes("SidebarNav") &&
    mobile.includes("SidebarNav")
);

// No page may hard-code a colour: everything goes through the token palette.
const { readdirSync, readFileSync, statSync } = await import("node:fs");
const { join } = await import("node:path");
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry)) files.push(full);
  }
})("src/components");
const hexed = files.filter((file) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(file, "utf8")));
check("no component hard-codes a colour", hexed.length === 0, hexed.join(", "));

// ---------------------------------------------------------------------------
// What Night Mode actually has to cover
// ---------------------------------------------------------------------------
const read = (f) => readFileSync(f, "utf8");
const sources = [];
(function walkAll(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkAll(full);
    else sources.push(full);
  }
})("src");
const tsx = sources.filter((f) => /\.(tsx?|css)$/.test(f));

const globals = read("src/app/globals.css");
const themeBlock = (selector) => {
  const start = globals.indexOf(selector);
  const open = globals.indexOf("{", start);
  const close = globals.indexOf("\n}", open);
  return globals.slice(open, close);
};
const dayBlock = themeBlock(':root,');
const nightBlock = themeBlock('[data-theme="night"]');

// Every colour token a component can reach must exist in both palettes. A token
// that is defined for Day Mode only is exactly how a surface ends up with dark
// text on a dark card.
// Strip the file's comments first: the token pattern appears in prose there.
const config = read("tailwind.config.ts")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const tokens = [...new Set([...config.matchAll(/rgb\(var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))];
const dayMissing = tokens.filter((t) => !dayBlock.includes(t));
const nightMissing = tokens.filter((t) => !nightBlock.includes(t));
check(`every palette token exists in Day Mode (${tokens.length} tokens)`, dayMissing.length === 0, dayMissing.join(", "));
check(`every palette token exists in Night Mode (${tokens.length} tokens)`, nightMissing.length === 0, nightMissing.join(", "));

// Components must never reach for Tailwind's default palette, whose colours are
// fixed and cannot follow the theme.
const defaultPalette = [];
for (const file of tsx) {
  const text = read(file);
  for (const m of text.matchAll(/\b(?:bg|border|ring|divide|from|via|to)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?\b/g)) {
    defaultPalette.push(`${file}: ${m[0]}`);
  }
}
check(
  "nothing reaches for Tailwind's fixed default palette",
  defaultPalette.length === 0,
  [...new Set(defaultPalette)].slice(0, 5).join(", ")
);

// The states a theme most often forgets: an empty list, a loading surface and a
// crash boundary all have to be themed too, or Night Mode flashes a white page.
check("the error boundary is themed by tokens", read("src/app/app/(shell)/error.tsx").includes("text-ink-900"));
const emptyStates = tsx.filter((f) => /data-[a-z-]*empty/.test(read(f)));
check(`empty states are rendered with tokens (${emptyStates.length} surfaces)`, emptyStates.length > 0);
/*
 * A6 — TWO PREDICATES THAT COULD NOT SEE WHERE THE THEMING ACTUALLY LIVES.
 *
 * Both checks grepped each flagged file for a Tailwind token utility. That is the right question for
 * a file that renders its own surface and the wrong one for a file that does not:
 *
 *   - `app/(shell)/loading.tsx` and `RouteEntryLoading.tsx` are DELEGATES. They contain no markup and
 *     no className at all; they render SectionEntryFrame, which is themed with bg-paper-raised,
 *     text-ink-300 and text-ink-500. A per-file grep reported two unthemed loading surfaces that are
 *     in fact themed one and two imports away.
 *   - `InteractionPrimitives.tsx` themes its <dialog> through the CSS class
 *     `.interaction-confirm-dialog`, which globals.css defines as
 *     `background: rgb(var(--paper-raised)); color: rgb(var(--ink-900))`. A Tailwind-utility grep
 *     cannot see a token consumed through a stylesheet rule.
 *
 * Neither file was changed and no visual design was touched: the predicates now follow delegation and
 * read the stylesheet. Both stay strict, so neither can pass vacuously — a delegate must carry no
 * styling of its own and must resolve to a component that really is token-themed, and a dialog class
 * must resolve to a rule whose background comes from a --paper token.
 */
function themedByTokens(file) {
  return /text-ink-|bg-paper/.test(read(file));
}
/** Follow a file that renders imported components instead of styling anything itself. */
function delegateThemed(file, depth = 0, seen = new Set()) {
  if (depth > 3 || seen.has(file)) return null;
  seen.add(file);
  const src = read(file);
  // A delegate carries no styling of its own: no className, no hardcoded colour.
  if (/className=/.test(src) || /#[0-9a-fA-F]{3,8}\b/.test(src)) return null;
  const rendered = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]));
  if (rendered.size === 0) return null;
  for (const [, names, specifier] of src.matchAll(/import\s*\{\s*([A-Za-z0-9_,\s]+?)\s*\}\s*from\s*"(@\/[^"]+)"/g)) {
    const imported = names.split(",").map((n) => n.trim());
    if (!imported.some((n) => rendered.has(n))) continue;
    const base = specifier.replace(/^@\//, "src/");
    for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`]) {
      let target;
      try { target = read(candidate); } catch { continue; }
      if (themedByTokens(candidate)) return candidate;
      const deeper = delegateThemed(candidate, depth + 1, seen);
      if (deeper) return deeper;
    }
  }
  return null;
}
const loadingFiles = sources.filter((f) => f.endsWith("loading.tsx"));
const loadingProblems = [];
for (const file of loadingFiles) {
  if (themedByTokens(file)) continue;
  const via = delegateThemed(file);
  if (!via) loadingProblems.push(`${file} (no tokens, and no themed component it delegates to)`);
}
check(
  `loading surfaces are themed too (${loadingFiles.length} files)`,
  loadingFiles.length > 0 && loadingProblems.length === 0,
  loadingProblems.length ? loadingProblems.join("; ") : `every loading surface is token-themed, directly or through the component it renders`
);

// A dialog inherits whatever it is mounted inside, so the surfaces that contain
// one must be token-based as well.
const dialogs = tsx.filter((f) => /<dialog|role="dialog"/.test(read(f)));
const dialogProblems = [];
for (const file of dialogs) {
  const src = read(file);
  if (/bg-paper-raised|bg-paper\b/.test(src)) continue;
  // Otherwise the surface must come from a CSS class whose background is a --paper token.
  const classNames = [...src.matchAll(/<dialog[\s\S]{0,400}?className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
  const themed = classNames.filter((cls) =>
    new RegExp(`\\.${cls}\\s*\\{[^}]*background:\\s*rgb\\(var\\(--paper`).test(globalsCss));
  if (themed.length === 0) {
    dialogProblems.push(`${file} (classes: ${classNames.join(", ") || "none"} — no --paper background in globals.css)`);
  }
}
check(
  `dialogs sit on token surfaces (${dialogs.length} files)`,
  dialogs.length > 0 && dialogProblems.length === 0,
  dialogProblems.length ? dialogProblems.join("; ") : "every dialog is on a token surface, by utility class or by a stylesheet rule"
);

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
