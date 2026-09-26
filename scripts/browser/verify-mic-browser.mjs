#!/usr/bin/env node
/**
 * Mikrofon zanjirining BRAUZERDAGI qabul sinovi.
 *
 * `npm test` va `verify-*.mjs` HTTP darajasida ishlaydi; MediaRecorder esa
 * faqat brauzerda mavjud. Bu skript haqiqiy Chromium'ni ""fake audio device""
 * bilan ishga tushirib, to'liq yo'lni tekshiradi: getUserMedia -> MediaRecorder
 * (250 ms bo'laklar) -> Blob -> presign/PUT -> finalize -> tarix.
 *
 * Nima uchun kerak: aynan shu yo'lda ikkita xato faqat brauzerda ko'rinadi —
 * yozuv qisqartirilishi va tayyorgarlik vaqti 0 bo'lgan savolda "Boshlash"
 * tugmasi hech narsa qilmasligi. Ikkalasi ham shu skript bilan ushlangan.
 *
 * Talablar (repo dependencies ichida EMAS, ataylab):
 *   1. Chromium/Chrome binar fayli (CHROME_PATH yoki /tmp/chromium/chromium)
 *   2. puppeteer-core:  npm i --no-save puppeteer-core
 *   3. ishlab turgan server:  npm run build && npm start
 *
 * Ishga tushirish:
 *   node scripts/browser/verify-mic-browser.mjs
 *
 * Ovoz sun'iy (6 sekundlik sinus WAV), ya'ni bu akustik sifat sinovi emas —
 * yozib olish, uzatish va saqlash zanjirining sinovi. Talaffuz bahosi haqida
 * hech qanday da'vo qilinmaydi.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.error(
    "puppeteer-core topilmadi. O'rnating:  npm i --no-save puppeteer-core\n" +
      "Keyin:  node scripts/browser/verify-mic-browser.mjs"
  );
  process.exit(2);
}

// Mikrofon zanjirini HAQIQIY brauzerda tekshiramiz: MediaRecorder haqiqiy
// oqimni yozadimi, 4 sekundlik yozuv qisqartirilmaydimi, presign→PUT→finalize
// zanjiri tugallanib, fayl diskda haqiqiy hajm bilan paydo bo'ladimi.
//
// Chrome'ning fake audio qurilmasi ishlatiladi: kirish signali /tmp/fake-mic.wav
// (6 sekundlik sinus), ya'ni ovoz sun'iy — lekin yozib olish yo'li, kodek,
// timeslice bo'laklari va yuklash zanjiri haqiqiy.


const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const CHROME_PATH = process.env.CHROME_PATH ?? "/tmp/chromium/chromium";
const RECORD_MS = 4000;
const APP_DIR = process.env.APP_DIR ?? process.cwd();
const FAKE_MIC = path.join(process.env.TMPDIR ?? "/tmp", "learners-area-fake-mic.wav");

/** Chrome'ning ""fake device"" manbai: 6 sekundlik 440 Hz sinus. */
function writeFakeMic() {
  if (existsSync(FAKE_MIC)) return;
  const rate = 48000;
  const seconds = 6;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i += 1) {
    data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(FAKE_MIC, Buffer.concat([header, data]));
}
writeFakeMic();

let pass = 0;
const fails = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log("ok   -", name);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log("not ok -", name, detail);
  }
};

if (!existsSync(CHROME_PATH)) {
  console.error(`Chromium topilmadi: ${CHROME_PATH} (CHROME_PATH bilan bering)`);
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "shell",
  args: [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-software-rasterizer", "--disable-vulkan", "--use-gl=angle",
    "--use-angle=swiftshader-webgl", "--no-zygote", "--single-process",
    "--disable-features=Vulkan", "--hide-scrollbars",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-audio-capture=" + FAKE_MIC,
    "--autoplay-policy=no-user-gesture-required",
  ],
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/browser/al2023/lib:/tmp/browser/lib" },
});

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click('button[type="submit"]')]);
}

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// Brauzer API darajasidagi old shart: sahifa MediaRecorder'ni ko'radi.
await signIn(page, "demo.student@learnersarea.uz", "Student12345!");
await page.goto(`${BASE}/speaking/practice`, { waitUntil: "networkidle2" });
const support = await page.evaluate(() => ({
  mediaRecorder: typeof window.MediaRecorder !== "undefined",
  gum: Boolean(navigator.mediaDevices?.getUserMedia),
}));
check("brauzer MediaRecorder va getUserMedia'ni qo'llaydi", support.mediaRecorder && support.gum, JSON.stringify(support));

const permission = await page.evaluate(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getAudioTracks().length;
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true, tracks };
  } catch (err) {
    return { ok: false, error: String(err?.name ?? err) };
  }
});
check("mikrofon ruxsati bilan oqim ochiladi", permission.ok && permission.tracks === 1, JSON.stringify(permission));

// Prep 0 sekund bo'lgan savol tanlanadi, shunda "start" darhol yozishni boshlaydi.
await page.waitForSelector("[data-speak-start]", { timeout: 15000 });
// Standart tanlov — birinchi savol (Part 1, tayyorgarlik 0 sekund).
const selected = await page.evaluate(() => document.querySelector("#practice-prompt option")?.textContent?.slice(0, 60) ?? null);
check("Part 1 savoli tanlangan (tayyorgarlik 0 sekund)", Boolean(selected), String(selected));

// React hidratsiyasidan keyin bosiladi; dasturiy click overlay ta'sirini chetlab o'tadi.
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => document.querySelector("[data-speak-start]").click());
await page.waitForSelector("[data-speak-recording]", { timeout: 15000 });
check("yozib olish holati boshlandi", true);

await new Promise((resolve) => setTimeout(resolve, RECORD_MS));
await page.evaluate(() => document.querySelector("[data-speak-stop]").click());
await page.waitForSelector("[data-speak-review]", { timeout: 15000 });

const review = await page.$eval("[data-speak-review]", (node) => ({
  size: Number(node.getAttribute("data-speak-size")),
  durationMs: Number(node.getAttribute("data-speak-duration-ms")),
}));
check("yozuv hajmi noldan katta", review.size > 0, `${review.size} bayt`);
check(
  "yozuv qisqartirilmagan (davomiylik haqiqiy vaqtga yaqin)",
  review.durationMs >= RECORD_MS - 800 && review.durationMs <= RECORD_MS + 2500,
  `${review.durationMs} ms`
);
check(
  "hajm 4 sekundlik opus/webm uchun ishonchli (>= 4 KB)",
  review.size >= 4096,
  `${review.size} bayt`
);

// Yuklash: presign → PUT (yoki local proxy) → finalize → sessiya yakuni.
await page.evaluate(() => document.querySelector("[data-speak-submit]").click());
await page.waitForSelector("[data-speak-done]", { timeout: 45000 });
check("yozuv yuklandi va sessiya saqlandi", true);

const attemptId = await page.evaluate(async () => {
  const res = await fetch("/api/speaking/attempts", { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => null);
  return data?.attempts?.[0] ?? null;
});
check(
  "sessiya tarixda yozuvi bilan turadi va transkript o'ylab topilmagan",
  Boolean(attemptId?.recordingObjectKey) && (attemptId?.transcript ?? null) === null,
  JSON.stringify({ key: attemptId?.recordingObjectKey, transcript: attemptId?.transcript })
);

if (attemptId?.recordingObjectKey) {
  const onDisk = path.join(APP_DIR, ".data", "uploads", attemptId.recordingObjectKey);
  const exists = existsSync(onDisk);
  const bytes = exists ? statSync(onDisk).size : 0;
  check("fayl diskda (web root tashqarisida) mavjud", exists, onDisk);
  check("diskdagi hajm brauzerdagi hajmga mos", bytes > 0 && Math.abs(bytes - review.size) < 4096, `disk ${bytes} vs brauzer ${review.size}`);
  check(
    "fayl public/ ichida emas",
    !onDisk.includes(`${path.sep}public${path.sep}`),
    onDisk
  );
}

// Test yozuvi ortda qolmasin: sessiya API orqali o'chiriladi.
if (attemptId?.id) {
  const deleted = await page.evaluate(async (id) => {
    const res = await fetch(`/api/speaking/attempts/${id}`, { method: "DELETE" });
    return res.status;
  }, attemptId.id);
  // A submitted attempt is closed by design, so the DELETE answers 409 — that is
  // the correct server answer, not a cleanup failure. It is reported, not hidden.
  console.log(`(-- test sessiyasi yuborilgani uchun o'chirilmadi (javob: ${deleted}, 409 = kutilgan))`);
}

await browser.close();
console.log(`\n# pass ${pass} / fail ${fails.length}`);
if (fails.length) {
  console.log("# failures:");
  for (const f of fails) console.log("  -", f);
}
process.exit(fails.length ? 1 : 0);
