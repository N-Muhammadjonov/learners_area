#!/usr/bin/env node
/**
 * Ro'yxatdan o'tish formasi BRAUZERDAGI qabul sinovi.
 *
 * Nima uchun alohida sinov: xato faqat brauzerda ko'rinadi va faqat *holat*
 * sifatida ko'rinadi — "tugma 'Yuklanmoqda…' da qolib ketdi". Server 500
 * qaytargani log'da bor, lekin foydalanuvchi ko'rgan narsa shu. `npm test`
 * yuklanish holatini boshqaradigan React komponentini ishga tushirmaydi, shuning
 * uchun bu yerda haqiqiy Chromium, haqiqiy build va haqiqiy DOM kuzatuvi bor.
 *
 * Tekshiriladi:
 *   A) API HTML 500 qaytarsa      -> tugma qayta bosiladi, xato ko'rinadi
 *   B) tarmoq uzilsa              -> xuddi shunday
 *   C) haqiqiy muvaffaqiyat       -> /pending kutish xonasiga o'tadi
 *   D) migratsiyasiz baza (503)   -> xato ko'rinadi, tugma qotmaydi
 *
 * Talablar (repo dependencies ichida EMAS, ataylab):
 *   1. Chromium/Chrome binar fayli (CHROME_PATH yoki /tmp/chromium/chromium)
 *   2. puppeteer-core:  npm i --no-save puppeteer-core
 *   3. ishlab turgan server:  npm run build && npm start  (3000)
 *      va migratsiya qilinmagan bazaga ulangan ikkinchi nusxa (3001) — D holati
 *
 * Ishga tushirish:
 *   node scripts/browser/verify-register-ux.mjs
 */

import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/tmp/chromium/chromium";
const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const UNMIGRATED = process.env.UNMIGRATED_APP_URL ?? "http://127.0.0.1:3001";
const PASS = "\u001b[32mPASS\u001b[0m";
const FAIL = "\u001b[31mFAIL\u001b[0m";
let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ${PASS}  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  ${FAIL}  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const LOADING = ["Yuklanmoqda", "Loading", "Yuklanmoqda…", "Loading…"];
const NETWORK_MSG = "Serverga ulanib bo'lmadi";
const SERVER_MSG = "Xizmat vaqtincha ishlamayapti";

async function submitAndObserve(page, label) {
  // Yuklanish holati bir kadrda paydo bo'lib yo'qolishi mumkin (masalan, javob
  // darhol kelganda), shuning uchun uni oldindan o'rnatilgan kuzatuvchi bilan
  // qayd qilamiz — "ko'rdim/ko'rmadim" emas, "DOM'da bo'ldimi".
  await page.evaluate((words) => {
    const form = document.querySelector("form");
    const button = form?.querySelector('button[type="submit"]');
    window.__observed = { sawLoading: false };
    const inspect = () => {
      if (!button) return;
      if (button.disabled || words.some((w) => button.textContent.includes(w))) window.__observed.sawLoading = true;
    };
    inspect();
    new MutationObserver(inspect).observe(form, { subtree: true, childList: true, characterData: true, attributes: true });
  }, LOADING);

  await page.evaluate(() => {
    const form = document.querySelector("form");
    const button = form?.querySelector('button[type="submit"]');
    button?.click();
  });

  // Endi u albatta qaytishi kerak.
  const recovered = await page
    .waitForFunction(
      (words) => {
        const b = document.querySelector('form button[type="submit"]');
        return b && !b.disabled && !words.some((w) => b.textContent.includes(w));
      },
      { timeout: 8000 },
      LOADING
    )
    .then(() => true)
    .catch(() => false);
  check(`${label}: tugma qayta bosiladigan holatga qaytdi`, recovered);

  const sawLoading = await page.evaluate(() => Boolean(window.__observed?.sawLoading));
  check(`${label}: tugma yuklanish holatiga o'tdi (DOM kuzatuvi)`, sawLoading);

  const state = await page.evaluate(() => {
    const b = document.querySelector('form button[type="submit"]');
    const err = document.querySelector('form [role="alert"], form .field-error, form p.text-band-bad, form [data-error]');
    return {
      disabled: b?.disabled ?? null,
      text: (b?.textContent ?? "").trim(),
      error: (err?.textContent ?? "").trim(),
    };
  });
  check(`${label}: tugma matni endi yuklanish emas`, !LOADING.some((w) => state.text.includes(w)), `matn: "${state.text}"`);
  return state;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/browser/lib" },
});

try {
  const page = await browser.newPage();

  // ---------- A) API HTML 500 qaytaradi ----------
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/auth/register")) {
      if (globalThis.__mode === "html500") {
        return req.respond({ status: 500, contentType: "text/html", body: "<html><body>Internal Server Error</body></html>" });
      }
      if (globalThis.__mode === "abort") return req.abort("failed");
    }
    req.continue();
  });

  globalThis.__mode = "html500";
  await page.goto(`${APP}/register`, { waitUntil: "networkidle2" });
  await page.waitForSelector('form button[type="submit"]');
  const stamp = Date.now();
  await page.type("#name", "Non-JSON Fail");
  await page.type("#email", `nonjson.${stamp}@example.uz`);
  await page.type("#password", "NonJson-2026-Pass!");
  const a = await submitAndObserve(page, "A) HTML 500");
  check("A) foydalanuvchiga aniq xato ko'rsatildi", a.error.includes(SERVER_MSG), `xato: "${a.error}"`);

  // ---------- B) tarmoq uzilishi ----------
  globalThis.__mode = "abort";
  await page.goto(`${APP}/register`, { waitUntil: "networkidle2" });
  await page.waitForSelector('form button[type="submit"]');
  await page.type("#name", "Network Fail");
  await page.type("#email", `netfail.${stamp}@example.uz`);
  await page.type("#password", "NetFail-2026-Pass!");
  const b = await submitAndObserve(page, "B) tarmoq uzilishi");
  check("B) xato tarmoq haqida", b.error.includes(NETWORK_MSG), `xato: "${b.error}"`);

  // ---------- C) haqiqiy muvaffaqiyat ----------
  globalThis.__mode = "real";
  await page.goto(`${APP}/register`, { waitUntil: "networkidle2" });
  await page.waitForSelector('form button[type="submit"]');
  const realEmail = `browser.qa.${stamp}@example.uz`;
  await page.type("#name", "Browser QA");
  await page.type("#email", realEmail);
  await page.type("#password", "BrowserQa-2026-Pass!");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null),
    page.evaluate(() => document.querySelector('form button[type="submit"]')?.click()),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
  const after = await page.evaluate(() => ({ url: location.pathname, body: document.body.innerText.slice(0, 400) }));
  check("C) muvaffaqiyatli hisob /pending ga o'tdi", after.url === "/pending", `url: ${after.url}`);
  check("C) kutish xonasi matni ko'rinadi", /tasdiq|ko'rib chiq|pending/i.test(after.body), after.body.replace(/\s+/g, " ").slice(0, 90));

  // ---------- D) migratsiyasiz baza (503) ----------
  const page2 = await browser.newPage();
  await page2.goto(`${UNMIGRATED}/register`, { waitUntil: "networkidle2" });
  await page2.waitForSelector('form button[type="submit"]');
  await page2.type("#name", "Unmigrated DB");
  await page2.type("#email", `unmigrated.${stamp}@example.uz`);
  await page2.type("#password", "Unmigrated-2026-Pass!");
  const d = await submitAndObserve(page2, "D) migratsiyasiz baza (503)");
  check("D) xizmat javobi tushunarli xatoga aylandi", d.error.includes(SERVER_MSG), `xato: "${d.error}"`);

  console.log(`\n${failed === 0 ? PASS : FAIL} — ${passed}/${passed + failed} tekshiruv o'tdi, ${failed} muvaffaqiyatsiz\n`);
} finally {
  await browser.close();
}
process.exit(failed === 0 ? 0 : 1);
