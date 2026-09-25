#!/usr/bin/env node
/**
 * Responsive behaviour at the five tiers the centre supports —
 * 320–429, 430–767, 768–1023, 1024–1439 and 1440+.
 *
 * There is no headless browser in this environment, so nothing here claims to
 * have *painted* a layout at a given width. What it does check is the set of
 * decisions that make a layout survive those widths, plus the phone behaviours
 * that are easy to break silently: the viewport declaration, 16px fields (iOS
 * zooms anything smaller, which is how a keyboard ends up covering an input),
 * dynamic viewport units, touch target size, safe-area insets, and the rule that
 * wide content scrolls inside its own container instead of moving the page.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SRC = "src";

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

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(SRC);
const tsx = files.filter((f) => [".tsx", ".ts", ".css"].includes(extname(f)));
const read = (f) => readFileSync(f, "utf8");

console.log(`\nLearners Area — responsive behaviour across 320 / 430 / 768 / 1024 / 1440\n`);

// --- Phone behaviours -------------------------------------------------------
const layout = read("src/app/layout.tsx");
check("the viewport is declared explicitly", layout.includes("export const viewport"));
check("width=device-width", layout.includes('width: "device-width"'));
check(
  "pinch-zoom is not disabled",
  !/maximumScale|userScalable/.test(layout.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""))
);
check("the keyboard resizes the layout instead of covering the field", layout.includes('interactiveWidget: "resizes-content"'));
check("the layout extends under the notch (viewport-fit)", layout.includes('viewportFit: "cover"'));
check(
  "no page locks zoom or fixes a scaled viewport",
  !tsx.some((f) => /user-scalable=no|maximum-scale=1/.test(read(f)))
);

const globals = read("src/app/globals.css");
const inputRule = globals.slice(globals.indexOf(".input"), globals.indexOf(".input") + 600);
check("fields are 16px on phones (iOS zoom guard)", inputRule.includes("text-base") && inputRule.includes("sm:text-sm"));
check("a focused field keeps room below it", inputRule.includes("scroll-margin-block"));
check("touch devices get 44px targets", /pointer: coarse[\s\S]{0,120}min-height: 2\.75rem/.test(globals));
// Theme tokens themselves are verify-theme's job; here it only matters that the
// responsive rules live in the same token system rather than in one-off literals.
check(
  "the responsive rules are written with tokens, not raw colours",
  !/\.(input|btn)[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(globals)
);

// --- Dynamic viewport units -------------------------------------------------
const vhOffenders = tsx.filter((f) => /100vh|h-screen|min-h-screen/.test(read(f)));
check(
  "full-height surfaces use dynamic viewport units (dvh), not 100vh",
  vhOffenders.length === 0,
  vhOffenders.join(", ")
);

// --- Safe areas -------------------------------------------------------------
const appLayout = read("src/app/(app)/layout.tsx");
check("the app shell clears the home indicator", appLayout.includes("env(safe-area-inset-bottom)"));
check("the app shell clears the notch on both sides", appLayout.includes("env(safe-area-inset-left)") && appLayout.includes("env(safe-area-inset-right)"));
check("the content column can shrink (no flex overflow)", appLayout.includes("min-w-0"));

// --- Smallest tier: nothing may demand more than 320px ----------------------
const WIDTH = /(?:^|[\s"])(?:w|min-w)-\[(\d{3,})px\]/g;
const wide = [];
for (const f of tsx) {
  const text = read(f);
  for (const m of text.matchAll(WIDTH)) {
    if (Number(m[1]) > 320) {
      // Only acceptable inside a horizontal scroller.
      wide.push(`${f}:${m[1]}px${text.includes("overflow-x-auto") ? " (scrolled)" : " (NOT scrolled)"}`);
    }
  }
}
check(
  "no element demands more width than the smallest supported phone",
  wide.every((w) => w.includes("(scrolled)")),
  wide.join(", ")
);

// --- Wide content scrolls in its own container ------------------------------
const tableFiles = tsx.filter((f) => read(f).includes("<table"));
const unwrapped = tableFiles.filter((f) => !read(f).includes("overflow-x-auto"));
check("every table scrolls horizontally instead of moving the page", unwrapped.length === 0, unwrapped.join(", "));

// --- Breakpoint hygiene -----------------------------------------------------
// Two compact tiles fit a 320px screen; a form control in a multi-column grid does
// not (half a phone width is not enough for a labelled field).
const crowdedForms = [];
for (const f of tsx) {
  const text = read(f);
  for (const m of text.matchAll(/grid grid-cols-[2-9][^"\n]*/g)) {
    const tail = text.slice(m.index ?? 0, (m.index ?? 0) + 600);
    if (/<(input|select|textarea)/.test(tail)) crowdedForms.push(`${f}: ${m[0].slice(0, 60)}`);
  }
}
check(
  "no form control sits in a multi-column grid on the smallest tier",
  crowdedForms.length === 0,
  crowdedForms.join(", ")
);

const sidebar = read("src/components/shell/Sidebar.tsx");
const mobileNav = read("src/components/shell/MobileNav.tsx");
check("the desktop rail is hidden below 768px", sidebar.includes("hidden") && sidebar.includes("md:flex"));
check("a drawer replaces it below 768px", mobileNav.includes("md:hidden"));

// Every three-or-more-column grid must be gated behind a breakpoint, so the base
// (320–639px) layout is never three columns wide.
const ungated = [];
for (const f of tsx) {
  for (const line of read(f).split("\n")) {
    for (const m of line.matchAll(/(^|[\s"])(grid-cols-[3-9])/g)) {
      if (!/(sm|md|lg|xl):grid-cols/.test(line)) ungated.push(`${f}: ${m[2]}`);
    }
  }
}
check("three-column layouts only appear from a breakpoint up", ungated.length === 0, ungated.join(", "));

// --- Server-rendered pages at the smallest tier -----------------------------
async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const pages = [
  "/dashboard",
  "/vocabulary",
  "/reading",
  "/listening",
  "/writing",
  "/speaking",
  "/grammar",
  "/progress",
  "/assignments",
  "/courses/ielts",
];
let rendered = 0;
for (const path of pages) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  if (res.status === 200) rendered += 1;
  else failures.push(`${path} did not render for the smallest tier (status ${res.status})`);
}
check(`every private page renders server-side (${rendered}/${pages.length})`, rendered === pages.length);

const dashboard = await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text();
check("the drawer button is in the shell, so a phone can navigate", dashboard.includes("aria-controls=\"mobile-nav-drawer\""));
check(
  "no inline style pins a page to a desktop width",
  !/style="[^"]*(width|min-width):\s*[3-9]\d{2,}px/.test(dashboard)
);

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
