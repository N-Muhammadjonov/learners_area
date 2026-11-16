# SALE_READY_MANUAL_ACTIONS — egasi bajaradigan yagona ro'yxat

**Branch:** `feature/academy-payments-ux-20261116` · **Sana:** 2026-11-16, Asia/Tashkent
**Qoida:** Barcha tashqi/qo'lda bajariladigan majburiyatlar **faqat shu faylda**. Boshqa
hujjatlarda egaga topshiriq yozilmaydi. Kod bilan yopish mumkin bo'lgan hech narsa bu yerga
ko'chirilmagan — muhandislik ishi muhandislikda qoldi.

## Holat (objektiv hisob)

| Tur | Soni | Izoh |
|---|---:|---|
| **Sale blockers** (sotuvni to'sadi) | **6** | MA-01, MA-02, MA-04, MA-05, MA-07, MA-12 |
| **Pilot blockers** (pilotni to'sadi) | **3** | MA-06, MA-09, MA-10 |
| **Handover blockers** (topshiriqda to'sadi) | **1** | MA-08 (domen/DNS/secret egaligi) |
| **Optional / kelajak** | **1** | MA-11 (biometrik — hozircha **o'chiq** qolishi shart) |
| Bajarilgan | **1** | MA-03 — production migratsiyasi va faollashtirish |
| Jami | **12** | MA-01 … MA-12, indeks bilan bir xil |

**Umumiy xulosa:** MA-03 production’da tasdiqlandi. Ilova bazasining shifrlangan
zaxirasi va ajratilgan tiklash sinovi ham o‘tdi. Qolgan 6 ta sale blocker yopilmaguncha "EVERYTHING IS READY"
deyish **noto'g'ri** bo'ladi.

**Jadval formati haqida:** talab qilingan 15 ustun bitta keng jadvalga sig'maydi, shuning uchun
yuqorida qisqa indeks, pastda har bir element uchun barcha 15 maydonni o'z ichiga olgan blok
berilgan. `ID` orqali bog'lanadi.

15-noyabrda foydalanuvchi production ishlariga va migratsiyalarga ruxsat berdi. Supabase sxemasi va Cloudflare omborlari tekshirildi. 1115–1131 production’da qo‘llandi, Academy yoqildi, ilova bazasidan R2’ga shifrlangan zaxira olindi va ajratilgan PostgreSQL’da tiklandi. [Production dalili](verification/ACADEMY_PRODUCTION_RELEASE_20261115.md). Jonli audio, Telegram va WebRTC qabuli MA-04–06 bandlarida ochiq qoladi.

## Indeks

| ID | Prioritet | To'suvchi? | Modul | Qisqa harakat | Status |
|---|---|---|---|---|---|
| MA-01 | P0 | **Ha — sale** | To'lovlar | Click / Payme / Uzum merchant sandbox va jonli qabul | `BLOCKED_EXTERNAL` |
| MA-02 | P0 | **Ha — sale** | Moliya | Hisob siyosati va chart-of-accounts moslashtiruvini tasdiqlash | `OPEN` |
| MA-03 | P0 | Yo‘q — bajarilgan | Migratsiya | 1115–1131 production’da qo‘llandi va Academy yoqildi | `DONE` |
| MA-04 | P0 | **Ha — sale** | Media/R2 | R2 sozlangan; jonli audio va muddati tugagan URL qabuli | `CONFIGURED_AWAITING_MANUAL_QA` |
| MA-05 | P0 | **Ha — sale** | Ota-ona Telegram | Bot token + webhook secret + jonli ikki tomonlama test | `OPEN` |
| MA-06 | P1 | Pilot | WebRTC | TURN server kredensiallari | `OPEN` |
| MA-07 | P0 | **Ha — sale** | Zaxira | Ilova bazasi tiklandi; to‘liq media recovery va RPO/RTO qabuli qolgan | `PARTIAL` |
| MA-08 | P0 | Handover | Domen/secret | Domen, DNS, `AUTH_SECRET`, eski operatorni olib tashlash | `OPEN` |
| MA-09 | P1 | Pilot | AI/STT | Writing/Speaking baholash uchun provider kaliti | `OPEN` |
| MA-10 | P1 | Pilot | Yuklama | 10k stsenariy uchun infra byudjeti va load-test ruxsati | `OPEN` |
| MA-11 | P2 | Yo'q | Biometrika | Kamera yuz-identifikatsiyasi: huquqiy xulosa + ota-onalik roziligi | `BLOCKED_BY_DESIGN` |
| MA-12 | P0 | **Ha — sale** | Shartnoma | Pilot markaz roziligi, IP/litsenziya shartlari | `OPEN` |

---

## MA-01 — Click, Payme va Uzum merchant tekshiruvi

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / Ha — sale, jonli to‘lov qabul qilish uchun |
| Modul | O‘quvchi va bog‘langan farzand to‘lovlari |
| Aniq harakat | Tanlangan provayderlarning merchant shartnomasini rasmiylashtirish, sandbox hisobini ajratish va rasmiy testlardan o‘tkazish. Sinovdan o‘tmagan usul yopiq qoladi |
| Nega avtomatlashtirib bo'lmaydi | Merchant shartnomasi, haqiqiy kalitlar, provayder tekshiruvi va fiskal talablar markaz hamda provayder tomonidan tasdiqlanadi |
| Bajarilgan tayyorgarlik | Alohida development branchda immutable buyurtmalar, guardian IDOR nazorati, Click Shop / Payme Merchant / Uzum Checkout adapterlari, 42 ta haqiqiy ajratilgan PostgreSQL to‘lov testi va jami 52 ta payment/workbench/AI testi. Daraja: LOCALLY_TESTED. Haqiqiy SANDBOX_VERIFIED yoki LIVE_VERIFIED dalili hali yo‘q |
| Rasmiy manba | [Click](https://docs.click.uz/), [Payme Merchant](https://developer.help.paycom.uz/protokol-merchant-api/), [Payme sandbox](https://developer.help.paycom.uz/pesochnitsa/), [Uzum Checkout](https://developer.uzumbank.uz/en/checkout/) |
| Kerakli hisob/ruxsat | Markazning merchant hisobi, alohida sandbox kalitlari, tasdiqlangan login va ruxsat etilgan callback URL. Jonli chiqarish uchun yangi release ruxsati |
| Aniq ketma-ketlik | 1) Merchant mahsulotini tanlang: Click Shop, Payme Merchant, Uzum Checkout. 2) Ajratilgan sinov bazasi va sandbox kalitlarini tayyorlang. 3) `/api/payments/callbacks/click`, `/api/payments/callbacks/payme` yoki `/api/payments/callbacks/uzum` manzilini shu sinov serverida sozlang. Non-production runtime va `PAYMENT_SANDBOX_DATABASE_ISOLATED=1` bilan `prepare_provider_sandbox.py` orqali owner/sinov o‘quvchisi uchun order tayyorlash mumkin. 4) Muvaffaqiyat, takror, kechikish, noto‘g‘ri imzo/summa, bekor qilish, ikkita farzand va refund siyosatini tekshiring. 5) Dalillar va reconciliation mos kelgach tegishli verification flagini tasdiqlang. 6) Yangi migratsiya va feature activationni alohida release ruxsati bilan bajaring. Tekshiruvgacha jonli flaglarni yoqmang |
| Xavfsiz misol | Kalit nomlari va muhit chegaralari: `docs/architecture/SELF_SERVICE_PAYMENTS.md`. Kalit qiymatini chatga, repoga yoki screenshotga yozmang. Uzum API base URL va checkout origin merchant tomonidan beriladi, uydirilmaydi |
| Egadan keyingi validatsiya | Rasmiy vendor sandbox hisobotlari + `services/backend/tests/test_self_service_payments.py` + asl journal bilan reconciliation. Payme credited-payment cancellation/refund tartibi provayder bilan alohida qabul qilinadi. Ichki tasdiqnoma fiskal chek deb olinmaydi |
| Taxminiy vaqt | Merchant tekshiruvi va shartnomaga bog‘liq |
| Status | BLOCKED_EXTERNAL — haqiqiy merchant kalitlari va vendor qabuli yo‘q |
| Dalil havolasi | [Arxitektura va muhitlar](architecture/SELF_SERVICE_PAYMENTS.md), [UX dalillari](verification/UX_BASELINE_AND_REDESIGN.md), [PR #202](https://github.com/N-Muhammadjonov/learners_area/pull/202) |

## MA-02 — Hisob siyosati va chart-of-accounts moslashtiruvi

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** (moliya modulini topshirish uchun) |
| Modul | Moliya |
| Aniq harakat | (a) Daromadni tan olish siyosatini belgilash (masalan: o'tkazilgan darslar ulushi bo'yicha), (b) 12 ta operatsion hisobni markazning o'z tasdiqlangan hisoblar rejasiga bog'lash, (c) chegirma va refund siyosatini yozma tasdiqlash |
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

## MA-03 — Academy va Tuition’ni production’da ishga tushirish

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / Yo‘q — bajarilgan |
| Modul | Migratsiya |
| Aniq harakat | Tasdiqlangan release commitidan 1115–1131 zanjirini qo‘llash va Academy’ni faollashtirish |
| Kerakli hisob/ruxsat | Supabase loyihasi va ishlab turgan backend muhiti egasi |
| Bajarilgan tayyorgarlik | 17 fayl production’da bitta tranzaksiyada qo‘llandi; barcha xeshlar mos; 35 ta yangi RLS jadvali; 12 ta hisob; 206 ta avvalgi jadval yozuv soni saqlandi. Shifrlangan R2 zaxirasi va ajratilgan tiklash o‘tdi; Railway readiness SUCCESS |
| Status | `DONE` |
| Dalil havolasi | `docs/verification/ACADEMY_PRODUCTION_RELEASE_20261115.md` |

Quyidagi tartib boshqa muhitning birinchi o‘rnatilishi uchun. Production’da qayta bajarish talab qilinmaydi.

1. Eski sxema bilan ishlayotgan backendda `ACADEMY_FEATURES_ENABLED` sozlanmagan yoki `0` bo‘lsin. Bazaning zaxirasini oling. Sinov nusxasida upgrade va restore jarayonini bajaring.
2. Direct yoki session pooler ulanishini TLS bilan `ACADEMY_MIGRATION_DATABASE_URL` orqali kiriting. Reliz checkoutida backend dependency’lari bilan rejani o‘qing va chiqishdagi parolsiz nishonni tekshiring.

   ```bash
   python services/backend/migrate_academy.py
   python services/backend/migrate_academy.py --apply '<chiqishdagi user@host:port/database>'
   python services/backend/migrate_academy.py
   ```

3. 1131 ikkita mavjud urinish jadvalida indeks yaratadi. Ishni kam trafik vaqti uchun rejalashtiring. Qulfni olish kechiksa, butun tranzaksiya qaytariladi. Oldin qo‘lda o‘rnatilgan Academy sxemasi aniqlansa, operator sxema va migratsiya tarixini tekshiradi.
4. Birinchi o‘rnatishda `SELECT count(*) FROM public.finance_accounts;` natijasi 12, qayta tekshiruvda kutilayotgan fayllar soni 0. Shundan keyin backend muhitida `ACADEMY_FEATURES_ENABLED=1` qo‘ying. Owner sessiyasida guruhlar, Rescue va `GET /api/staff/finance/reconciliation` javobidagi `journal.balanced` qiymatini tekshiring. Orqaga qaytishda muhit qiymatini `0` qiling va yozilgan hisob ma’lumotlarini saqlang.

## MA-04 — Cloudflare R2 kalitlari va bucket siyosati

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** (audio/media ishlashi uchun) |
| Modul | Media/R2 |
| Aniq harakat | Mavjud private R2 orqali jonli audio va muddati tugagan URL rad etilishini tekshirish |
| Nega avtomatlashtirib bo'lmaydi | Haqiqiy brauzer va audio qabuli foydalanuvchi tomonidan bajariladi |
| Bajarilgan tayyorgarlik | `learners-area` bucket’da r2.dev o‘chiq va custom public domain yo‘q; media/dictionary Worker bindinglari tekshirildi; runtime kalitlari mavjud; haqiqiy shifrlangan zaxira upload/download xeshi mos |
| Rasmiy manba | `https://developers.cloudflare.com/r2/` → Cloudflare dashboard → R2 |
| Kerakli hisob/ruxsat | Cloudflare account admin |
| Aniq ketma-ketlik | Mavjud konfiguratsiyada test audiosini brauzerda ochish; seek va qayta kirishni tekshirish; muddati tugagan URL rad etilishini tasdiqlash |
| Xavfsiz misol | `R2_ACCESS_KEY_ID=<access-key-id>` |
| Egadan keyingi validatsiya | Imzolangan URL orqali audio yuklash/yuklab olish; muddati tugagan URL 403 qaytarishi |
| Taxminiy vaqt | 30 daqiqa |
| Status | `CONFIGURED_AWAITING_MANUAL_QA` |
| Dalil havolasi | `docs/verification/ACADEMY_PRODUCTION_RELEASE_20261115.md`; CAP-14 |

## MA-05 — Telegram bot: token, webhook secret va jonli ota-ona testi

| Maydon | Qiymat |
|---|---|
| Prioritet / To'suvchi | P0 / **Ha — sale** |
| Modul | Ota-ona aloqasi |
| Aniq harakat | Bot token va webhook secret'ni berish; **haqiqiy** ikki ota-ona / ikki bola bilan ikki tomonlama xabar testini o'tkazish |
| Nega avtomatlashtirib bo'lmaydi | Haqiqiy Telegram hisoblari va foydalanuvchi roziligi kerak; sintetik test delivery'ni isbotlamaydi |
| Bajarilgan tayyorgarlik | Parent Connect saqlangan: `guardian_port.py`, migratsiyalar 0088–0090, javob aynan yuboruvchi xodimga qaytadi, `UNIQUE(actor_telegram_id, source_message_id)`, `update_id` dedup. Guardian staff moliyasiga yopiq. Yangi branchda faqat amaldagi bog‘langan farzand to‘lovlari va shu hisob bo‘yicha RIWI yordami ruxsat etiladi |
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
| Aniq harakat | To‘liq media recovery va kelishilgan RPO/RTO qabul mezonini belgilash |
| Nega avtomatlashtirib bo'lmaydi | Muhandislikdagi tiklash sinovi mijozning yo‘qotishga yo‘l qo‘yiladigan vaqt va xizmatni qaytarish kelishuvini tasdiqlamaydi |
| Bajarilgan tayyorgarlik | Ruxsat berilgan. Haqiqiy production ilova bazasi private R2’ga AES-256-GCM bilan olindi, qayta yuklab tekshirildi va ajratilgan PostgreSQL’da tiklandi. 206 ta jadval yozuv sonlari, constraint va RLS mos. Platform Auth/Storage/Vault va R2 media baytlari bu nusxaga kirmaydi |
| Rasmiy manba | Supabase → Database → Backups / PITR |
| Kerakli hisob/ruxsat | Supabase owner |
| Aniq ketma-ketlik | 1) Nusxa yuklab olish → 2) Shaxsiy ma'lumotlarni maskalash → 3) Izolyatsiya bazaga tiklash → 4) `GET /api/staff/finance/reconciliation` → 5) R2 pointer'larni tekshirish |
| Xavfsiz misol | `pg_restore -d learners_restore backup.dump` |
| Egadan keyingi validatsiya | Jadval sonlari, jurnal balansi (`balanced: true`), R2 pointer'lar, vaqt belgilari |
| Taxminiy vaqt | 2–4 soat |
| Status | `PARTIAL` |
| Dalil havolasi | `docs/verification/ACADEMY_PRODUCTION_RELEASE_20261115.md`; `CAPACITY_AND_RECOVERY.md` §7 |

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
| Bajarilgan tayyorgarlik | Mavjud provider abstraction, fallback va provenance saqlangan. Yangi Academy RIWI typed read/draft vositalari, rol kvotasi, kill switch va deterministik fallback bilan ishlaydi. Tashqi model yoqilmagan, pullik chaqiruv bajarilmagan |
| Rasmiy manba | Tanlangan provider hujjatlari |
| Kerakli hisob/ruxsat | Provider hisobi |
| Aniq ketma-ketlik | Baholash uchun mavjud provider sozlamalari va secret kalitni ajrating. Academy faktlarini tashqi saralash zarur bo‘lsa, sinov muhitida mavjud gateway model/kalitini tekshiring, keyin `ACADEMY_AI_EXTERNAL_ENABLED=1` va `ACADEMY_AI_PROVIDER_VERIFIED=1` ni tasdiqlang. Avval maxfiy ma’lumot chiqmasligi, model uzilishidagi fallback va haqiqiy sarf yozuvlarini tekshiring |
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
| Bajarilgan tayyorgarlik | 10 000 sintetik o‘quvchida haqiqiy lokal HTTP orqali 10/25/50/100/250/500/1000/2000 darajalari o‘lchandi. 25 parallel daraja p95 173,44 ms va 0 xato; yuqori darajalar maqsadga yetmadi. 50 takror callback 1 jurnal effektini berdi. Bu staging yoki production SLA emas |
| Rasmiy manba | Railway / Supabase narx sahifalari |
| Kerakli hisob/ruxsat | Owner |
| Aniq ketma-ketlik | Vaqtincha muhit → `python3 scripts/controlled_load.py --levels 100,250,500` → natijalarni `docs/verification/CAPACITY_AND_RECOVERY.md` ga yozish |
| Xavfsiz misol | `--levels 100` |
| Egadan keyingi validatsiya | p50/p95/p99, xato ulushi, PASS/FAIL yozuvi |
| Taxminiy vaqt | 1 kun |
| Status | `OPEN` |
| Dalil havolasi | `docs/verification/academy-ux/load-receipt.json`; `docs/verification/CAPACITY_AND_RECOVERY.md` |

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
| Aniq ketma-ketlik | 1) Paketni tanlash → 2) Litsenziya turini belgilash → 3) Qo'llab-quvvatlash/SLA chegarasini yozish → 4) Ma'lumot migratsiyasi mas'uliyatini belgilash → 5) Tajribasiz owner, admin, teacher, student va guardian bilan 5 asosiy vazifani kuzatish, tushunarsiz atama va bosish sonlarini yozish. Demo matni: `docs/verification/ACADEMY_2_ACCEPTANCE.md` |
| Xavfsiz misol | — |
| Egadan keyingi validatsiya | Imzolangan shartnoma |
| Taxminiy vaqt | Kelishuvga bog'liq |
| Status | `OPEN` |
| Dalil havolasi | `docs/sales/BUYER_DEMO_AND_HANDOVER.md` |

---

## Yopildi (sana va dalil bilan)

| ID | Nima yopildi | Sana | Dalil |
|---|---|---|---|
| MA-03 | 1115–1131 production migratsiyasi va Academy faollashtirish | 2026-11-15 | `docs/verification/ACADEMY_PRODUCTION_RELEASE_20261115.md` |

**Eslatma:** Kod bilan yopiladigan ishlar bu ro‘yxatga kiritilmaydi. Academy 2.0 bo‘yicha
muhandislik holati va qolgan testlar `docs/verification/ACADEMY_2_ACCEPTANCE.md` da.
Yangi self-service payment migratsiyasi MA-03 dagi avvalgi production reliziga kirmaydi,
ushbu vazifada production bazasi o‘zgartirilmadi.
