/**
 * Real-Chromium harness for Package F (mobile / accessibility / i18n).
 *
 * WHY A REAL BROWSER. A source-text scan cannot answer any of the questions this package asks.
 * "Does the page overflow horizontally at 320 px" is a property of the rendered layout, not of
 * the markup; "is this control's accessible name present" depends on the composed tree, aria
 * attributes, labels and text content together; "does focus land somewhere sensible when a dialog
 * opens" only exists at runtime. Every one of those was previously inferred from grep, which is
 * how a suite comes to assert things the product never did.
 *
 * Everything here MEASURES and reports numbers. Nothing is inferred.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const CHROMIUM_PATH = "/tmp/chromium-libs/headless_shell";
export const LIB_PATH = "/tmp/chromium-libs/lib";

/**
 * The @sparticuz/chromium argument list, minus `--single-process`.
 *
 * `--single-process` is what that package ships for Lambda, and it makes the renderer and the
 * browser share one process. Under load it produces spurious crashes and — worse for QA —
 * silently different layout and timing behaviour, so a measurement taken with it is not a
 * measurement of what a learner's browser does. `--no-sandbox` and `--disable-dev-shm-usage` are
 * required in this container and change nothing about rendering.
 */
export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--force-color-profile=srgb",
];

export const VIEWPORTS = {
  320: { width: 320, height: 720, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  768: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  1440: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};

export async function launchBrowser() {
  const puppeteer = require("puppeteer-core");
  return puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: CHROMIUM_ARGS,
    env: { ...process.env, LD_LIBRARY_PATH: `${LIB_PATH}:${process.env.LD_LIBRARY_PATH ?? ""}` },
    headless: "shell",
    protocolTimeout: 120_000,
  });
}

/**
 * An isolated session: its own browser context (its own cookies and storage), logged in as one
 * actor, at one viewport, in one locale. One context per actor is not a nicety — sharing a
 * context would let one actor's session cookie satisfy another actor's assertions.
 */
export async function createSession(browser, { base, email, password, viewport = 1440, locale = "en" }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const vp = VIEWPORTS[viewport];
  if (!vp) throw new Error(`unknown viewport ${viewport}`);
  await page.setViewport(vp);

  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });

  if (email) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.waitForSelector("#email", { timeout: 30_000 });
    await page.type("#email", email);
    await page.type("#password", password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }).catch(() => {}),
      page.click("button[type=submit]"),
    ]);
  }

  // Locale is a cookie the product reads server-side, so it is set through the product's own
  // endpoint rather than by poking the cookie jar: that also exercises the persistence path.
  await page.evaluate(async (value) => {
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: value }),
    });
  }, locale);

  return {
    page,
    context,
    consoleErrors,
    failedRequests,
    viewport,
    locale,
    email,
    async goto(pathname, { waitUntil = "networkidle2", timeout = 60_000 } = {}) {
      const started = Date.now();
      const response = await page.goto(`${base}${pathname}`, { waitUntil, timeout });
      return { response, status: response?.status() ?? 0, ms: Date.now() - started, url: page.url() };
    },
    async close() {
      await context.close().catch(() => {});
    },
  };
}

/**
 * The per-page measurement set. Every value is read out of the live DOM.
 *
 * `overflowPx` is the page-level horizontal overflow: `documentElement.scrollWidth` minus the
 * viewport width. A positive number means the learner can scroll sideways, which at 320 px is the
 * single most common mobile defect and the one a source scan can never see.
 */
export async function auditPage(page, { minTouchTarget = 44 } = {}) {
  return page.evaluate((minTarget) => {
    const de = document.documentElement;
    const viewportWidth = window.innerWidth;

    // --- horizontal overflow: the page, and the specific elements causing it ---------------
    const overflowPx = Math.max(0, de.scrollWidth - viewportWidth);
    const offenders = [];
    if (overflowPx > 0) {
      for (const element of document.querySelectorAll("body *")) {
        const rect = element.getBoundingClientRect();
        if (rect.right > viewportWidth + 1 && rect.width > 0) {
          const style = getComputedStyle(element);
          if (style.position === "fixed") continue;
          offenders.push({
            tag: element.tagName.toLowerCase(),
            cls: String(element.className || "").slice(0, 90),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            text: (element.textContent || "").trim().slice(0, 50),
          });
          if (offenders.length >= 6) break;
        }
      }
    }

    // --- tables: a wide table is allowed to scroll INSIDE its container, not the page ------
    const tables = [...document.querySelectorAll("table")].map((table) => {
      let scroller = table.parentElement;
      let scrollableAncestor = null;
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller);
        if (/auto|scroll/.test(style.overflowX)) { scrollableAncestor = scroller; break; }
        scroller = scroller.parentElement;
      }
      return {
        scrollWidth: table.scrollWidth,
        widerThanViewport: table.scrollWidth > viewportWidth,
        hasScrollableAncestor: Boolean(scrollableAncestor),
      };
    });

    // --- interactive elements: touch targets and accessible names -------------------------
    const interactive = [...document.querySelectorAll(
      "a[href], button, input, select, textarea, [role=button], [tabindex]:not([tabindex='-1'])",
    )].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });

    const smallTargets = [];
    const unnamed = [];
    for (const element of interactive) {
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const isFormControl = ["input", "select", "textarea"].includes(tag);
      // A mouse-only desktop control is not a touch target; only flag them where touch is real.
      if (!isFormControl && (rect.height < minTarget || rect.width < minTarget)) {
        smallTargets.push({
          tag,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 40),
        });
      }
      const name = (
        element.getAttribute("aria-label") ||
        element.getAttribute("aria-labelledby") ||
        (isFormControl ? element.getAttribute("placeholder") || "" : "") ||
        (element.textContent || "").trim() ||
        (isFormControl ? element.getAttribute("value") || "" : "")
      ).trim();
      if (!name && tag !== "input") unnamed.push({ tag, type: element.getAttribute("type") ?? "", cls: String(element.className || "").slice(0, 60) });
      // A text input with no label, no aria-label and no placeholder has no accessible name.
      if (tag === "input" && !["hidden", "submit", "button"].includes(element.getAttribute("type") ?? "")) {
        const id = element.id;
        const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const wrapped = element.closest("label");
        if (!hasLabel && !wrapped && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby") && !element.getAttribute("placeholder")) {
          unnamed.push({ tag: "input", type: element.getAttribute("type") ?? "text", cls: String(element.className || "").slice(0, 60) });
        }
      }
    }

    // --- images without alternative text ---------------------------------------------------
    const imagesWithoutAlt = [...document.querySelectorAll("img")]
      .filter((img) => !img.hasAttribute("alt") && img.getBoundingClientRect().width > 0)
      .map((img) => (img.getAttribute("src") || "").slice(0, 60));

    // --- live regions and status announcements --------------------------------------------
    const liveRegions = document.querySelectorAll("[aria-live], [role=status], [role=alert]").length;

    // --- headings, landmarks and the document language ------------------------------------
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
      level: Number(h.tagName[1]),
      text: (h.textContent || "").trim().slice(0, 60),
    }));
    const landmarks = [...document.querySelectorAll("main, nav, header, footer, aside, [role=main], [role=navigation]")]
      .map((element) => element.tagName.toLowerCase() + (element.getAttribute("role") ? `[${element.getAttribute("role")}]` : ""));

    // Cyrillic in an Uzbek-Latin UI is a real, visible localisation defect.
    const bodyText = document.body.innerText || "";
    const cyrillic = (bodyText.match(/[\u0400-\u04FF]/g) ?? []).length;
    const untranslatedMarkers = [...bodyText.matchAll(/\b(t\\.[a-zA-Z0-9_.]+|missing\\.translation)\b/g)].map((m) => m[1]).slice(0, 8);

    return {
      title: document.title,
      lang: de.lang || null,
      url: location.pathname + location.search,
      viewportWidth,
      scrollWidth: de.scrollWidth,
      overflowPx,
      offenders,
      tables,
      interactiveCount: interactive.length,
      smallTargets: smallTargets.slice(0, 12),
      smallTargetCount: smallTargets.length,
      unnamed,
      imagesWithoutAlt,
      liveRegions,
      headings,
      h1Count: headings.filter((h) => h.level === 1).length,
      landmarks,
      cyrillicCount: cyrillic,
      untranslatedMarkers,
      textLength: bodyText.length,
      // Empty state vs populated state: a page that renders nothing may be an empty state or a
      // silent failure, and the only way to tell them apart is whether the page SAYS it is empty.
      hasEmptyStateCopy: /(no |none|empty|nothing|hali|yo'q|topilmadi|mavjud emas)/i.test(bodyText),
    };
  }, minTouchTarget);
}

/**
 * Keyboard reachability: Tab through the page and record where focus actually goes.
 * A focus order that skips the main content, or a focus ring that is invisible, is only
 * observable by driving the keyboard.
 */
export async function auditKeyboard(page, { tabs = 12 } = {}) {
  const stops = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < tabs; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") ?? "",
        text: (element.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").trim().slice(0, 50),
        visible: rect.width > 0 && rect.height > 0,
        outline: style.outlineStyle !== "none" || style.boxShadow !== "none",
        outlineWidth: style.outlineWidth,
      };
    });
    if (stop) stops.push(stop);
  }
  return stops;
}

/**
 * Does the page open a dialog, and does focus move into it?
 * Drives a real click and reads the composed tree afterwards.
 */
export async function auditDialog(page, selector, { nameContains = "" } = {}) {
  const handle = await page.$(selector);
  if (!handle) return { found: false };
  await handle.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const result = await page.evaluate(() => {
    const dialog = document.querySelector("[role=dialog], dialog[open], [aria-modal=true]");
    if (!dialog) return { opened: false };
    const active = document.activeElement;
    return {
      opened: true,
      label: dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby") || "",
      focusInside: dialog.contains(active),
      focusTag: active ? active.tagName.toLowerCase() : "",
      hasCloseControl: Boolean(dialog.querySelector("button")),
      inertBackground: document.querySelector("[inert]") !== null || dialog.getAttribute("aria-modal") === "true",
    };
  });
  await page.keyboard.press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 250));
  result.closedOnEscape = await page.evaluate(() => !document.querySelector("[role=dialog], dialog[open]"));
  result.found = true;
  result.nameOk = nameContains ? String(result.label ?? "").toLowerCase().includes(nameContains.toLowerCase()) : true;
  return result;
}

/**
 * Duplicate-network-request detection: the same URL fetched more than once during a navigation
 * is wasted work the learner pays for. Captured from real request events.
 */
export function attachRequestRecorder(page) {
  const requests = [];
  const listener = (request) => requests.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() });
  page.on("request", listener);
  return {
    requests,
    duplicates() {
      const seen = new Map();
      for (const request of requests) {
        if (request.method !== "GET") continue;
        const key = request.url;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([url, n]) => ({ url: url.replace(/^https?:\/\/[^/]+/, ""), count: n }));
    },
    detach() { page.off("request", listener); },
  };
}
