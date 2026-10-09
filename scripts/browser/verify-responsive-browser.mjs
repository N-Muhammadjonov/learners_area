#!/usr/bin/env node
/**
 * REAL-BROWSER responsive verification at 390 / 768 / 1440 px.
 *
 * Why this exists (owner correction, item 5): the static probe reads JSX and can only
 * prove that *source* wraps each <table> in something with `overflow-x-auto`. It cannot
 * prove what the browser actually lays out — a wrapper can exist and still not own the
 * scroll (a parent clips it, the class is overridden, flex children refuse to shrink),
 * and a page can overflow horizontally for reasons that have nothing to do with tables.
 *
 * Two invariants, measured on the real layout:
 *   1. NO PAGE-LEVEL HORIZONTAL OVERFLOW: documentElement.scrollWidth must not exceed
 *      the viewport. A page the user can drag sideways is the actual defect.
 *   2. THE INTENDED CONTAINER OWNS TABLE SCROLL: for every rendered <table> that is
 *      wider than its parent box, the nearest ancestor with computed
 *      overflow-x: auto|scroll must exist and must itself fit inside the viewport.
 *      A table may scroll; the page may not.
 *
 * Both are reported per viewport and per route so a failure names the exact page, size
 * and element rather than a file.
 *
 * SCOPE, stated so this is not over-read: invariant 2 can only judge a table that
 * ACTUALLY overflows at one of the tested widths. A table missing its wrapper but
 * currently narrow enough to fit is not a defect the browser can observe — it is a
 * latent one, and catching it is the job of the per-<table> static probe in
 * scripts/verify-responsive.mjs. The two legs are complementary and neither replaces the
 * other: a wrapper removed from a fitting table is caught statically and not here; a
 * wrapper that exists but does not own the scroll at 390px is caught here and not
 * statically. The run prints how many tables rendered and how many actually overflowed,
 * so a vacuous table leg is visible rather than silent.
 *
 * Requirements (deliberately NOT repo dependencies):
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *   a built server on BASE_URL;  LD_LIBRARY_PATH=/tmp/chromium-libs/lib:/tmp
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

const VIEWPORTS = [
  { name: "mobile 390", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
  { name: "tablet 768", width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true },
  { name: "desktop 1440", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
];

const USERS = {
  student: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
  owner: { email: "owner@learnersarea.uz", password: "Owner12345!" },
};

// Routes chosen because they render real tabular data, not empty states.
const ROUTES = [
  { path: "/app", as: "student" },
  { path: "/app/progress", as: "student" },
  { path: "/app/lessons", as: "student" },
  { path: "/app/management", as: "owner" },
  { path: "/app/admin/people", as: "owner" },
  { path: "/app/admin/admissions", as: "owner" },
  { path: "/app/admin/content", as: "owner" },
  { path: "/app/owner/audit", as: "owner" },
  { path: "/app/teacher/students", as: "owner" },
];

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const browser = await puppeteer.launch({
  args: [...chromium.args.filter((a) => a !== "--single-process"), "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});

/** Each actor gets an isolated context: pages in one Chromium share a cookie jar. */
async function signIn(who) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.type("#email", USERS[who].email);
  await page.type("#password", USERS[who].password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
  return page;
}

/** Measured in the page: page overflow + per-table scroll ownership. */
const measure = () =>
  // eslint-disable-next-line no-undef
  ({
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    // The widest element actually sticking out, to make a failure diagnosable.
    widest: (() => {
      const limit = document.documentElement.clientWidth;
      let worst = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const over = Math.round(r.right - limit);
        if (over > 1 && (!worst || over > worst.over)) {
          worst = {
            over,
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") ?? "").slice(0, 80),
          };
        }
      }
      return worst;
    })(),
    tables: [...document.querySelectorAll("table")].map((table, i) => {
      // Walk up for the nearest ancestor whose COMPUTED style owns horizontal scroll.
      let owner = null;
      for (let el = table.parentElement; el && el !== document.body; el = el.parentElement) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") {
          owner = el;
          break;
        }
      }
      const parent = table.parentElement;
      return {
        index: i,
        caption: (table.querySelector("caption,th")?.textContent ?? "").trim().slice(0, 40),
        tableWidth: Math.round(table.getBoundingClientRect().width),
        parentWidth: parent ? Math.round(parent.getBoundingClientRect().width) : 0,
        overflows: parent
          ? table.scrollWidth > parent.getBoundingClientRect().width + 1
          : false,
        hasScrollOwner: Boolean(owner),
        ownerClass: owner ? (owner.getAttribute("class") ?? "").slice(0, 60) : null,
        ownerFitsViewport: owner
          ? Math.round(owner.getBoundingClientRect().width) <=
            document.documentElement.clientWidth + 1
          : false,
      };
    }),
  });

try {
  const pages = { student: await signIn("student"), owner: await signIn("owner") };
  let tablesSeen = 0;
  let overflowingSeen = 0;

  for (const vp of VIEWPORTS) {
    for (const { path, as } of ROUTES) {
      const page = pages[as];
      await page.setViewport(vp);
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 60000 });
      const landed = new URL(page.url()).pathname;
      if (landed !== path) {
        check(`${vp.name} ${path} — route reachable for the fixture`, false, `landed on ${landed}`);
        continue;
      }
      const m = await page.evaluate(measure);

      check(
        `${vp.name} ${path} — no page-level horizontal overflow`,
        m.pageScrollWidth <= m.viewportWidth + 1,
        `scrollWidth=${m.pageScrollWidth} viewport=${m.viewportWidth}` +
          (m.widest ? ` widest=<${m.widest.tag} class="${m.widest.cls}"> +${m.widest.over}px` : "")
      );

      for (const t of m.tables) {
        tablesSeen += 1;
        if (!t.overflows) continue;
        overflowingSeen += 1;
        check(
          `${vp.name} ${path} — table #${t.index}${t.caption ? ` (${t.caption})` : ""} scrolls inside a container`,
          t.hasScrollOwner && t.ownerFitsViewport,
          t.hasScrollOwner
            ? `scroll container is wider than the viewport (class="${t.ownerClass}")`
            : `table is ${t.tableWidth}px in a ${t.parentWidth}px parent with no overflow-x ancestor`
        );
      }
    }
  }

  console.log(
    `\n  tables rendered: ${tablesSeen}; overflowing their parent (scroll ownership asserted): ${overflowingSeen}`
  );
  // POSITIVE CONTROL: if no table ever rendered, every table assertion above was vacuous.
  check(
    "the sweep actually rendered tables (otherwise the table assertions are vacuous)",
    tablesSeen > 0,
    `tables observed: ${tablesSeen}, of which overflowing (scroll-ownership asserted): ${overflowingSeen}`
  );
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
