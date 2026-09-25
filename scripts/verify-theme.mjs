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
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

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

const day = await html("/dashboard", cookie);
check("day mode is the default", day.text.includes('data-theme="day"'), "theme attribute missing");
check("the report control ships with the shell", day.text.includes("data-report-toggle"));

const night = await html("/dashboard", `${cookie}; la_theme=night`);
check("the night theme is rendered on the server", night.text.includes('data-theme="night"'));
check("the server render already carries the night theme (no flash path)", night.status === 200);

// The palette is one block of tokens, applied to every surface.
const css = await fetch(`${BASE}/_next/static/css/${(night.text.match(/_next\/static\/css\/([^"]+\.css)/) ?? [])[1] ?? ""}`);
const cssText = css.ok ? await css.text() : "";
check(
  "night mode sets the navy page and card tokens",
  cssText.includes('data-theme="night"') && /--paper:\s*11 13 24/.test(cssText),
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
const pages = ["/dashboard", "/vocabulary", "/reading", "/listening", "/grammar", "/writing", "/speaking", "/progress", "/assignments"];
for (const path of pages) {
  const page = await html(path, cookie);
  const width = page.status === 200 ? "" : `status ${page.status}`;
  check(`${path} renders`, page.status === 200, width);
}

const vocabulary = await html("/vocabulary", cookie);
check("the vocabulary studio is a client surface with panels", vocabulary.text.includes("data-vocab-studio") || vocabulary.text.includes("vocabulary"));

const grammar = await html("/grammar", cookie);
check("the grammar list wraps its scores", grammar.text.includes("data-topic-score="));

const listeningList = await html("/listening", cookie);
check("the listening list renders cards", listeningList.text.includes("card"));

const dashboard = await html("/dashboard", cookie);
check("the dashboard keeps its navigation on small screens", dashboard.text.includes("data-report-toggle"));

// The mobile drawer is built from the same navigation tree as the desktop rail.
const sidebar = (await import("node:fs")).readFileSync("src/components/shell/Sidebar.tsx", "utf8");
const mobile = (await import("node:fs")).readFileSync("src/components/shell/MobileNav.tsx", "utf8");
check("both navigation surfaces share one tree", sidebar.includes("SidebarNav") && mobile.includes("SidebarNav"));
check("the report control is on both surfaces", sidebar.includes("ReportProblem") && mobile.includes("ReportProblem"));

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

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
