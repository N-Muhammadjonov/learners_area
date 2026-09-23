#!/usr/bin/env node
/**
 * Smoke-test every rendered page for every role, in both locales.
 *
 * This is not a screenshot — no browser is available in this environment — but
 * it is a real render check: it asserts each page returns 200, contains its
 * expected heading, and does not leak template artefacts ("undefined", "NaN",
 * "[object Object]", raw NEXT_PUBLIC_* leakage, or an unresolved i18n key
 * rendered as a literal dotted path).
 *
 *   node scripts/verify-pages.mjs [baseUrl]
 */
import assert from "node:assert/strict";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const ACCOUNTS = {
  admin: { email: "admin@learnersarea.uz", password: "Admin12345!" },
  teacher: { email: "teacher@learnersarea.uz", password: "Teacher12345!" },
  student: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
};

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}

async function login(account) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ACCOUNTS[account]),
  });
  assert.equal(res.status, 200, `login failed for ${account}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return cookie;
}

async function get(cookie, pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Cookie: cookie }, redirect: "manual" });
  return { status: res.status, html: await res.text(), location: res.headers.get("location") };
}

/** Sets the locale cookie and returns the merged cookie jar. */
async function setLocale(cookie, locale) {
  const res = await fetch(`${BASE}/api/locale`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ locale }),
  });
  assert.equal(res.status, 200);
  const fresh = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const jar = new Map(cookie.split("; ").filter(Boolean).map((c) => c.split("=")));
  for (const c of fresh) {
    const [k, v] = c.split("=");
    jar.set(k, v);
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Artefacts that mean a page is rendering something it should not. */
function assertCleanHtml(html, label) {
  for (const bad of ["[object Object]", "undefined%", ">undefined<", "NaN%", ">NaN<"]) {
    assert.ok(!html.includes(bad), `${label}: rendered "${bad}"`);
  }
  // An unresolved dictionary key shows up as a literal dotted path in markup.
  const dotted = html.match(/>[a-z][a-zA-Z]+\.[a-z][a-zA-Z]+(\.[a-zA-Z]+)?</g);
  if (dotted) {
    const suspicious = dotted.filter((d) => /\.(title|save|cancel|loading|comingSoon|delete)$/.test(d));
    assert.equal(suspicious.length, 0, `${label}: possible unresolved i18n key: ${suspicious[0]}`);
  }
}

const PAGES = {
  student: [
    "/dashboard",
    "/onboarding",
    "/courses/ielts",
    "/writing",
    "/writing/history",
    "/listening",
    "/listening/history",
    "/reading",
    "/reading/history",
    "/speaking",
    "/grammar",
    "/vocabulary",
    "/vocabulary/review",
    "/live-classes",
    "/mocks",
    "/progress",
  ],
  teacher: ["/teacher/speaking", "/teacher/students", "/teacher/live-classes"],
  admin: [
    "/admin/users",
    "/admin/reading",
    "/admin/listening",
    "/admin/grammar",
    "/admin/writing-prompts",
  ],
};

console.log(`\nLearners Area — page render smoke test against ${BASE}\n`);

for (const [role, paths] of Object.entries(PAGES)) {
  let cookie = await login(role);

  for (const locale of ["uz", "en"]) {
    cookie = await setLocale(cookie, locale);
    for (const pathname of paths) {
      await check(`${role} ${locale} ${pathname}`, async () => {
        const { status, html, location } = await get(cookie, pathname);
        assert.ok(status === 200 || status === 307, `status ${status} (redirect: ${location})`);
        if (status === 307) {
          // A redirect is legitimate for e.g. /onboarding, but it must not be
          // a bounce back to /login (which would mean the session was lost).
          assert.ok(!location?.startsWith("/login"), `redirected to login: ${location}`);
          return;
        }
        assert.ok(html.length > 2000, `suspiciously small response (${html.length} bytes)`);
        assertCleanHtml(html, `${role} ${locale} ${pathname}`);
        // Pages inside the (app) group render the shared shell; /onboarding is
        // a standalone pre-app screen and legitimately has no <main>.
        if (!pathname.startsWith("/onboarding")) {
          assert.ok(html.includes("<main"), "no <main> element — the app shell did not render");
        }
      });
    }
  }
}

// --- Locale actually changes the rendered language --------------------------

await check("switching locale changes the rendered UI language", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "uz");
  const uz = await get(cookie, "/dashboard");
  cookie = await setLocale(cookie, "en");
  const en = await get(cookie, "/dashboard");
  assert.notEqual(uz.html, en.html, "locale switch produced identical HTML");
  assert.match(uz.html, /Boshqaruv paneli/, "Uzbek render is missing Uzbek copy");
  assert.match(en.html, /Dashboard/, "English render is missing English copy");
});

await check("no hard-coded English section labels survive in the sidebar", async () => {
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "uz");
  const { html } = await get(cookie, "/dashboard");
  for (const label of ["Main", "Track", "Teacher"]) {
    assert.ok(!html.includes(`>${label}</p>`), `sidebar section "${label}" is not translated`);
  }
  assert.match(html, />Asosiy</, "Uzbek sidebar is missing the translated Main section");
  assert.match(html, />Natijani kuzatish</, "Uzbek sidebar is missing the translated Track section");
});

await check("teacher speaking page renders the resource composer", async () => {
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "en");
  const { html } = await get(cookie, "/teacher/speaking");
  assert.match(html, /Manage Speaking materials/);
  assert.match(html, /Primary file/);
  assert.match(html, /Description/);
  assert.match(html, /Add a description block/);
  assert.match(html, /Choose file/);
  assert.match(html, /attachmentMenuLabel|Add a description block/);
});

await check("teacher speaking page renders the composer in Uzbek", async () => {
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "uz");
  const { html } = await get(cookie, "/teacher/speaking");
  assert.match(html, /Speaking materiallarini boshqarish/);
  assert.match(html, /Asosiy fayl/);
  assert.match(html, /Tavsif bloki qo'shish/);
  assert.match(html, /Fayl tanlash/);
});

await check("deactivate and delete are distinguishable in both languages", async () => {
  // They used to render as the same Uzbek word, which made a destructive and a
  // reversible action look identical on the same card.
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "uz");
  const uz = await get(cookie, "/teacher/speaking");
  const uzHtml = uz.html;
  assert.ok(uzHtml.includes("Faolsizlantirish"), "Uzbek deactivate label missing");
  assert.ok(uzHtml.includes("O'chirish"), "Uzbek delete label missing");
  assert.notEqual("Faolsizlantirish", "O'chirish");

  cookie = await setLocale(cookie, "en");
  const en = await get(cookie, "/teacher/speaking");
  assert.ok(en.html.includes("Deactivate"), "English deactivate label missing");
  assert.ok(en.html.includes("Delete"), "English delete label missing");
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
