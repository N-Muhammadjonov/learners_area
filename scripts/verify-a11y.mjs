#!/usr/bin/env node
/**
 * Accessibility and locale-formatting checks that can be made over HTTP.
 *
 * What this proves, in order:
 *   1. the document language is the reader's language, not a hard-coded one;
 *   2. the shell names its icon-only controls, so a screen reader does not read
 *      "button" and nothing else;
 *   3. the current page is announced (`aria-current`), not only coloured;
 *   4. the phone drawer is a real modal dialog with an accessible name;
 *   5. form fields on the public pages are labelled;
 *   6. imagery is either described or deliberately hidden from assistive tech;
 *   7. a reduced-motion preference and a visible focus ring are both honoured by
 *      the compiled stylesheet — not only written in a comment;
 *   8. nothing takes keyboard order hostage with a positive tabindex;
 *   9. dates are formatted in the centre's timezone rather than the server's.
 *
 * Source-level checks are used where the property is a rule rather than a
 * rendered state (tabindex, reduced motion); everything else is checked against
 * the HTML the server actually sends.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok   - ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function page(path, cookie) {
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

const readFile = (await import("node:fs")).readFileSync;
const { resolve, dirname } = await import("node:path");

console.log(`\nLearners Area — accessibility and locale against ${BASE}\n`);

// ---------------------------------------------------------------------------
// 1. Document language follows the reader
// ---------------------------------------------------------------------------
const anonUz = await page("/");
check("the default document language is Uzbek", /<html[^>]*lang="uz"/.test(anonUz.text), "expected lang=\"uz\" on <html>");

const englishCookie = await (async () => {
  const res = await fetch(`${BASE}/api/locale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "en" }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
})();
const anonEn = await page("/", englishCookie);
check("choosing English changes the document language", /<html[^>]*lang="en"/.test(anonEn.text), "expected lang=\"en\" on <html>");
check(
  "the approved landing copy does not change with the language",
  /Welcome to the next level/.test(anonEn.text) && /Welcome to the next level/.test(anonUz.text)
);

// ---------------------------------------------------------------------------
// 2..4. The signed-in shell
// ---------------------------------------------------------------------------
const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const dashboard = await page("/app", cookie);
check("the dashboard renders for an ACTIVE student", dashboard.status === 200, `status ${dashboard.status}`);

// Icon-only controls must carry a name. A button whose only child is a glyph is
// unusable with a screen reader.
const shellHtml = dashboard.text;
const iconButtons = [...shellHtml.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
const unnamed = iconButtons.filter(([fullTag, inner]) => {
  // Use THIS match's own element. Looking the tag up again by inner markup made two
  // buttons with identical glyphs collapse onto the first match, so an unlabelled
  // button could inherit a labelled sibling's tag and pass. Never re-find by content.
  const tag = fullTag;
  const hasLabel = /aria-label=/.test(tag) || /title=/.test(tag);
  const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  // Real words (even a two-letter language code) are a name; a bare glyph is not.
  const hasWords = /[\p{L}\p{N}]/u.test(text);
  return !hasLabel && !hasWords;
});
check(
  "every icon-only button in the shell has an accessible name",
  unnamed.length === 0,
  unnamed.slice(0, 2).map(([, inner]) => inner.slice(0, 40)).join(" | ")
);

check("the drawer control is labelled", /aria-controls="mobile-nav-drawer"[^>]*aria-label=|aria-label="[^"]*"[^>]*aria-controls="mobile-nav-drawer"/.test(shellHtml));
check("the drawer control reports its state", /aria-expanded="(true|false)"/.test(shellHtml));
check("the current page is announced, not only coloured", /aria-current="page"/.test(shellHtml));
check("the theme switch is a labelled button, not a bare glyph", /data-theme-toggle="[^"]+"[^>]*aria-label=|aria-label="[^"]*"[^>]*data-theme-toggle/.test(shellHtml));
check(
  "the notification control announces its label",
  /aria-label="[^"]*"[^>]*href="\/app\/notifications"|href="\/app\/notifications"[^>]*aria-label="[^"]*"/.test(shellHtml)
);

// The drawer is a modal dialog in the source, with a name.
const mobileNavSource = readFile("src/components/shell/MobileNav.tsx", "utf8");
check("the phone drawer is declared as a modal dialog", /role="dialog"/.test(mobileNavSource) && /aria-modal="true"/.test(mobileNavSource));
check("the drawer has an accessible name", /aria-label=\{dict\.nav\.menu\}/.test(mobileNavSource));
check("the drawer closes on Escape", /Escape/.test(mobileNavSource));
check("the drawer marks its decorative icons as such", /aria-hidden/.test(mobileNavSource));

// ---------------------------------------------------------------------------
// 5. Public forms are labelled
// ---------------------------------------------------------------------------
const loginPage = await page("/login");
const inputs = [...loginPage.text.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
const unlabelledInputs = inputs.filter((input) => {
  if (/type="(hidden|submit|checkbox)"/.test(input)) return false;
  return !/aria-label=/.test(input) && !/id="/.test(input);
});
check("the sign-in fields are named", inputs.length >= 2 && unlabelledInputs.length === 0, unlabelledInputs.join(" | "));
check(
  "the sign-in fields are associated with a label",
  /<label[^>]*for="/.test(loginPage.text) || /aria-label=/.test(loginPage.text)
);

// ---------------------------------------------------------------------------
// 6. Imagery
// ---------------------------------------------------------------------------
const brandImgTags = [...dashboard.text.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
check(
  "brand artwork is either described or hidden from assistive tech",
  brandImgTags.every((tag) => /alt="[^"]*"/.test(tag)),
  brandImgTags.filter((tag) => !/alt=/.test(tag)).join(" | ")
);
const brandLogoSource = readFile("src/components/brand/BrandLogo.tsx", "utf8");
check(
  "artwork that repeats a visible name can be hidden from screen readers",
  /aria-hidden/.test(brandLogoSource) && /decorative/.test(brandLogoSource)
);
const sidebarSource = readFile("src/components/shell/Sidebar.tsx", "utf8");
const brandBlockSource = readFile("src/components/shell/BrandBlock.tsx", "utf8");
check(
  "the sidebar mark is decorative because the name is text beside it",
  // The artwork repeats the product name, which is rendered as real text next to
  // it — so the image must not be announced a second time.
  /<BrandBlock/.test(sidebarSource) &&
    /aria-hidden/.test(brandBlockSource) &&
    /brand-name/.test(brandBlockSource)
);

// ---------------------------------------------------------------------------
// 7..8. Stylesheet rules and keyboard order
// ---------------------------------------------------------------------------
// A page links MORE THAN ONE stylesheet (a global sheet plus per-route chunks), and the
// order is a build detail. Reading only the first href made these assertions depend on
// which chunk happened to come first: a build that emitted a small route sheet first
// turned three real checks into failures against a file that was never supposed to carry
// the rules. Concatenate every stylesheet the page actually loads, and prove at least
// one was fetched so the block cannot be skipped silently.
const cssHrefs = [...new Set([...dashboard.text.matchAll(/href="(\/_next\/static\/css\/[^"]+)"/g)].map((m) => m[1]))];
check("the dashboard links at least one compiled stylesheet", cssHrefs.length > 0, `${cssHrefs.length} found`);
if (cssHrefs.length > 0) {
  // Fetching a stale hash returns 404 HTML, whose body contains none of the rules below
  // — that would report three confident failures about a file that was never read. Make
  // a non-200 an explicit, named failure instead.
  const fetched = await Promise.all(
    cssHrefs.map(async (h) => {
      const r = await fetch(`${BASE}${h}`);
      return { h, status: r.status, body: r.ok ? await r.text() : "" };
    })
  );
  const unreadable = fetched.filter((f) => f.status !== 200);
  check(
    "every stylesheet the dashboard links is actually served",
    unreadable.length === 0,
    unreadable.map((f) => `${f.h} -> ${f.status}`).join(", ")
  );
  const css = fetched.map((f) => f.body).join("\n");
  check("a reduced-motion preference is honoured in the compiled CSS", /prefers-reduced-motion:reduce/.test(css.replace(/\s+/g, "")));
  check("a visible focus ring is defined", /:focus-visible\s*\{\s*outline:\s*2px solid/.test(css));
  check("focus rings are not removed without replacement", !/outline:\s*none/.test(css) || /:focus-visible/.test(css));
} else {
  check("the compiled stylesheet is reachable", false, "no CSS link found");
}

const globals = readFile("src/app/globals.css", "utf8");
check("the reduced-motion rule keeps content visible", /animation-duration:\s*0\.001ms/.test(globals) && !/display:\s*none/.test(globals.split("prefers-reduced-motion")[1]?.slice(0, 300) ?? ""));

const tsxSources = [...(await import("node:fs")).readdirSync("src/components/shell").map((f) => `src/components/shell/${f}`)];
let positiveTabindex = [];
for (const file of tsxSources) {
  const text = readFile(file, "utf8");
  for (const match of text.matchAll(/tabIndex=\{?([1-9]\d*)/g)) positiveTabindex.push(`${file}: ${match[1]}`);
}
check("no control takes keyboard order hostage with a positive tabindex", positiveTabindex.length === 0, positiveTabindex.join(", "));

// ---------------------------------------------------------------------------
// 9. Dates are formatted in the centre's timezone
// ---------------------------------------------------------------------------
const timeSource = readFile("src/lib/time.ts", "utf8");
check("one formatter owns the display timezone", /TIMEZONE = "Asia\/Tashkent"/.test(timeSource) && /timeZone: TIMEZONE/.test(timeSource));
const strayToLocale = ["src/app/app/(shell)/page.tsx", "src/app/app/(shell)/live-classes/page.tsx"].filter((file) =>
  /toLocaleString\(|toLocaleDateString\(/.test(readFile(file, "utf8"))
);
check("no page formats a date with the runtime's timezone", strayToLocale.length === 0, strayToLocale.join(", "));

// ---------------------------------------------------------------------------
// 10. The Uzbek rule holds in the bytes a reader actually receives
// ---------------------------------------------------------------------------
// The unit test proves the rule in the source. This proves it in the rendered
// page: a mark can reach a reader through a data file, a seed or a component
// that the source scan does not read as Uzbek copy, and only the response shows
// that. Learners Area-controlled Uzbek text must use the ASCII apostrophe
// (U+0027) and must not contain Cyrillic.
const TYPOGRAPHIC = /[\u2018\u2019\u02bb\u02bc\u02b9\u2032]/;
const CYRILLIC = /[\u0400-\u04ff]/;

const uzStudent = await login("demo.student@learnersarea.uz", "Student12345!");
for (const path of ["/", "/login", "/register", "/app", "/app/vocabulary"]) {
  const rendered = await page(path, path === "/" || path === "/login" || path === "/register" ? null : uzStudent);
  const body = rendered.text;
  const typographic = body.match(new RegExp(TYPOGRAPHIC.source, "g")) ?? [];
  const cyrillic = [...new Set(body.match(new RegExp(CYRILLIC.source, "g")) ?? [])];
  check(
    `the rendered page ${path} uses the ASCII apostrophe`,
    typographic.length === 0,
    `${typographic.length} typographic mark(s) in the response`
  );
  check(
    `the rendered page ${path} carries no Cyrillic`,
    cyrillic.length === 0,
    cyrillic.slice(0, 8).join(" ")
  );
}

// ---------------------------------------------------------------------------
// 11. The public headline reads as one sentence
// ---------------------------------------------------------------------------
// The headline is painted as two block lines (the name carries the accent). Two
// block elements with nothing between them concatenate in the text content, so a
// screen reader announces "…next levelwith LEARNERS AREA". The rendered text is
// what accessibility depends on, so the rendered text is what is checked.
{
  const landing = await page("/", null);
  const heading = (landing.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1] ?? "";
  const asText = heading
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  check(
    "the public headline reads as one sentence, not two stuck together",
    asText === "Welcome to the next level with LEARNERS AREA",
    JSON.stringify(asText)
  );
}

// ---------------------------------------------------------------------------
// 12. A response does not hand over the stack or the source
// ---------------------------------------------------------------------------
const rawLogin = await fetch(`${BASE}/login`, { redirect: "manual" });
check(
  "the framework does not advertise itself in a header",
  !rawLogin.headers.get("x-powered-by"),
  rawLogin.headers.get("x-powered-by") ?? ""
);
check(
  "the production config forbids browser source maps",
  /productionBrowserSourceMaps:\s*false/.test(readFile("next.config.mjs", "utf8"))
);

// The built output is only there after `npm run build`; when it is, check it for
// real rather than trusting the config flag.
const { existsSync, readdirSync: readDir } = await import("node:fs");
if (existsSync(".next/BUILD_ID")) {
  const walkFiles = (dir, out = []) => {
    for (const entry of readDir(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkFiles(full, out);
      else out.push(full);
    }
    return out;
  };
  const staticFiles = walkFiles(".next/static");
  const maps = staticFiles.filter((f) => f.endsWith(".map"));
  // Classify every trailing sourceMappingURL directive explicitly. The release invariant
  // is that production exposes NO browser-accessible source map or source content, so
  // "the named file is not on disk" is not by itself a pass — an inline data: map needs
  // no file at all, and an absolute URL can serve one from elsewhere.
  const inlineMaps = [];
  const shippedMaps = [];
  const externalMaps = [];
  const staleComments = [];
  for (const f of staticFiles.filter((f) => f.endsWith(".js") || f.endsWith(".css"))) {
    const body = readFile(f, "utf8");
    // Only a TRAILING directive is a real link; the token also appears inside vendored
    // source-map tooling as string/regex literals that merely WRITE maps elsewhere.
    const m = body.slice(-600).match(/\/[/*]#\s*sourceMappingURL=([^\s*]+)/);
    if (!m) continue;
    const target = m[1].trim();
    if (/^data:/i.test(target)) inlineMaps.push(f);                       // map embedded in the bundle
    else if (/^https?:\/\//i.test(target)) externalMaps.push(`${f} -> ${target}`); // served from elsewhere
    else if (existsSync(resolve(dirname(f), target))) shippedMaps.push(f); // map really shipped
    else staleComments.push(f);                                            // points at nothing
  }
  check("no production bundle embeds an inline source map", inlineMaps.length === 0, inlineMaps.slice(0, 3).join(", "));
  check("no production bundle links an external source map", externalMaps.length === 0, externalMaps.slice(0, 3).join(", "));
  const linked = shippedMaps;
  // A directive pointing at a file that was never emitted exposes nothing, but it is
  // still reported so it cannot hide a real regression behind a familiar message.
  if (staleComments.length > 0) {
    console.log(`(-- ${staleComments.length} stale sourceMappingURL comment(s) with no shipped map: ${staleComments.slice(0, 2).join(", ")})`);
  }
  // Defence in depth: the build flag must also be off.
  const nextConfig = readFile("next.config.mjs", "utf8");
  check(
    "the build disables browser source maps",
    /productionBrowserSourceMaps:\s*false/.test(nextConfig) || !/productionBrowserSourceMaps/.test(nextConfig),
    "productionBrowserSourceMaps is enabled"
  );
  check("the production build ships no source map files", maps.length === 0, `${maps.length} .map file(s)`);
  check("no production chunk points at a source map", linked.length === 0, linked.slice(0, 3).join(", "));
} else {
  console.log("(-- no production build in .next, source-map file checks not run)");
}

console.log(`\n# pass ${passed} / fail ${failed}`);
if (failed > 0) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failed > 0 ? 1 : 0);
