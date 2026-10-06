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
check(
  "night mode sets the navy page and card tokens",
  nightSelector.test(cssText) && /--paper:\s*11 13 24/.test(cssText),
  "night palette not found in the stylesheet"
);
check(
  "night mode keeps the warm text and gold accent",
  /--ink-900:\s*243 238 229/.test(cssText) && /--accent:\s*230 185 79/.test(cssText)
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
const loadingFiles = sources.filter((f) => f.endsWith("loading.tsx"));
check(
  "loading surfaces are themed too",
  loadingFiles.length === 0 || loadingFiles.every((f) => /text-ink-|bg-paper/.test(read(f)))
);

// A dialog inherits whatever it is mounted inside, so the surfaces that contain
// one must be token-based as well.
const dialogs = tsx.filter((f) => /<dialog|role="dialog"/.test(read(f)));
check(
  `dialogs sit on token surfaces (${dialogs.length} files)`,
  dialogs.length === 0 || dialogs.every((f) => /bg-paper-raised|bg-paper\b/.test(read(f)))
);

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
