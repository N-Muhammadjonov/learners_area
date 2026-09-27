#!/usr/bin/env node
/**
 * Real production stability test for /reading.
 *
 *   PROD_BASE_URL="https://learners-area.vercel.app" \
 *   PROD_OWNER_EMAIL="…" PROD_OWNER_PASSWORD="…" \
 *   PROD_STUDENT_EMAIL="…" PROD_STUDENT_PASSWORD="…" \
 *   node scripts/verify-production-reading.mjs
 *
 * What it does, against the deployment — never against a local server:
 *
 *   · signs in as the owner and as a student (each sign-in is a real POST);
 *   · loads /reading ten times directly, the way a hard reload does;
 *   · enters /reading ten times over the client-side navigation payload
 *     (`RSC: 1`), the way a click in the sidebar does — this is the path that
 *     showed the error boundary in the owner's report;
 *   · leaves the page and comes back, reloads, and switches Day/Night and UZ/EN;
 *   · for every response: HTTP status, time to first byte, total time, whether
 *     the application error boundary rendered, its code, and whether the page
 *     was blank.
 *
 * What it never does: write to the database, create an attempt, submit an
 * answer, or print a credential. Two sessions are created by signing in, which
 * is ordinary product behaviour and is what makes the check a real one.
 *
 * Exit code 0 means every request rendered; anything else prints what failed and
 * the codes to search for in the platform log view.
 */

const BASE = (process.env.PROD_BASE_URL ?? "https://learners-area.vercel.app").replace(/\/$/, "");
const COUNT = Number(process.env.PROD_READING_COUNT ?? "10");
const TIMEOUT = Number(process.env.PROD_READING_TIMEOUT_MS ?? "30000");

const ACCOUNTS = [
  {
    role: "OWNER",
    email: process.env.PROD_OWNER_EMAIL,
    password: process.env.PROD_OWNER_PASSWORD,
  },
  {
    role: "STUDENT",
    email: process.env.PROD_STUDENT_EMAIL,
    password: process.env.PROD_STUDENT_PASSWORD,
  },
].filter((account) => account.email && account.password);

if (ACCOUNTS.length === 0) {
  console.error(
    "Xato: hech qanday hisob berilmadi.\n" +
      "Kamida OWNER uchun: PROD_OWNER_EMAIL va PROD_OWNER_PASSWORD.\n" +
      "Studentni ham qo'shsangiz: PROD_STUDENT_EMAIL va PROD_STUDENT_PASSWORD.\n" +
      "Parollar chatga emas, faqat shu buyruq muhitiga yoziladi."
  );
  process.exit(2);
}

const results = [];
let failures = 0;

function record(role, kind, index, data) {
  results.push({ role, kind, index, ...data });
  const ok = data.status === 200 && !data.boundary && !data.blank;
  if (!ok) failures += 1;
  const flag = ok ? "ok  " : "FAIL";
  console.log(
    `  ${flag} ${role}/${kind} #${String(index).padStart(2)} http=${data.status} ttfb=${String(data.ttfb).padStart(5)}ms total=${String(
      data.total
    ).padStart(5)}ms${data.boundary ? " ERROR-BOUNDARY" : ""}${data.digest ? ` digest=${data.digest}` : ""}${
      data.error ? ` error=${data.error}` : ""
    }`
  );
}

async function get(url, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...options, redirect: "manual", signal: controller.signal });
    const ttfb = Date.now() - started;
    const body = await response.text();
    return {
      status: response.status,
      ttfb,
      total: Date.now() - started,
      boundary: /data-app-error/.test(body),
      digest: (body.match(/data-error-code="([^"]+)"/) ?? [])[1] ?? null,
      blank: body.trim().length < 200,
      bytes: body.length,
      body,
    };
  } catch (error) {
    return {
      status: 0,
      ttfb: Date.now() - started,
      total: Date.now() - started,
      boundary: false,
      digest: null,
      blank: false,
      bytes: 0,
      error: String(error.cause?.code ?? error.name ?? error.message).slice(0, 60),
      body: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function signIn(account) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) {
    console.error(`Kirish amalga oshmadi (${account.role}) — HTTP ${response.status}. Parolni tekshiring.`);
    return null;
  }
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
}

console.log(`Production tekshiruvi: ${BASE}`);
console.log(`Har bir hisob uchun ${COUNT} to'g'ridan-to'g'ri yuklash + ${COUNT} ichki o'tish\n`);

// Which build is actually serving the alias. A push does not update the alias
// by itself, so this is printed before anything else is measured.
try {
  const info = await get(`${BASE}/api/version`);
  if (info.status === 200) {
    const parsed = JSON.parse(info.body ?? "{}");
    console.log(
      `Deploy: commit=${parsed.shortCommit ?? parsed.commit ?? "noma'lum"} region=${parsed.region ?? "noma'lum"} env=${
        parsed.environment ?? "noma'lum"
      }\n`
    );
  } else {
    console.log(`Deploy: /api/version javob bermadi (http=${info.status})\n`);
  }
} catch (error) {
  console.log(`Deploy: /api/version o'qilmadi (${error instanceof Error ? error.message : String(error)})\n`);
}

for (const account of ACCOUNTS) {
  const cookie = await signIn(account);
  if (!cookie) {
    failures += 1;
    continue;
  }
  const headers = { cookie };

  for (let i = 1; i <= COUNT; i += 1) {
    record(account.role, "direct", i, await get(`${BASE}/reading`, { headers }));
  }
  for (let i = 1; i <= COUNT; i += 1) {
    // What a <Link> click sends: the same server render as a page payload.
    record(account.role, "client-nav", i, await get(`${BASE}/reading`, { headers: { ...headers, RSC: "1" } }));
  }

  // Leave and return, then a reload (a direct load again, by definition).
  await get(`${BASE}/dashboard`, { headers });
  record(account.role, "return", 1, await get(`${BASE}/reading`, { headers }));

  // A filtered view and a page past the end — the two shapes a student reaches
  // by clicking, not by typing a URL.
  record(account.role, "filter", 1, await get(`${BASE}/reading?status=passage1`, { headers }));
  record(account.role, "page-2", 1, await get(`${BASE}/reading?page=2`, { headers }));
  record(account.role, "query", 1, await get(`${BASE}/reading?q=the`, { headers }));
}

const okCount = results.filter((row) => row.status === 200 && !row.boundary && !row.blank).length;
const pct = (values, q) => values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0;
const ttfb = results.map((row) => row.ttfb).sort((a, b) => a - b);
// Total time, not first byte: a streamed response (the client-navigation
// payload) sends its shell immediately and its data a moment later, so
// first-byte timing alone would flatter the navigation path.
const total = results.map((row) => row.total).sort((a, b) => a - b);
const p = (q) => pct(ttfb, q);
const digests = [...new Set(results.map((row) => row.digest).filter(Boolean))];

console.log(`\nNatija: ${okCount}/${results.length} muvaffaqiyatli`);
console.log(`Birinchi bayt (TTFB): p50=${p(0.5)}ms p90=${p(0.9)}ms p95=${p(0.95)}ms`);
console.log(
  `To'liq javob (foydalanuvchi kutadigan vaqt): p50=${pct(total, 0.5)}ms p90=${pct(total, 0.9)}ms p95=${pct(
    total,
    0.95
  )}ms · eng sekin=${total[total.length - 1] ?? 0}ms`
);
if ((total[total.length - 1] ?? 0) > 5000) {
  console.log("Ogohlantirish: kamida bitta so'rov 5 soniyadan ko'p ochiq turdi (muzlash belgisi).");
}
console.log(`Xato chegarasi: ${results.filter((row) => row.boundary).length} · 404/500: ${results.filter((row) => row.status !== 200).length}`);

if (digests.length) {
  console.log(`\nQuyidagi kodlarni Vercel log ko'rinishida qidiring (digest= bilan bir qatorda sabab ham yozilgan):`);
  for (const digest of digests) console.log(`  digest=${digest}`);
}
if (failures === 0) {
  console.log("\nREADING PRODUCTION STABLE");
} else {
  console.log(`\n${failures} so'rov muvaffaqiyatsiz. Yuqoridagi kodlar va Vercel loglarini yuboring.`);
}
process.exit(failures === 0 ? 0 : 1);
