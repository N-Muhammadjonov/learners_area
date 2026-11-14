# SALE_READY_MANUAL_ACTIONS — egasi bajaradigan yagona ro'yxat

**Branch:** `arena/c9f21950-learners-area` · **Sana:** 2026-11-14
**Qoida:** Barcha tashqi/qo'lda bajariladigan majburiyatlar **faqat shu faylda**. Boshqa
hujjatlarda egaga topshiriq yozilmaydi. Kod bilan yopish mumkin bo'lgan hech narsa bu yerga
ko'chirilmagan — muhandislik ishi muhandislikda qoldi.

## Holat (objektiv hisob)

| Tur | Soni | Izoh |
|---|---:|---|
| **Sale blockers** (sotuvni to'sadi) | **7** | MA-01 … MA-05, MA-07, MA-12 |
| **Pilot blockers** (pilotni to'sadi) | **4** | MA-06, MA-09, MA-10, MA-13 |
| **Optional / kelajak** | **1** | MA-11 (biometrik — hozircha **o'chiq** qolishi shart) |
| Jami | **12** | |

**Umumiy xulosa:** platforma kod tomonidan sotuvga yaqin, lekin **hech bir qator
production'da isbotlanmagan**. Quyidagi 7 ta sale blocker yopilmaguncha "EVERYTHING IS READY"
deyish **noto'g'ri** bo'ladi.

**Jadval formati haqida:** talab qilingan 15 ustun bitta keng jadvalga sig'maydi, shuning uchun
yuqorida qisqa indeks, pastda har bir element uchun barcha 15 maydonni o'z ichiga olgan blok
berilgan. `ID` orqali bog'lanadi.

## Indeks

| ID | Prioritet | To'suvchi? | Modul | Qisqa harakat | Status |
|---|---|---|---|---|---|
| MA-01 | P0 | **Ha — sale** | To'lovlar | Click yoki Payme merchant hisobini ochish va kalitlarni berish | `OPEN` |
| MA-02 | P0 | **Ha — sale** | Moliya | Hisob siyosati va chart-of-accounts moslashtiruvini tasdiqlash | `OPEN` |
| MA-03 | P0 | **Ha — sale** | Migratsiya | `1115_tuition_finance.sql` ni production bazaga qo'llashga ruxsat | `OPEN` |
| MA-04 | P0 | **Ha — sale** | Media/R2 | Cloudflare R2 kalitlari va bucket siyosati | `OPEN` |
| MA-05 | P0 | **Ha — sale** | Ota-ona Telegram | Bot token + webhook secret + jonli ikki tomonlama test | `OPEN` |
| MA-06 | P1 | Pilot | WebRTC | TURN server kredensiallari | `OPEN` |
| MA-07 | P0 | **Ha — sale** | Zaxira | Backup/restore drill uchun ruxsat va maskalangan nusxa | `OPEN` |
| MA-08 | P0 | Handover | Domen/secret | Domen, DNS, `AUTH_SECRET`, eski operatorni olib tashlash | `OPEN` |
| MA-09 | P1 | Pilot | AI/STT | Writing/Speaking baholash uchun provider kaliti | `OPEN` |
| MA-10 | P1 | Pilot | Yuklama | 10k stsenariy uchun infra byudjeti va load-test ruxsati | `OPEN` |
| MA-11 | P2 | Yo'q | Biometrika | Kamera yuz-identifikatsiyasi: huquqiy xulosa + ota-onalik roziligi | `BLOCKED_BY_DESIGN` |
| MA-12 | P0 | **Ha — sale** | Shartnoma | Pilot markaz roziligi, IP/litsenziya shartlari | `OPEN` |

---

## MA-01 — To'lov provayderi (Click yoki Payme) merchant onboarding

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** (to'lov qabul qilish uchun) |
| Modul | To'lovlar |
| Aniq harakat | Bitta provayderni tanlash (Click **yoki** Payme), merchant shartnomasini imzolash, test (sandbox) va jangari kalitlarni alohida berish |
| Nega avtomatlashtirib bo'lmaydi | Merchant identifikatsiyasi, shartnoma va kalitlar — bu huquqiy va moliyaviy harakat; hech qanday kod buni egasiz bajara olmaydi |
| Bajarilgan tayyorgarlik | To'lov subledgeri to'liq: `tuition_payments`, `UNIQUE(provider, provider_transaction_id)`, `idempotency_key`, duplikat callback testi (100×), 20 parallel poyga testi, `pending_provider` holati (redirect = to'lov emas). Adapter interfeysi `docs/architecture/DOMAIN_CONTRACTS.md` §8 da belgilangan |
| Rasmiy manba | Payme Business Merchant API: `https://developer.help.paycom.uz/protokol-merchant-api/` · Payme API: `https://docs.payme.uz/api/introduction/` · Click Business: `https://business.click.uz/en` |
| Kerakli hisob/ruxsat | Markaz rahbari nomidagi merchant hisob, API kalitlari, callback secret |
| Aniq ketma-ketlik | 1) Provayder saytida merchant ro'yxatdan o'tish → 2) "API" bo'limida **qaysi API mahsuloti** ekanini aniqlash (Merchant API va oddiy API — ikki xil shartnoma, aralashtirmang) → 3) sandbox kalitlarini olish → 4) callback URL sifatida `https://<domen>/api/internal/payments/<provider>/callback` ni kiritish → 5) kalitlarni Railway secret sifatida qo'shish (`PAYME_MERCHANT_ID`, `PAYME_MERCHANT_SECRET`, `CLICK_SERVICE_ID`, `CLICK_SECRET_KEY` — nomlar adapter bilan kelishiladi) |
| Xavfsiz misol | `PAYME_MERCHANT_SECRET=<sandbox-secret-here>` — haqiqiy qiymatni hech qachon chatga yoki repoga yozmang |
| Egadan keyingi validatsiya | Sandbox'da 8 ta holat: muvaffaqiyat, duplikat callback, kechikkan callback, browser qaytishidan oldin callback, yaroqsiz imzo, summa nomuvofiqligi, refund, bekor qilish. Har biri uchun `GET /api/staff/finance/reconciliation` → `balanced: true` |
| Taxminiy vaqt | 2–5 ish kuni (provyayder tomoniga bog'liq) |
| Status | `OPEN` |
| Dalil havolasi | `services/backend/tests/test_tuition_ledger.py::test_duplicate_provider_callback_has_exactly_one_effect` |

## MA-02 — Hisob siyosati va chart-of-accounts moslashtiruvi

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** (moliya modulini topshirish uchun) |
| Modul | Moliya |
| Aniq harakat | (a) Daromadni tan olish siyosatini belgilash (masalan: o'tkazilgan darslar ulushi bo'yicha), (b) 11 ta operatsion hisobni markazning o'z tasdiqlangan hisoblar rejasiga bog'lash, (c) chegirma va refund siyosatini yozma tasdiqlash |
| Nega avtomatlashtirib bo'lmaydi | Bu buxgalteriya siyosati qarori. Men O'zbekiston qonunchiligidagi hisob raqamlarini yoki soliq kodeklarini **o'ylab topa olmayman** va topshirmayman |
| Bajarilgan tayyorgarlik | Ikkita qatlam qurilgan: AR subledger + double-entry jurnal. `finance_accounts.statutory_code` ataylab `NULL`. Daromadni tan olish qo'lda va chegaralangan (`insufficient_deferred_revenue`). To'lov yig'ish daromadni avtomatik tan olmaydi (test bilan isbotlangan) |
| Rasmiy manba | Buxgalteriya hisobi to'g'risidagi qonun: `https://www.lex.uz/docs/-2931253` · IFRS 15: `https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/` |
| Kerakli hisob/ruxsat | Markaz buxgalteri yoki owner |
| Aniq ketma-ketlik | 1) Har bir hisob uchun `statutory_code` ni to'ldirish (`UPDATE finance_accounts SET statutory_code=... WHERE code='tuition_revenue'`) → 2) Tan olish siyosatini hujjatlashtirish → 3) `POST /api/staff/finance/revenue/recognize` ni shu siyosat bo'yicha ishlatish |
| Xavfsiz misol | `tuition_revenue` → markaz rejasidagi "asosiy daromad" hisobi |
| Egadan keyingi validatsiya | `tests/test_tuition_ledger.py::test_worked_example_a_discount_partial_payment_and_recognition` — 800,000 / 200,000 chegirma / 250,000 to'lov / 300,000 tan olish misoli |
| Taxminiy vaqt | 1–2 kun (buxgalter bilan) |
| Status | `OPEN` |
| Dalil havolasi | `docs/architecture/DOMAIN_CONTRACTS.md` §3–§4 |

## MA-03 — Production migratsiya ruxsati (`1115_tuition_finance.sql`)

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** |
| Modul | Migratsiya |
| Aniq harakat | Migration'ni production Supabase bazasiga qo'llashga yozma ruxsat berish |
| Nega avtomatlashtirib bo'lmaydi | Production bazaga yozish — qaytarib bo'lmaydigan harakat; ruxsatsiz bajarilmaydi |
| Bajarilgan tayyorgarlik | Migration **faqat qo'shimcha**: 12 ta yangi jadval, hech bir mavjud jadval o'zgarmaydi, hech qanday `DROP/TRUNCATE/DELETE` yo'q, ma'lumot ko'chirilmaydi. Haqiqiy PostgreSQL 18 va PGlite'da qo'llanib tekshirildi. Migratsiya yaxlitligi gate'iga ro'yxatga olindi |
| Rasmiy manba | Supabase dashboard → Database → Migrations; session pooler ulanishi |
| Kerakli hisob/ruxsat | Supabase loyihasi egasi |
| Aniq ketma-ketlik | 1) Bazadan zaxira olish → 2) **Session pooler** connection string'ini olish (transaction pooler 6543 ishlamaydi) → 3) `psql "<session-pooler-url>" -f services/backend/migrations/1115_tuition_finance.sql` → 4) `SELECT count(*) FROM finance_accounts;` → 11 bo'lishi kerak |
| Xavfsiz misol | `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| Egadan keyingi validatsiya | `GET /api/staff/finance/reconciliation` → `{"balanced": true}`; `SELECT count(*) FROM finance_accounts` = 11 |
| Taxminiy vaqt | 15 daqiqa |
| Status | `OPEN` |
| Dalil havolasi | `docs/verification/SALE_READY_ACCEPTANCE.md` §2 |

## MA-04 — Cloudflare R2 kalitlari va bucket siyosati

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** (audio/media ishlashi uchun) |
| Modul | Media/R2 |
| Aniq harakat | R2 bucket yaratish, API token berish, private access siyosatini tasdiqlash |
| Nega avtomatlashtirib bo'lmaydi | Cloudflare hisobi va token egaligi ownerda |
| Bajarilgan tayyorgarlik | Kod tomoni mavjud: `app/media_streaming.py`, `app/step19_storage.py`, migration 0064 |
| Rasmiy manba | `https://developers.cloudflare.com/r2/` → Cloudflare dashboard → R2 |
| Kerakli hisob/ruxsat | Cloudflare account admin |
| Aniq ketma-ketlik | R2 → Create bucket → API Tokens → Object Read & Write (faqat shu bucket) → token'ni Railway secret'ga qo'yish |
| Xavfsiz misol | `R2_ACCESS_KEY_ID=<access-key-id>` |
| Egadan keyingi validatsiya | Imzolangan URL orqali audio yuklash/yuklab olish; muddati tugagan URL 403 qaytarishi |
| Taxminiy vaqt | 30 daqiqa |
| Status | `OPEN` |
| Dalil havolasi | `docs/verification/CAPABILITY_MATRIX.md` CAP-14 |

## MA-05 — Telegram bot: token, webhook secret va jonli ota-ona testi

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** |
| Modul | Ota-ona aloqasi |
| Aniq harakat | Bot token va webhook secret'ni berish; **haqiqiy** ikki ota-ona / ikki bola bilan ikki tomonlama xabar testini o'tkazish |
| Nega avtomatlashtirib bo'lmaydi | Haqiqiy Telegram hisoblari va foydalanuvchi roziligi kerak; sintetik test delivery'ni isbotlamaydi |
| Bajarilgan tayyorgarlik | Parent Connect to'liq mavjud va **saqlab qolindi**: `guardian_port.py`, migratsiyalar 0088–0090, javob aynan yuboruvchi xodimga qaytadi, `UNIQUE(actor_telegram_id, source_message_id)`, `update_id` dedup. Guardian moliya route'lariga markaziy 403 bilan yopiq |
| Rasmiy manba | `https://core.telegram.org/bots/api` → @BotFather |
| Kerakli hisob/ruxsat | Bot egasi |
| Aniq ketma-ketlik | 1) @BotFather → `/token` → 2) `TELEGRAM_BOT_TOKEN` va `BOT_SERVICE_SECRET` ni Railway'ga qo'shish → 3) webhook'ni `https://<domen>/api/internal/telegram/...` ga o'rnatish va `secret_token` ni moslashtirish → 4) Test: 2 xodim, 2 ota-ona, 2 bola; bitta ota-ona ikki bolaga ulangan; eski xabarga javob; duplikat update |
| Xavfsiz misol | `TELEGRAM_BOT_TOKEN=123456:TestOnlyBotToken` (bu — test qiymati, haqiqiysi emas) |
| Egadan keyingi validatsiya | Javob aynan asl xodim inbox'iga tushadi (boshqa admin onlayn bo'lsa ham); `guardian_message_replies` da `status='sent'` |
| Taxminiy vaqt | 1 soat |
| Status | `OPEN` |
| Dalil havolasi | `services/backend/tests/test_guardian_reply_routing.py` |

## MA-06 — TURN server kredensiallari (WebRTC)

| Maydon | Qiymat |
| Prioritet / To'suvchi | P1 / Pilot |
| Modul | Speaking Partner / Live |
| Aniq harakat | TURN hisobini ochish va kredensiallarni berish; ikki real brauzerda qo'ng'iroq testini o'tkazish |
| Nega avtomatlashtirib bo'lmaydi | Tashqi servis hisobi va to'lovi |
| Bajarilgan tayyorgarlik | Signalling mavjud: `app/live_partner_signaling.py`, `live_partner_turn.py`, migratsiyalar 0027/0082 |
| Rasmiy manba | TURN provayderi hujjatlari (masalan Cloudflare Calls / Twilio / Metered) |
| Kerakli hisob/ruxsat | Proвайдер hisobi |
| Aniq ketma-ketlik | TURN URI/username/credential → `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` secret'lari → ikki brauzerda test |
| Xavfsiz misol | `TURN_URL=turn:turn.example.com:3478` |
| Egadan keyingi validatsiya | NAT ortida ikki brauzer o'rtasida audio; uzilganda qayta ulanish |
| Taxminiy vaqt | 1 soat |
| Status | `OPEN` |
| Dalil havolasi | `docs/verification/CAPABILITY_MATRIX.md` CAP-08 |

## MA-07 — Backup / restore drill ruxsati

| Maydon | Qiymat |
| Prioritet / To'suvchi | P0 / **Ha — sale** |
| Modul | Zaxira |
| Aniq harakat | Maskalangan baza nusxasini izolyatsiya qilingan muhitga tiklashga ruxsat berish |
| Nega avtomatlashtirib bo'lmaydi | Production ma'lumotiga kirish va shaxsiy ma'lumotlarni ko'chirish — faqat ruxsat bilan |
| Bajarilgan tayyorgarlik | Tiklash namunasi hujjatlashtirilgan (`docs/PLATFORM-RECOVERY-20261029.md`, `scripts/qa2-local-postgres.sh`). Moliya jadvallari tashqi holatsiz — to'liq tiklanadi, lekin **isbotlanmagan** |
| Rasmiy manba | Supabase → Database → Backups / PITR |
| Kerakli hisob/ruxsat | Supabase owner |
| Aniq ketma-ketlik | 1) Nusxa yuklab olish → 2) Shaxsiy ma'lumotlarni maskalash → 3) Izolyatsiya bazaga tiklash → 4) `GET /api/staff/finance/reconciliation` → 5) R2 pointer'larni tekshirish |
| Xavfsiz misol | `pg_restore -d learners_restore backup.dump` |
| Egadan keyingi validatsiya | Jadval sonlari, jurnal balansi (`balanced: true`), R2 pointer'lar, vaqt belgilari |
| Taxminiy vaqt | 2–4 soat |
| Status | `OPEN` |
| Dalil havolasi | `docs/verification/CAPACITY_AND_RECOVERY.md` §7 |

## MA-08 — Domen, DNS, `AUTH_SECRET` va eski operatorni olib tashlash (handover)

| Maydon | Qiymat |
| Prioritet / To'suvchi | P0 / Handover paytida |
| Modul | Infra |
| Aniq harakat | Domen/DNS egaligini o'tkazish, `AUTH_SECRET` va barcha secret'larni aylantirish, eski operator kirishini olib tashlash |
| Nega avtomatlashtirib bo'lmaydi | Hisob egaligi va shartnoma |
| Bajarilgan tayyorgarlik | Handover checklist mavjud (`docs/OWNER-DOSSIER.md`, `docs/DEPLOYMENT-PORTABILITY.md`) |
| Rasmiy manba | Cloudflare → DNS; Railway → Settings → Variables |
| Kerakli hisob/ruxsat | Domen registratori + Cloudflare + Railway admin |
| Aniq ketma-ketlik | 1) Domen transfer → 2) DNS → 3) Yangi `AUTH_SECRET` (barcha sessiyalar bekor bo'ladi — bu kutilgan) → 4) Eski token/kalitlarni bekor qilish |
| Xavfsiz misol | `AUTH_SECRET=<64-byte-random-hex>` |
| Egadan keyingi validatsiya | Eski sessiya bilan kirish 401 qaytaradi; yangi login ishlaydi |
| Taxminiy vaqt | 2 soat |
| Status | `OPEN` |
| Dalil havolasi | `docs/OWNER-DOSSIER.md` |

## MA-09 — AI/STT provider kaliti (Writing/Speaking baholash)

| Maydon | Qiymat |
| Prioritet / To'suvchi | P1 / Pilot |
| Modul | RIWI / Writing / Speaking |
| Aniq harakat | Provider'ni tanlash va kalitni berish |
| Nega avtomatlashtirib bo'lmaydi | Tashqi hisob va to'lov |
| Bajarilgan tayyorgarlik | Provider abstraction, fallback va provenance mavjud (`app/riwi_provider_router.py`, `ai_runtime.py`) |
| Rasmiy manba | Tanlangan provider hujjatlari |
| Kerakli hisob/ruxsat | Provider hisobi |
| Aniq ketma-ketlik | `AI_PRIMARY_PROVIDER` ni sozlash va kalitni secret sifatida qo'shish |
| Xavfsiz misol | `AI_PRIMARY_PROVIDER=<provider-id>` |
| Egadan keyingi validatsiya | Haqiqiy Writing topshirig'ida rubric-asosidagi baho va provenance yozuvi |
| Taxminiy vaqt | 30 daqiqa |
| Status | `OPEN` |
| Dalil havolasi | `docs/EXTERNAL-AI-PROVIDER-MATRIX.md` |

## MA-10 — Yuklama testi uchun infra byudjeti

| Maydon | Qiymat |
| Prioritet / To'suvchi | P1 / Pilot |
| Modul | Yuklama |
| Aniq harakat | 100 → 2,000 konkurent darajalari uchun vaqtincha infra byudjetini tasdiqlash |
| Nega avtomatlashtirib bo'lmaydi | Pul va infra resursi |
| Bajarilgan tayyorgarlik | `scripts/controlled_load.py` va oldingi 20/200 daraja retseptlari mavjud; yangi moliya so'rovlari 10k ma'lumotda `EXPLAIN ANALYZE` bilan o'lchandi |
| Rasmiy manba | Railway / Supabase narx sahifalari |
| Kerakli hisob/ruxsat | Owner |
| Aniq ketma-ketlik | Vaqtincha muhit → `python3 scripts/controlled_load.py --levels 100,250,500` → natijalarni `docs/verification/CAPACITY_AND_RECOVERY.md` ga yozish |
| Xavfsiz misol | `--levels 100` |
| Egadan keyingi validatsiya | p50/p95/p99, xato ulushi, PASS/FAIL yozuvi |
| Taxminiy vaqt | 1 kun |
| Status | `OPEN` |
| Dalil havolasi | `docs/verification/CAPACITY_AND_RECOVERY.md` §3–§4 |

## MA-11 — Kamera yuz-identifikatsiyasi (hozircha **o'chiq** qolishi shart)

| Maydon | Qiymat |
| Prioritet / To'suvchi | P2 / Yo'q |
| Modul | Biometrika |
| Aniq harakat | Agar umuman kerak bo'lsa: shaxsiy ma'lumotlar bo'yicha huquqiy xulosa, ota-ona roziligi, ma'lumotni mamlakat ichida saqlash sharti, aniqlik/adolat testlari |
| Nega avtomatlashtirib bo'lmaydi | Biometrik ma'lumot — alohida huquqiy rejim; rozilik va saqlash joyi qarori egasiz bo'lmaydi |
| Bajarilgan tayyorgarlik | **Hech narsa yoqilmagan.** Kod yo'q, flag yo'q — bu ataylab shunday |
| Rasmiy manba | Shaxsiy ma'lumotlar to'g'risidagi qonun: `https://lex.uz/uz/acts/4396428` (2026 o'zgarishlarini alohida tekshirish) |
| Kerakli hisob/ruxsat | Owner + yurist |
| Aniq ketma-ketlik | Privacy Impact Assessment → rozilik matni → saqlash joyi → muddati → o'chirish tartibi → keyingina kod |
| Xavfsiz misol | — |
| Egadan keyingi validatsiya | Kamera ishlamasa ham hech bir talaba darsga kirishdan qolmasligi |
| Taxminiy vaqt | Aniqlanmagan |
| Status | `BLOCKED_BY_DESIGN` |
| Dalil havolasi | `docs/verification/CAPABILITY_MATRIX.md` CAP-33 |

## MA-12 — Pilot markaz roziligi va IP/litsenziya shartlari

| Maydon | Qiymat |
| Prioritet / To'suvchi | P0 / **Ha — sale** |
| Modul | Shartnoma |
| Aniq harakat | Pilot markazni belgilash, 30 kunlik pilot shartlari, **cheklangan deploy litsenziyasi** yoki **eksklyuziv source-code transferi** — qaysi biri ekanini yozma belgilash |
| Nega avtomatlashtirib bo'lmaydi | Huquqiy shartnoma |
| Bajarilgan tayyorgarlik | `docs/sales/BUYER_DEMO_AND_HANDOVER.md` da 5 daqiqalik demo, 30 kunlik pilot reja va paket farqlari tayyor |
| Rasmiy manba | — |
| Kerakli hisob/ruxsat | Owner + xaridor |
| Aniq ketma-ketlik | 1) Paketni tanlash → 2) Litsenziya turini belgilash → 3) Qo'llab-quvvatlash/SLA chegarasini yozish → 4) Ma'lumot migratsiyasi mas'uliyatini belgilash |
| Xavfsiz misol | — |
| Egadan keyingi validatsiya | Imzolangan shartnoma |
| Taxminiy vaqt | Kelishuvga bog'liq |
| Status | `OPEN` |
| Dalil havolasi | `docs/sales/BUYER_DEMO_AND_HANDOVER.md` |

---

## Yopildi (sana va dalil bilan)

| ID | Nima yopildi | Sana | Dalil |
|---|---|---|---|
| — | Hozircha yopilgan element yo'q | — | — |

**Eslatma:** Bu ro'yxatga kod bilan yopiladigan ishlar kiritilmaydi. Masalan, mavjud 5 ta
qizil test (Listening 08/10 runtime, Reading gloss offset, study-plan bank parity, order-dependent
startup warning) — bu **muhandislik ishi**, owner harakati emas; ular
`docs/verification/SALE_READY_ACCEPTANCE.md` §3 da qayd etilgan.
