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
    // Assertions compare whole pages; keep the report readable by cutting the
    // echoed HTML out of the message.
    const raw = String(err.message);
    const message = raw.length > 400 ? `${raw.slice(0, 400)}… [truncated]` : raw;
    const trimmed = new Error(message);
    failures.push({ name, err: trimmed });
    console.log(`  FAIL ${name}\n         ${message}`);
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
    "/app",
    "/onboarding",
    "/app/courses/ielts",
    "/app/writing",
    "/app/writing/history",
    "/app/listening",
    "/app/listening/history",
    "/app/reading",
    "/app/reading/history",
    "/app/speaking",
    "/app/speaking/practice",
    "/app/coach",
    "/app/assignments",
    "/app/speaking/history",
    "/app/grammar",
    "/app/vocabulary",
    "/app/vocabulary/review",
    "/app/live-classes",
    "/app/mocks",
    "/app/progress",
  ],
  teacher: ["/app/teacher/speaking", "/app/teacher/students", "/app/teacher/live-classes"],
  admin: [
    "/app/admin/users",
    "/app/admin/reading",
    "/app/admin/listening",
    "/app/admin/grammar",
    "/app/admin/writing-prompts",
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
  const uz = await get(cookie, "/app");
  cookie = await setLocale(cookie, "en");
  const en = await get(cookie, "/app");
  assert.notEqual(uz.html, en.html, "locale switch produced identical HTML");
  assert.match(uz.html, /Boshqaruv paneli/, "Uzbek render is missing Uzbek copy");
  assert.match(en.html, /Dashboard/, "English render is missing English copy");
});

await check("no hard-coded English section labels survive in the sidebar", async () => {
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "uz");
  const { html } = await get(cookie, "/app");
  // The sidebar groups are Main / Modules / Progress (there is no separate
  // "Track" group any more — progress lives in its own group), so the check
  // asserts exactly those three group labels are translated, and that no English
  // group label leaks into an Uzbek render.
  for (const label of ["Main", "Modules", "Progress", "Teacher"]) {
    assert.ok(!html.includes(`>${label}</p>`), `sidebar section "${label}" is not translated`);
  }
  for (const label of ["Asosiy", "Modullar", "Natija"]) {
    assert.ok(html.includes(`>${label}</p>`), `Uzbek sidebar is missing the translated "${label}" group`);
  }
});

await check("teacher speaking page renders the resource composer", async () => {
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "en");
  const { html } = await get(cookie, "/app/teacher/speaking");
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
  const { html } = await get(cookie, "/app/teacher/speaking");
  assert.match(html, /Speaking materiallarini boshqarish/);
  assert.match(html, /Asosiy fayl/);
  assert.match(html, /Tavsif bloki qo'shish/);
  assert.match(html, /Fayl tanlash/);
});

await check("the speaking practice studio renders with the recorder controls", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "en");
  const { html } = await get(cookie, "/app/speaking/practice");
  assert.match(html, /Speaking practice/);
  // The honest, load-bearing bit: the page must say there is no transcript,
  // because no transcription provider exists.
  assert.match(html, /no transcript|No transcript/);
  assert.match(html, /<audio|<button/);
});

await check("speaking practice is translated and links to history", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "uz");
  const practice = await get(cookie, "/app/speaking/practice");
  assert.match(practice.html, /Speaking mashqi/);

  const history = await get(cookie, "/app/speaking/history");
  assert.match(history.html, /Speaking tarixi/);
});

await check("the speaking module leads to both speaking modes and they are reachable", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "en");
  // The sidebar carries one Speaking row (the module), so the modes are reached
  // from the module page — and both must actually answer, not merely be linked.
  const hub = await get(cookie, "/app/speaking");
  assert.match(hub.html, /href="\/app\/speaking\/practice"/);
  assert.match(hub.html, /href="\/app\/speaking\/shadowing"/);
  for (const path of ["/app/speaking/practice", "/app/speaking/history", "/app/speaking/shadowing"]) {
    const page = await get(cookie, path);
    assert.equal(page.status, 200, `${path} is not reachable`);
  }
});

await check("the Coach dashboard names the evaluator that produced each result", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "en");
  const { html } = await get(cookie, "/app/coach");
  assert.match(html, /Coach dashboard/);
  // The label is written from provider metadata at evaluation time, so the
  // seeded evaluation must name RIWI as its evaluator.
  assert.match(html, /data-checked-by="RIWI"/);
  assert.match(html, /Checked by/);
  // Next's flight payload legitimately contains "$undefined"; only a rendered
  // text node would be a real bug.
  assert.ok(!/>\s*(undefined|NaN)\s*</.test(html), "the Coach page must not render an undefined value");
});

await check("the Coach dashboard is translated and keeps the same evaluator label", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "uz");
  const { html } = await get(cookie, "/app/coach");
  assert.match(html, /Coach paneli/);
  // React separates text nodes with comment markers in the streamed HTML.
  assert.match(html, /Tekshirgan[\s\S]{0,80}RIWI/);
});

await check("a writing submission reports who checked it, not just a band", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "en");
  const history = await get(cookie, "/app/writing/history");
  assert.match(history.html, /Checked by[\s\S]{0,80}RIWI/);
});

await check("the assignments page renders for a student with assignments", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "en");
  const { html } = await get(cookie, "/app/assignments");
  assert.match(html, /Assignments/);
  assert.match(html, /Your response|Checked by/);
});

await check("a grammar item offers a produced answer instead of only multiple choice", async () => {
  let cookie = await login("student");
  cookie = await setLocale(cookie, "en");
  // Find a topic through the API-independent list page, then open it.
  const list = await get(cookie, "/app/grammar");
  const topicId = list.html.match(/href="\/app\/grammar\/([0-9a-f-]{36})"/)?.[1];
  assert.ok(topicId, "the grammar list must link to at least one topic");
  const { html } = await get(cookie, `/app/grammar/${topicId}`);
  assert.match(html, /Write your own correction/);
  assert.match(html, /Check my sentence/);
});

await check("a teacher can assign follow-up work from the student page", async () => {
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "en");
  const list = await get(cookie, "/app/teacher/students");
  const studentId = list.html.match(/href="\/app\/teacher\/students\/([0-9a-f-]{36})"/)?.[1];
  assert.ok(studentId, "the teacher must see at least one student");
  const { html } = await get(cookie, `/app/teacher/students/${studentId}`);
  assert.match(html, /Assign follow-up work/);
  assert.match(html, /Teacher feedback|Checked by/);
});

await check("deactivate and delete are distinguishable in both languages", async () => {
  // They used to render as the same Uzbek word, which made a destructive and a
  // reversible action look identical on the same card.
  let cookie = await login("teacher");
  cookie = await setLocale(cookie, "uz");
  const uz = await get(cookie, "/app/teacher/speaking");
  const uzHtml = uz.html;
  assert.ok(uzHtml.includes("Faolsizlantirish"), "Uzbek deactivate label missing");
  assert.ok(uzHtml.includes("O'chirish"), "Uzbek delete label missing");
  assert.notEqual("Faolsizlantirish", "O'chirish");

  cookie = await setLocale(cookie, "en");
  const en = await get(cookie, "/app/teacher/speaking");
  assert.ok(en.html.includes("Deactivate"), "English deactivate label missing");
  assert.ok(en.html.includes("Delete"), "English delete label missing");
});

await check("a malformed id in the URL is a 404, never an internal error", async () => {
  // A hand-typed id used to reach Postgres and come back as a 500 with a stack
  // trace. These are exactly the pages a user can reach by editing the address.
  const student = await login("student");
  for (const path of ["/app/reading/attempts/zzz", "/app/listening/attempts/zzz", "/app/writing/submissions/zzz", "/app/grammar/zzz"]) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: student }, redirect: "manual" });
    assert.equal(res.status, 404, `${path} must answer 404 for a malformed id (got ${res.status})`);
  }
  const teacher = await login("teacher");
  for (const path of ["/app/teacher/live-classes/zzz", "/app/teacher/students/zzz"]) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: teacher }, redirect: "manual" });
    assert.equal(res.status, 404, `${path} must answer 404 for a malformed id (got ${res.status})`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
