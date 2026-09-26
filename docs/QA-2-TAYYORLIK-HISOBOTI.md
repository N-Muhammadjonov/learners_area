# Learners Area — QA 2 oldidan yakuniy hisobot

Sana: 2026-09-26 · Branch: `arena/01a0cf7b-learners-area` · HEAD: `07acfae`
Asos: `f679c65` (main bilan bir xil) → 6385d25 → d0fb0c0 → d9514a1 → **07acfae**
Holat jadvali belgilari: ✅ VERIFIED/DONE · 🔧 FIXED · ⚠️ EXTERNALLY UNVERIFIED · ⛔ BLOCKED · ➖ NOT APPLICABLE

---

> **Yangilangan holat (2026-09-26, keyingi commitlar).** Bu hujjat QA 2
> boshlanishidan oldingi tayyorgarlik hisoboti; QA 2 **hali boshlanmagan** va
> bu yerdagi hech bir raqam QA 2 natijasi emas. Oxirgi mahalliy darvozalar:
> `tsc` 0 xato, ESLint 0 ogohlantirish, `npm test` **261 test / 258 o'tdi / 0
> xato / 3 skip**, `npm run build` muvaffaqiyatli, brauzer matritsasi
> **157/157**, Reading mashq maydoni **33/33**, material kompozitori **21/21**,
> admission oqimi **9/9**, `scripts/verify-*.mjs` to'plami yashil
> (`verify-production-schema` mahalliy bazada ataylab 41/42 — seed qilingan 7 demo hisob; productionda 42/42 kutiladi).
> Productionni tekshirish hali bajarilmagan: `docs/MANUAL-CHECK.md` va
> `docs/PRODUCTION-MIGRATSIYA.md` ga qarang.

## 0. Qisqa xulosa

Barcha o'lchanadigan darvozalar yashil:

| Darvoza | Natija |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 xato |
| ESLint (`--max-warnings=0`) | 0 ogohlantirish |
| Unit testlar (`npm test`) | 232 test · 229 o'tdi · **0 xato** · 3 skip |
| Production build (Next 15.5.26) | ✅ 52/52 sahifa |
| HTTP verify skriptlari | **25/25 exit=0 · jami 813 tekshiruv · 0 fail** |
| Brauzer (brend, real Chromium) | 40/40 |
| Brauzer (mikrofon, real MediaRecorder) | 12/12 |

Bugungi sessiyada topilgan va tuzatilgan **uchta haqiqiy nuqson**:

1. **Kritik** — `local` saqlash provayderi obyektlarni `public/uploads/` ichiga yozardi; Next `public/` ni statik beradi, ya'ni sessiyasiz `GET /uploads/<key>` arizachi hujjati yoki talaba yozuvini qaytarardi. Obyekt ildizi web-root tashqarisiga (`.data/uploads`) ko'chirildi va bu ikki tomonlama tekshiruvga (statik yo'l 404/403 **va** fayl `public/` ichida emas) bog'landi.
2. **Yuqori** — Speaking mashqida tayyorgarlik vaqti 0 bo'lgan savolda (har bir Part 1) "Boshlash" tugmasi hech narsa qilmasdi: `setAttemptId()` dan keyin o'sha handler ichida `startRecording()` state'dagi eski `null` ni o'qirdi. Id argument sifatida uzatildi.
3. **O'rta** — ommaviy sahifa sarlavhasi ikki blok qatordan iborat bo'lib, matn sifatida "…next levelwith LEARNERS AREA" o'qilardi (ekran o'quvchi ham shunday eshitardi). Qatorlar orasiga aniq bo'shliq qo'yildi.

Qo'shimcha ravishda: Next 14.2.35 → **15.5.26** + React 19.3.0 (kritik CVE'lar), drizzle-orm 0.36.4 → 0.45.3 (yuqori SQLi advizori), frontend manba xaritalari o'chirildi, `applied_free_text` retention qoidasi qo'shildi, oltita brend PNG o'z joyiga qo'yildi.

---

## (a) 90 bandning kuzatuv jadvali

> Master ro'yxatdagi 46 + 44 band mavzu jihatidan quyidagi 90 qatorga joylashgan; har bir qator "bu band bo'yicha nima bor" degan savolga javob beradi.

### A. Brend va ommaviy kirish (1–6)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 1 | Oltita tasdiqlangan brend PNG `public/brand/` da | Fayllar yo'q edi (sandbox ularni qabul qilmagan) | `assets/learners-area-brand` read-only branch'idan `git show` bilan bayt-bayt ko'chirildi; hech qanday checkout/merge/regeneratsiya yo'q | `tests/brand-assets.test.ts` 6/6 · `verify-brand.mjs` 31/0 | ✅ VERIFIED |
| 2 | Ommaviy landing: sarlavha, bitta CTA, footer | Sarlavha bor edi, matn birlashgan; CTA/footer tekshirilmagan | Matn orasiga bo'shliq; CTA server tomonda hal qilinadi (`/login`|`/dashboard`|`/pending`) | `verify-a11y` (sarlavha) · brauzer 40/0 (CTA 44px+, oltin/navy, fokus halqasi, footer) | 🔧 FIXED |
| 3 | Sidebar brend bloki, tasdiqlangan shior | Mavjud; shior matni bir marta teskari yozilgan | `Brand.brandLine` konfiguratsiyada, test to'g'ri so'z tartibini qulflaydi | `tests/brand-assets.test.ts` | ✅ VERIFIED |
| 4 | Day/Night **haqiqiy fayl** almashinuvi (filtr emas) | Mavjud edi | Brauzerda tungi rejimga o'tib tekshirildi: `mark-light` → `mark-dark`, ikkalasi ham `naturalWidth > 0` | brauzer brand 40/0 · `verify-brand` 31/0 | ✅ VERIFIED |
| 5 | Favicon App Router metadata orqali | Mavjud edi | Rendered `<link rel="icon">` = `/brand/learners-area-favicon.png` | brauzer brand · `verify-pages` | ✅ VERIFIED |
| 6 | Mobil: header'da artefakt yo'q, drawer'da mark; siljish yo'q | Bir marta header'da urinilgan va overflow bergan | 390px va 320px da o'lchandi: header'da rasm yo'q, drawer'da mark, `scrollWidth == clientWidth` | brauzer brand 40/0 · `verify-responsive` 23/0 | ✅ VERIFIED |

### B. Xavfsizlik infratuzilmasi (7–20)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 7 | CSP (`strict-dynamic`, nonce) + HSTS | Mavjud | Har javobda nonce'li CSP; `frame-src` faqat YouTube; `object-src 'none'` | `security-http.test.ts` · `verify-access` | ✅ VERIFIED |
| 8 | CSRF: cookie-auth o'zgartiruvchi so'rovlar | Mavjud | Origin/Referer tekshiruvi middleware'da; begona origin 403 | `security-http.test.ts` 4/4 · `verify-access` | ✅ VERIFIED |
| 9 | Brute-force limitlari (hisob + IP) | Mavjud | Faqat xatolar hisoblanadi; to'g'ri parol bloklanmaydi | `security-http.test.ts` 3/3 | ✅ VERIFIED |
| 10 | Mass-registration limiti | Mavjud | `RULES.register` IP bo'yicha | `verify-browser-flow` 54/0 | ✅ VERIFIED |
| 11 | XSS | Mavjud | React escaping + `dangerouslySetInnerHTML` faqat sanitizatsiya qilingan joyda; embed HTML hech qachon saqlanmaydi | `verify-video-lessons` 17/0 | ✅ VERIFIED |
| 12 | Open redirect | Tuzatilgan | `?next=` faqat ichki yo'l; `safe-redirect.ts` | `tests/safe-redirect.test.ts` | ✅ VERIFIED |
| 13 | SSRF / tashqi URL | Mavjud | Video faqat allowlist hostlar; tashqi link `http(s)` | `verify-video-lessons` · `verify-uploads` | ✅ VERIFIED |
| 14 | Mass assignment | Mavjud | Har endpoint zod `safeParse`; `error: "invalid_input"` | `verify-*` bo'ylab (masalan `verify-vocabulary` 400 holatlari) | ✅ VERIFIED |
| 15 | Upload MIME/active-content siyosati | Mavjud | Allowlist MIME + hajm shiftlari; `Content-Disposition` `inline` faqat xavfsiz turlar uchun | `verify-uploads` 44/0 | ✅ VERIFIED |
| 16 | IDOR (har bir API) | Tuzatilgan (30 handler + 7 sahifa) | `isUuid` → 404; har resurs egasi/roli bo'yicha | `verify-pages` 71/0 · `verify-access` 33/0 | ✅ VERIFIED |
| 17 | Imtiyozli hodisalar auditi | Mavjud | `recordAudit` — admission, rol, ownership, retention, nashr, to'xtatish | `verify-owner` · `verify-publication` · `verify-retention` | ✅ VERIFIED |
| 18 | Tranzaksiya/idempotentlik | Mavjud | Ariza qarori atomik claim; ball ledgeri unikal indeks bilan | `verify-admission-race` 6/0 · `verify-vocabulary` | ✅ VERIFIED |
| 19 | Sir/stack-trace oqmasligi | Mavjud | Rendered sahifalarda sir yo'q; xato chegarasi stack ko'rsatmaydi | `verify-coach` 21/0 (shu jumladan) | ✅ VERIFIED |
| 20 | Frontend-manba minimallashtirish | **Yo'q edi** (source map yoqilgan bo'lishi mumkin) | `productionBrowserSourceMaps: false`, `poweredByHeader: false`; build'da `.map` fayl yo'q, chunk'larda `sourceMappingURL` yo'q | `verify-a11y` 4 tekshiruv · build | 🔧 FIXED |
| 20b | Mahalliy saqlash **web-root tashqarisida** (topilgan kritik nuqson) | `public/uploads/` — statik, sessiyasiz o'qilardi | `.data/uploads` + `STORAGE_LOCAL_DIR`; statik yo'l 404/403; fayl `public/` ichida emas | `verify-uploads` 44/0 (2 yangi tekshiruv) | 🔧 FIXED |

### C. Rollar, admission, OWNER (21–30)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 21 | Birinchi OWNER xavfsiz bootstrap | Mavjud | `scripts/bootstrap-owner.mjs` faol OWNER bo'lsa rad etadi; kodda hardcoded email yo'q | `verify-owner` 10/0 | ✅ VERIFIED |
| 22 | Doim ≥1 OWNER invarianti | Mavjud | `countActiveOwnersIn(tx)` tranzaksiya ichida | `tests/owner-invariant.test.ts` · `verify-owner` | ✅ VERIFIED |
| 23 | Ownership transfer: re-auth, atomik, auditli | Mavjud | Parol qayta so'raladi, tranzaksiya, audit yozuvi | `verify-owner` · `tests/owner-invariant.test.ts` | ✅ VERIFIED |
| 24 | Rol ierarxiyasi server tomonda (OWNER>ADMIN>TEACHER>STUDENT) | Mavjud | Menyu yashirish emas: har so'rovda DB o'qiladi | `verify-access` 33/0 · `verify-pages` | ✅ VERIFIED |
| 25 | Admission: ariza → qaror | Mavjud | Ariza yaratish, navbat, qaror, bildirishnoma | `verify-browser-flow` 54/0 | ✅ VERIFIED |
| 26 | Admission atomik (race) | Tuzatilgan | `.where(id … and status='pending').returning()`; ikkinchi urinish 409 | `verify-admission-race` 6/0 | ✅ VERIFIED |
| 27 | PENDING: minimal ma'lumot | Mavjud | Ro'yxatdan o'tish = faqat ism/email/parol; qo'shimcha maydon yo'q | `verify-browser-flow` | ✅ VERIFIED |
| 28 | REJECTED tozalash siyosati | **Yo'q edi** | Yangi `applicant_free_text` qoidasi: qaror +6 oy → ariza matni, qaror izohi, rad etish sababi tozalanadi; **qaror qatori o'chirilmaydi** | `verify-retention` 10/0 · `tests/retention.test.ts` 10/10 | 🔧 FIXED |
| 29 | Tasdiqdan keyin onboarding | Mavjud | `/onboarding`, `onboarded` sessiyada; PENDING `/pending` ga | `verify-browser-flow` · `verify-pages` | ✅ VERIFIED |
| 30 | Statuslar server tomonda (suspended/stale cookie) | Tuzatilgan | Har so'rovda `requireActiveUser`; eskirgan cookie 401 beradi | `tests/access-control.test.ts` · `verify-access` | ✅ VERIFIED |

### D. CMS va nashr holatlari (31–34)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 31 | 4 holat: DRAFT/SCHEDULED/PUBLISHED/ARCHIVED, bitta qoida | Qisman (`is_active` mantiq) | `src/lib/services/cms/publication.ts` — yagona `isLive()`; migratsiya `0016` | `tests/publication.test.ts` · `verify-publication` 34/0 | ✅ VERIFIED |
| 32 | Bitta endpoint + audit (oldingi/yangi holat) | Yo'q edi | `POST /api/admin/content/:type/:id/publication`, faqat ADMIN/OWNER, o'tish qoidalari, audit | `verify-publication` 34/0 | ✅ VERIFIED |
| 33 | Arxiv-xavfsiz tarix (arxiv o'chirmaydi) | Qisman | Tasdiqlangan: arxivlangan matn tarixda **va** ro'yxatda qoladi (yangi tekshiruv) | `verify-publication` (34) | ✅ VERIFIED |
| 34 | Student ko'rinishlari `liveWhere()` + yaratish nuqtalari | Qisman (ro'yxat filtri darvoza emas) | `getStartablePassage`/`getStartableTest`/prompt/video `isLive()`; arxivlangan id 404 | `verify-publication` · `verify-reading` · `verify-listening` | ✅ VERIFIED |

### E. Lug'at: global ma'lumot vs talaba holati (35–45)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 35 | Bitta umumiy dvigatel | Mavjud (dublikat topilgan va olib tashlangan) | `src/lib/services/vocabulary/engine.ts` — bitta | `verify-vocabulary` 103/0 | ✅ VERIFIED |
| 36 | Global leksik ma'lumot Student holatidan ajratilgan | Mavjud | `lexemes` (global) vs `vocabulary_items` (talaba) | `tests/vocabulary-engine.test.ts` | ✅ VERIFIED |
| 37 | Bitta `LexicalEnrichmentService` | Dublikat bor edi | `src/lib/services/lexical/enrichment.ts` (ikkinchisi olib tashlandi) | `tests/lexical-enrichment.test.ts` 6/6 | ✅ VERIFIED |
| 38 | 60k lug'at adapteri chegarasi tayyor | Mavjud (ro'yxat bo'sh) | Registry + `resolveFromSources`; hech qanday manba ro'yxatdan o'tmagan, katalog birinchi | `tests/lexical-enrichment.test.ts` | ✅ VERIFIED |
| 39 | Soxta ta'rif/IPA yo'q | Mavjud | Manba bilmasa → 422 `needs_definition`, saqlanmaydi | `verify-vocabulary` (422 holati) | ✅ VERIFIED |
| 40 | DB-backed SRS 1/3/7/16/35 | Mavjud | `tests/spaced-repetition` o'rniga engine ichida; server tomonda | `verify-vocabulary` | ✅ VERIFIED |
| 41 | O'yinlar SRS'ni ilgari surmaydi | Tuzatilgan | O'yin javobi `game_answer` beradi, `revision` emas | `tests/vocabulary-engine.test.ts` | ✅ VERIFIED |
| 42 | Server tomonda ball (2/1/1/5) + anti-farming | Tuzatilgan | Mijoz `correct` da'vo qila olmaydi; qat'iy sxema → 400; o'z-o'zini baholash ball bermaydi | `verify-vocabulary` 103/0 | ✅ VERIFIED |
| 43 | Bitta vaqt mintaqasi (Asia/Tashkent) | Mavjud | `points.ts` `dayKey`/`TIMEZONE` ni `@/lib/time` dan oladi | `tests/time.test.ts` · `verify-a11y` | ✅ VERIFIED |
| 44 | Qidiruv normalizatsiyasi | Mavjud | Apostrof variantlari ASCII'ga; kichik/katta harf | `tests/i18n-uz-apostrophe.test.ts` | ✅ VERIFIED |
| 45 | Studentlar o'rtasida oqim yo'q | Mavjud | Har so'rov `userId` bo'yicha; begona so'z ko'rinmaydi | `verify-vocabulary` · `verify-access` | ✅ VERIFIED |

### F. O'quv halqalari (46–60)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 46 | Translation UX: 3–4 javob, xato → bitta misol, keyin to'g'ri → qolganini ochish | Qisman | `lexemes.accepted_translations` (≤4); API sxemasida qabul; `grading.ts` umumiy qoidasi | `verify-vocabulary` · `tests/vocabulary-engine.test.ts` | ✅ VERIFIED |
| 47 | Reading: matn + savollar + tahlil | Mavjud | To'liq oqim + urinish tarixi | `verify-reading` 32/0 | ✅ VERIFIED |
| 48 | Reading retention drill (alohida rejim) | Faqat urinish oxirida edi | `RetentionCheck` + `/reading/retention` + dashboard kartasi; hech narsa baholanmaydi | `verify-dashboard` 21/0 · `verify-reading` | ✅ VERIFIED |
| 49 | Listening: imtihon + revision studio + MCQ mashqi | Mavjud | Bosqichli drill, xato xaritasi, tezlik mashqi | `verify-listening` 45/0 | ✅ VERIFIED |
| 50 | Writing: prompt + topshirish + fikr + typing | Mavjud | Server tomonda o'lchangan typing raqamlari | `verify-writing` 18/0 | ✅ VERIFIED |
| 51 | Speaking: mic → yozuv → yuklash (transkript ixtiyoriy) | Mavjud | Presign→PUT→finalize→attach; transkript o'ylab topilmaydi | `verify-uploads` 44/0 · brauzer mic 12/0 | ✅ VERIFIED |
| 52 | Shadowing: uydirma ball yo'q | Mavjud | Baholash talaba qulog'iga; raqamli "pronunciation score" yo'q | `verify-shadowing` 15/0 | ✅ VERIFIED |
| 53 | Grammar: Correct It / Translate / Activate + mastery | Mavjud | Mastery server tomonda, 3 kun + ~80% qoidasi | `verify-grammar` 32/0 · `tests/grammar-mastery.test.ts` | ✅ VERIFIED |
| 54 | Assignmentlar (topshiriq → baholash) | Mavjud | O'qituvchi baholaydi; yozma ish evaluation'ga delegatsiya | `verify-coach` 21/0 | ✅ VERIFIED |
| 55 | Mock imtihonlar | Mavjud | Mocks sahifasi runner haqida haqiqatni aytadi | `verify-pages` 71/0 | ✅ VERIFIED |
| 56 | Progress sahifasi | Mavjud | Har metrika haqiqiy qatordan | `verify-progress` 19/0 | ✅ VERIFIED |
| 57 | Live klasslar + davomat | Mavjud | Qo'shilish vaqti yoziladi; roster o'qiladi | `verify-live-classes` 24/0 | ✅ VERIFIED |
| 58 | Kurs darsi holat mashinasi + shaxsiy eslatmalar | Mavjud | Server tomonda holat; eslatmalar faqat egasiga | `verify-lessons` 27/0 | ✅ VERIFIED |
| 59 | Video dars oqimi (mualliflik bosqichlari) | Mavjud | `before/transcript/comprehension/gap/vocab/opinion/summary` — faqat yozilganlari | `verify-video-lessons` 17/0 | ✅ VERIFIED |
| 60 | Coach (RIWI) — tashqi AI'siz | Mavjud | RIWI lokal; provayder registry; tashqi kalit bo'lmasa halol aytadi | `verify-coach` 21/0 · `tests/coach-*.test.ts` | ✅ VERIFIED |

### G. YouTube/TED va R2 media (61–70)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 61 | TED/public YouTube embed arxitekturasi | Mavjud | `provider.ts`: faqat video ID saqlanadi, embed HTML **hech qachon** | `verify-video-lessons` | ✅ VERIFIED |
| 62 | Ikki yetkazish yo'li: public YouTube embed / private R2 media | Mavjud | YouTube = iframe `youtube-nocookie`, R2/media = `/api/resources/<key>` (avtorizatsiya) | `verify-video-lessons` · `verify-uploads` | ✅ VERIFIED |
| 63 | Link ekspozitsiyasi minimallashtirilgan, **soxta maxfiylik da'vosi yo'q** | Mavjud | `rel=0`, nocookie; bloklanganda havola ochiladi; "yashirin" deb da'vo qilinmaydi | `verify-video-lessons` | ✅ VERIFIED |
| 64 | Iframe in'ektsiyasiga yo'l yo'q | Mavjud | `video_lessons` da markup ustuni yo'q | `verify-video-lessons` | ✅ VERIFIED |
| 65 | Transkript litsenziya/atribut bilan | Mavjud | `transcriptSource` + `transcriptAttribution` ko'rsatiladi | `verify-video-lessons` | ✅ VERIFIED |
| 66 | Timestamp seek + script-follow | Mavjud | `postMessage` orqali `seekTo`; `data-video-follow-toggle` faqat transkript bo'lsa | `verify-video-lessons` · skript auditi | ✅ VERIFIED |
| 67 | Soxta timestamp yo'q | Mavjud | Vaqtlar faqat muallif kiritgan qatorlarda; avtomatik generatsiya yo'q | `verify-video-lessons` | ✅ VERIFIED |
| 68 | Har bosqich faqat mualliflik qilingani | Mavjud | Bo'sh bosqich ko'rsatilmaydi | `verify-video-lessons` | ✅ VERIFIED |
| 69 | Xususiy media: qisqa muddatli ruxsat | Mavjud | Imzolangan GET 5 daqiqa; `objectKey` hokim, URL emas | `verify-uploads` · README tekshirildi | ✅ VERIFIED |
| 70 | Upload zanjiri: intent→PUT→progress→finalize→HEAD→attach | Mavjud | HEAD verify: tur va hajm mos kelmasa 409 | `verify-uploads` 44/0 | ✅ VERIFIED |

### H. Retention / saqlash siyosati (71–77)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 71 | C–K oynalar: 6/2/18/18 oy, eksport 7 kun | Mavjud | Hammasi env orqali, hujjatlashtirilgan standart bilan | `tests/retention.test.ts` | ✅ VERIFIED |
| 72 | Kurs/biznes kontenti hech qachon avtomatik o'chirilmaydi | Mavjud | Oq ro'yxat faqat talaba ishlab chiqargan jadvallar | `verify-retention` (kontent soni o'zgarmaydi) | ✅ VERIFIED |
| 73 | Scheduler-agnostik, batched, idempotent, lock-aware, dry-run | Mavjud | Advisory lock; `BATCH_SIZE`; preview standart | `verify-retention` 10/0 | ✅ VERIFIED |
| 74 | Nazorat-timestamp testlari | Mavjud | 3 yillik fixture'lar real soat bilan | `verify-retention` | ✅ VERIFIED |
| 75 | Faollik = haqiqiy ish, login emas | Mavjud | `last_meaningful_activity_at` | `verify-retention` | ✅ VERIFIED |
| 76 | Eski ish bahosi bilan himoyalanadi | Mavjud | `evaluations` mavjudligi tekshiriladi | `verify-retention` | ✅ VERIFIED |
| 77 | Ariza matni tozalanadi, qaror yozuvi qoladi | **Yo'q edi** | Yangi qoida 8b (28-band bilan bir xil) | `verify-retention` · `tests/retention.test.ts` | 🔧 FIXED |

### I. Til, tema, qulaylik (78–86)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 78 | UZ/EN i18n, sahifa fayllari dublikatsiz | Mavjud | `Record<Locale, Dictionary>` — kalit yo'qligi `tsc` da tushadi | `tsc` · `verify-pages` | ✅ VERIFIED |
| 79 | ASCII apostrof (U+0027) qattiq darvoza | Mavjud | Manba testi + **rendered sahifa** testi (4 sahifa) | `tests/i18n-uz-apostrophe.test.ts` · `verify-a11y` | ✅ VERIFIED |
| 80 | Nazorat qilinadigan UZ matnda kirill yo'q | Mavjud | Butun repo skani: 0 kirill; rendered sahifalarda ham 0 | `verify-a11y` · skan | ✅ VERIFIED |
| 81 | UTC saqlash + Asia/Tashkent ko'rsatish | Mavjud | Bitta formatter; sahifada `toLocale*` yo'q | `tests/time.test.ts` · `verify-a11y` | ✅ VERIFIED |
| 82 | Day/Night tokenlar orqali, tarqoq hex yo'q | Tuzatilgan | 18 token ikkala rejimda; komponentlarda qattiq rang yo'q | `verify-theme` 32/0 | ✅ VERIFIED |
| 83 | reduced-motion hurmat qilinadi | Mavjud | CSS qoidasi + mazmun ko'rinib qoladi | `verify-a11y` | ✅ VERIFIED |
| 84 | ARIA/fokus | Mavjud | Yorliqli tugmalar, `:focus-visible` halqasi, ijobiy `tabindex` yo'q | `verify-a11y` 41/0 | ✅ VERIFIED |
| 85 | Responsive darajalar | Mavjud | 320/390/768+ o'lchandi; gorizontal siljish yo'q | `verify-responsive` 23/0 · brauzer | ✅ VERIFIED |
| 86 | Locale formatlash (sana/raqam) | Mavjud | Vaqt mintaqasi bilan | `verify-a11y` | ✅ VERIFIED |

### J. Haqqoniylik, gigiena, portativlik (87–90)

| # | Gap / Talab | Oldingi holat | Nima tekshirildi/o'zgardi | Test | Holat |
|---|---|---|---|---|---|
| 87 | README/runbook/env-example haqqoniyligi | Eski stack satri, `db:push` tavsiyasi | Stack = Next 15/React 19; `db:migrate`; verify ro'yxati to'liq; brend holati halol | qo'lda ko'rib chiqildi | 🔧 FIXED |
| 88 | Bog'liqlik gigienasi | Kritik CVE'lar bor edi | Next 15.5.26 + React 19.3.0 + drizzle-orm 0.45.3; qolgan 1 advizor build-time `postcss` (next ichida, request inputiga yetib bormaydi, faqat Next 16 tuzatadi) | `npm audit --omit=dev` · to'liq gates | 🔧 FIXED |
| 89 | Portativlik: bitta `BrandConfig`, `publicBaseUrl` | Mavjud | Nom o'zgarishi DB/route/huquqqa tegmaydi; `site.ts` markazda | `tests/brand-assets.test.ts` · `security-http.test.ts` | ✅ VERIFIED |
| 90 | RIWI V1 saqlangan · V2 boshlanmagan · tashqi AI ulanmagan · billing o'chirilgan | Mavjud | `BILLING_ENABLED=false`, `PUBLIC_PAYMENT_ENABLED=false`, `REAL_AI_ENABLED=false`, `SAT_ENABLED=false`; RIWI lokal | `verify-coach` · `tests/coach-*.test.ts` | ✅ VERIFIED |

---

## (b) Quyi tizim jadvallari

### Git va branch

| Savol | Javob |
|---|---|
| Branch | `arena/01a0cf7b-learners-area` (yagona ish branch'i) |
| Lokal HEAD | `07acfae` |
| Remote HEAD | `07acfae` — **mos** (`git rev-parse` bilan tasdiqlandi) |
| Push turi | Fast-forward (`6385d25..07acfae`), majburiy emas |
| `main` | `f679c65` — **tegilmagan**, merge qilinmagan |
| PR | Ochilmagan (foydalanuvchi talabiga ko'ra) |
| Tarix | Uzluksiz: baseline → … → 6385d25 → d0fb0c0 → d9514a1 → 07acfae |
| `reset-db.mjs` | Untracked, hech qachon stage qilinmaydi |
| Sandbox reset tiklanishi | Ishchi daraxt saqlandi; `.git` bazaga qaytgan edi → remote arena uchiga `reset --soft`, keyin diskdagi to'liq holat yangi commit sifatida (hech narsa yo'qolmagan: `git diff --numstat` bilan tasdiqlandi) |

### Migratsiyalar

| Element | Holat |
|---|---|
| Migratsiya fayllari | `drizzle/0000…0016` (17 fayl) |
| Qo'llash | `npm run db:migrate` — toza bazada 17 tasi ketma-ket qo'llandi |
| Seed | `npm run db:seed` — 7 demo hisob |
| Sxema mosligi | `tsc` + `db:migrate` + barcha verify skriptlari |

### Typecheck / lint / testlar / build

| Darvoza | Buyruq | Natija |
|---|---|---|
| Typecheck | `./node_modules/.bin/tsc --noEmit` | 0 xato |
| Lint | `npx eslint . --ext .ts,.tsx --max-warnings=0` | 0 ogohlantirish |
| Unit testlar | `npm test` | 232 test · 229 o'tdi · 0 xato · 3 skip |
| Build | `npm run build` | ✅ 52/52 sahifa, Next 15.5.26 |
| Verify skriptlari | 25 ta | 25/25 exit=0 · **813 tekshiruv · 0 fail** |
| Brauzer (brend) | real Chromium | 40/0 |
| Brauzer (mikrofon) | real MediaRecorder + fake audio | 12/0 |

### Asosiy quyi tizimlar

| Quyi tizim | Bitta javobgar fayl/modul | Tekshiruv |
|---|---|---|
| Admission | `src/lib/data/admission.ts` (+ `0016` emas, `0003`) | `verify-admission-race` 6/0, `verify-browser-flow` 54/0 |
| Owner bootstrap/transfer | `scripts/bootstrap-owner.mjs`, `src/lib/auth/ownership.ts`, `owner-invariant.ts` | `verify-owner` 10/0, `tests/owner-invariant.test.ts` |
| Rollar/statuslar | `src/lib/auth/current-user.ts`, `roles.ts`, `account-status.ts` | `verify-access` 33/0, `tests/access-control.test.ts` |
| Flags | `src/lib/config/flags.ts` | `tests/security-http.test.ts` |
| CMS nashr | `src/lib/services/cms/publication.ts` | `verify-publication` 34/0 |
| Teacher/Admin/Owner yuzalar | `src/app/(app)/{teacher,admin,owner}/*` | `verify-pages` 71/0 |
| Leksema/talaba holati | `src/lib/services/vocabulary/engine.ts` + `lexemes`/`vocabulary_items` | `verify-vocabulary` 103/0 |
| Lug'at adapteri | `src/lib/services/lexical/enrichment.ts` | `tests/lexical-enrichment.test.ts` 6/6 |
| 7 lug'at rejimi / SRS / leaderboard / qidiruv | `engine.ts`, `grading.ts`, `points.ts`, `packs.ts` | `verify-vocabulary` 103/0 |
| Translation | `lexemes.accepted_translations` + `grading.ts` | `verify-vocabulary` |
| Reading | `src/lib/data/reading.ts` + `RetentionCheck.tsx` | `verify-reading` 32/0 |
| Listening | `src/lib/data/listening.ts` + `mcq-mastery.ts` | `verify-listening` 45/0 |
| Writing | `src/lib/data/writing.ts` + `TypingTrainer` | `verify-writing` 18/0 |
| Speaking/mic | `src/lib/audio/recorder.ts` + `PracticeStudio.tsx` | `verify-uploads` 44/0, brauzer mic 12/0 |
| Grammar | `src/lib/services/grammar/mastery.ts` | `verify-grammar` 32/0 |
| Assignments | `src/app/api/assignments/*` | `verify-coach` 21/0 |
| Mocks | `src/lib/data/mocks.ts` | `verify-pages` |
| Progress | `src/lib/data/progress.ts` | `verify-progress` 19/0 |
| Live classes | `src/lib/services/live-classes/*` | `verify-live-classes` 24/0 |
| YouTube darslar | `src/lib/services/video/provider.ts` + `VideoLessonStudio.tsx` | `verify-video-lessons` 17/0 |
| Timestamp/script-follow | `VideoLessonStudio.tsx` (`postMessage` seek) | `verify-video-lessons` |
| Media yetkazish | `src/app/api/resources/[...key]/route.ts` | `verify-uploads` 44/0 |
| Upload/CORS/keys | `src/lib/uploads/keys.ts`, `src/lib/data/uploads.ts`, `s3-provider.ts` | `verify-uploads` |
| Xavfsizlik sarlavhalari/CSRF/limit/XSS/IDOR | `security-headers.ts`, `request-origin.ts`, `rate-limit.ts` | `tests/security-http.test.ts`, `verify-access` |
| Retention | `src/lib/services/retention.ts` | `verify-retention` 10/0, `tests/retention.test.ts` 10/10 |
| SEO/noindex | `src/app/robots.ts`, `sitemap.ts`, private layout metadata | `verify-a11y`, `verify-pages` |
| Brend/portativlik | `src/lib/config/brand.ts`, `site.ts`, `BrandLogo.tsx` | `verify-brand` 31/0, brauzer 40/0 |
| Handover/runbook | README ("Deploying for real", "Backup and recovery") | qo'lda |
| Backup/recovery | README protsedurasi (`pg_dump` + R2 + `db:migrate`) | ⚠️ real muhitda bajarilmagan |
| UZ/EN + apostrof | `src/lib/i18n/{en,uz}.ts`, normalizatorlar | `tests/i18n-uz-apostrophe.test.ts`, `verify-a11y` |
| Day/Night | `src/app/globals.css` tokenlar + `ThemeToggle.tsx` | `verify-theme` 32/0, brauzer |
| Responsive | `Sidebar`/`MobileNav`/layoutlar | `verify-responsive` 23/0, brauzer 320/390 |
| Accessibility | butun qobiq | `verify-a11y` 41/0 |
| RIWI V1 regressiyasi | `src/lib/services/coach/*` | `verify-coach` 21/0, 4 unit fayl |

---

## (c) Tashqi tizimlar — tekshirilmagan (halol ro'yxat)

| # | Tizim | Nima tekshirildi (lokal) | Nima **tekshirilmadi** | Holat |
|---|---|---|---|---|
| 1 | **Supabase / boshqariladigan Postgres** | Sxema, 17 migratsiya, seed, barcha so'rovlar lokal PostgreSQL 18.4 da ishlaydi | Boshqariladigan hosting, ulanish cheklovlari, backup/restore, TLS | ⚠️ EXTERNALLY UNVERIFIED |
| 2 | **Cloudflare R2 + CORS** | `r2`/`s3` provayderi, presign→PUT→finalize→HEAD→attach zanjiri `local` provayderda; CORS siyosati README'da aniq (`*` yo'q) | Real bucket, real CORS javobi, real imzolangan URL, xususiy o'qish | ⚠️ EXTERNALLY UNVERIFIED |
| 3 | **Telegram login** | Server tomonda `verifyTelegramPayload`; widget payload tekshiriladi; yoqilmagan | Bot tokeni, real widget oqimi, domain ro'yxati | ⚠️ EXTERNALLY UNVERIFIED (kalit yo'q) |
| 4 | **Email (parolni tiklash)** | Oqim va limitlar mavjud; yuborish adaptori | Real SMTP provayderi | ⚠️ EXTERNALLY UNVERIFIED (kalit yo'q) |
| 5 | **Tashqi AI (OpenAI/Anthropic/Gemini)** | Bitta provayder-agnostik adapter; RIWI lokal ishlaydi | Hech qanday tashqi model **ataylab** ulanmagan | ➖ NOT APPLICABLE (talab bo'yicha o'chirilgan) |
| 6 | **STT (nutqni matnga)** | `STT_PRIMARY_PROVIDER=none`; transkript yo'qligi halol aytiladi | Real transkripsiya provayderi | ⚠️ EXTERNALLY UNVERIFIED (provayder yo'q) |
| 7 | **YouTube/TED metadata** | Video ID parseri, embed URL qurilishi, bloklanish holati | Tashqi `oembed` chaqiruvi (sandbox'da tashqi tarmoq yo'q) | ⚠️ EXTERNALLY UNVERIFIED |
| 8 | **Billing / to'lov** | Sxema bor, flaglar o'chiq | Hech qanday to'lov oqimi yo'q | ➖ NOT APPLICABLE (talab bo'yicha) |

---

## Qolgan ma'lum cheklovlar (yashirilmagan)

1. **Bitta nested build-time advizor**: `next` ichidagi `postcss` nusxasi (`npm audit`: high). Tailwind CSS kompilyatsiyasida, faqat build vaqtida ishlaydi; request inputiga yetib bormaydi. `npm audit fix --force` faqat Next 16 major'ga o'tkazadi. Halol yozib qo'yildi (README → Stack).
2. **Seed qilingan video qatorlari** tashqi `oembed` bilan tasdiqlanmagan (tarmoq yo'q) — skript buni ochiq ogohlantiradi.
3. **Brauzer tekshiruvlari** (brend 40/0, mic 12/0) repodagi CI'da emas: ular Chromium + `puppeteer-core` talab qiladi (ataylab loyiha bog'liqligi emas). Skript repoda bor va ishga tushirish yo'riqnomasi yozilgan.

---

**READY FOR QA 2**
