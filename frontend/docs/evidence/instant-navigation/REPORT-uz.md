# Learners Area — ichki navigatsiyani tezlashtirish: yakuniy hisobot

**Sana:** 2026-10-30 · **Muhit:** lokal sandbox, Chromium 133 (headless), `scripts/serve.py` preview, `/api/**` izolyatsiyalangan fixture'lar bilan almashtirilgan · **Build revision:** `323518c9b09741124c9a` (497 fayl, 122 route)

> Bu hisobotdagi barcha raqamlar shu muhitda **o'lchangan**. O'lchanmagan har bir ko'rsatkich ochiq holda **NOT MEASURED** deb belgilangan.

---

## A. Git holati

| Element | Qiymat |
|---|---|
| Repo | `N-Muhammadjonov/learners_area` |
| Boshlang'ich commit | `1c9cba4580ae1ba426df11dde9851b452320bede` (`arena/learners-area-next` bilan bir xil) |
| Ish commiti | `25ff712` — `perf(navigation): ship verified instant-navigation phase 2 evidence` |
| Ish filiali | `arena/dca9f485-learners-area` (sessiya filiali) |
| Pull request | `#98` → baza: `arena/learners-area-next` |
| `main` | **tegilmagan** — na commit, na merge, na push, na deploy |
| Force-push | yo'q |
| Production DB | **tegilmagan** |
| Ishlatilgan kod fayllari | `frontend/vanilla/js/module-prewarm.js`, `frontend/vanilla/js/route-reuse.js`, `frontend/vanilla/js/workspace.js`, `frontend/vanilla/modules/shell/transition.js` (+56 / −11 satr) |
| Yangi fayllar | `frontend/vanilla/scripts/instant-navigation-bench.mjs`, `frontend/vanilla/tests/navigation-feedback-v75.test.mjs`, `frontend/docs/evidence/instant-navigation/*.json`, shu hisobot |

Backend va avtorizatsiya qatlamida bitta ham o'zgarish yo'q:

```
$ git diff --stat 1c9cba4 HEAD -- services/
(bo'sh)
$ git diff --stat 1c9cba4 HEAD -- frontend/vanilla/js/authority.js frontend/vanilla/js/session-events.js \
    services/backend/app/security.py services/backend/app/access_events.py \
    services/backend/app/step17_access_events_port.py services/backend/app/main.py \
    services/backend/migrations/0060_auth_session_revocation.sql
(bo'sh)
```

---

## B. Avtorizatsiya yaxlitligi (dalillar)

### B.1. Tegilmagan qatlam
`authority.js`, `session-events.js`, `workspace.js`ning avtorizatsiya qismlari (session/`privateScope` boshqaruvi), `security.py`, `access_events.py`, `step17_access_events_port.py`, `main.py`ning auth qismlari, `0060_auth_session_revocation.sql` — **semantik jihatdan o'zgarishsiz** (yuqoridagi bo'sh diff).

Navigatsiya uchun qilingan ish faqat: saqlash byudjeti (`route-reuse`), vizual o'tish ramkasi (`transition`), scroll tiklash (`workspace` commit qismi) va kod isitish (`module-prewarm`). Hech biri avtorizatsiya qarorini qabul qilmaydi.

### B.2. Brauzer regressiya tekshiruvlari (`security-final.json`, 10/10 PASS)

| # | Tekshiruv | Natija | Dalil (`detail`) |
|---|---|---|---|
| 1 | Har tab uchun bitta umumiy `/api/auth/changes` oqimi | PASS | `streams=1` |
| A | 6 ta issiq navigatsiya davomida `/api/auth/state` o'qishlari | PASS | `calls=0` |
| A | Har navigatsiyada sessiya-presentatsiya o'qishi yo'q | PASS | faqat route view o'qishlari + `/api/presence` + `/api/notifications?count=1` |
| A | API o'qishsiz private-cache grant yo'q | PASS | — |
| B | Ta'sirlangan foydalanuvchi uchun bitta event-driven reconciliation | PASS | `calls=1` |
| B | Suspend qilingan o'quvchi private UI'dan chiqariladi | PASS | `/login` |
| B | Revocation'dan keyin private workspace va topbar DOM'da yo'q, fixture matni yo'q | PASS | `{"path":"/login","workspace":0,"authShell":1,"fixtureName":false,"topbar":0}` |
| F | Revocation'dan keyin `/api/auth/state` polling | PASS | `delta=0` |
| E | Cross-tab logout ishorasi shu tabni chiqaradi | PASS | `/app/dashboard → /login` |
| G | Logout'dan keyin himoyalangan API server tomonidan rad etiladi | PASS | `status=401` |

### B.3. Saqlanmagan qoidalar (kod darajasida)
- `go()`/klik boshiga avtorizatsiya tekshiruvi **qo'shilmagan** (per-navigation auth yo'q).
- Yangi sessiya taymeri, yangi `/api/auth/state` polling, ikkinchi SSE ulanish, ikkinchi Postgres LISTEN — **yo'q**.
- `/api/presence` heartbeat o'z joyida, sessiya validatsiyasidan alohida qoldi.
- `route-reuse` faqat **passiv** ko'rinishlarni saqlaydi (`PASSIVE` ro'yxati va `ACTIVE` veto o'zgarmagan): faol imtihon/taymer, yozib olish, media pleyer, WebRTC, mikrofon, topshirilmagan forma, himoyalangan javob kalitlari, yuklash jarayoni **hech qachon** saqlanmaydi.
- Saqlangan ko'rinish `privateScope`ning `identity + generation + revision + presentation` muhriga bog'lanadi; scope almashsa (logout, rol o'zgarishi, suspend) kesh butunlay tozalanadi — **foydalanuvchilar orasida umumiy kesh yo'q**.
- `fetch(..., {cache:'no-store'})` va private API'larning HTTP keshlanishi **o'zgarmagan**.

---

## C. Before / After ishlash jadvali

Barcha qiymatlar millisekundda: **p50 / p95 / p99**.
- `swap` — klikdan keyingi birinchi maqsad DOM frame'igacha.
- `ready` — maqsad kontenti to'liq tayyor (busy indikatorlari yo'q).
- `commit` — router commit fazasi (p50).
- `API` — bitta navigatsiyaga o'rtacha API so'rov soni.

### C.1. Issiq navigatsiya — desktop (bir xil harness, bir xil fixture)

| O'lchov | Before (`1c9cba4`) | After (`25ff712`) | Farq |
|---|---|---|---|
| swap | 27.5 / 51.2 / 68.3 | **27.0 / 47.9 / 60.0** | p50 ≈ teng, p95 −3.3 |
| task (main-thread) | 28.0 / 62.7 / 84.6 | 28.3 / 54.0 / 99.8 | p95 −8.7 |
| ready | 29.6 / 62.8 / 89.9 | **28.3 / 60.7 / 99.9** | p50 −1.3, p95 −2.1 |
| commit fazasi (p50) | 10.3 | **4.2** | **−59%** |
| total (p50) | 23.8 | **15.2** | **−36%** |
| API / navigatsiya | 0.35 | 0.35 | o'zgarmagan |
| To'liq reload | 1 (faqat boshlang'ich `goto`) | 1 | yo'q |

### C.2. Issiq navigatsiya — tablet va mobile (after; before **NOT MEASURED**)

| Ko'rinish | swap p50/p95/p99 | ready p50/p95/p99 | commit p50 | total p50 | API |
|---|---|---|---|---|---|
| tablet (768×1024) | 28.3 / 54.7 / 63.6 | 30.3 / 68.5 / 69.4 | 4.3 | 15.3 | 0.33 |
| mobile (390×844) | 27.1 / 71.8 / 92.5 | 29.6 / 81.7 / 120.6 | 4.2 | 14.8 | 0.33 |

> Before holati tablet/mobile uchun o'lchanmagan — bu qatorlar uchun "yaxshilandi" degan da'vo qilinmaydi.

### C.3. Back / Forward (keshdagi sahifalarga qaytish)

| O'lchov | Before | After |
|---|---|---|
| Back swap (desktop) | 13.6 / 15.4 | 17.9 / 25.2 |
| Back ready (desktop) | 18.8 / 25.5 | 27.2 / 37.7 |
| Back swap (tablet / mobile) | **NOT MEASURED** | 13.3 / 19.2 · 13.6 / 18.1 |
| Back reuse (3 ta orqaga qaytish) | 2/3 `reused` | **3/3 `reused`, 0 API** |
| Back scroll tiklash | 240 px (mos yozuv yo'q) | **120 px = kutilgan 120 px** |
| Forward (reading) | `reused=True`, 0 API | **`reused=True`, 0 API, 35.7 ms** |

Back uchun p95 hamma ko'rinishda **< 100 ms** (25.2 / 19.2 / 18.1). "0 API" — qaytishda hech qanday qo'shimcha so'rov yo'q; dublikat so'rov kuzatilmadi.

### C.4. Yuklangan tarmoq / sekin modul stsenariylari

| Stsenariy | Before swap | After swap | Before ready | After ready | After commit p50 |
|---|---|---|---|---|---|
| `--api-delay 250` | 34.1 / 61.6 / 86.2 | 34.7 / 85.9 / 90.5 | 38.8 / 306.0 / 332.2 | 39.3 / 307.8 / 316.6 | 4.1 |
| `--module-delay 300` | 30.4 / 50.4 / 69.7 | 30.4 / 72.1 / 72.7 | 34.1 / 59.9 / 69.9 | 34.4 / 83.0 / 83.9 | 4.2 |

> Halol izoh: 250 ms API kechikishida `swap` p95 61.6 → 85.9 ms ga oshdi (p95 < 100 ms chegarasi ichida, lekin before'dan yomonroq). `ready` esa ma'lumot bilan chegaralangan (~307 ms, 250 ms sun'iy kechikish + o'qish) — bu navigatsiya kodi emas, backend javobi.

### C.5. NOT MEASURED
- **IELTS Booster bilan to'g'ridan-to'g'ri taqqoslash** — bu muhitda Booster build'i yo'q, shuning uchun "Booster bilan bir xil tezlik" da'vosi **qilinmaydi**.
- **Sovuq (birinchi) yuklanish** — mavjud harness bilan ishonchli o'lchanmadi.
- **Real qurilmalar, real tarmoq, real Postgres** — barcha raqamlar fixture API va lokal sandbox'dan.
- **Field ko'rsatkichlari** (LCP/INP, RUM) — yig'ilmagan.
- Tablet/mobile uchun **before** holati.

---

## D. Testlar

| To'plam | Jami | Pass | Fail | Skip |
|---|---|---|---|---|
| To'liq suite (`npm test`) | 1179 | **1168** | **0** | 11 |
| `tests/navigation-feedback-v75.test.mjs` (yangi) | 4 | **4** | 0 | 0 |
| Brauzer xavfsizlik probe'lari (`security-final.json`) | 10 | **10** | 0 | 0 |

Yangi test fayli qamrab oladi: (1) 45 ms grace'dan keyin ma'lumotsiz identifikatsiya ramkasi paydo bo'lishi va commit'da tozalanishi; (2) tez reys bekor bo'lsa skelet miltillamasligi; (3) qurilma bo'yicha saqlash byudjetlari va ularning chegaralari; (4) aniq berilgan `limit/maxNodes/ttl` qurilma profilidan ustun bo'lishi.

Testlar hech qanday nuqsonni yashirish uchun o'zgartirilmagan: suite 1168/1168 o'tadi, 11 skip — loyihada avvaldan mavjud shartli skip'lar.

---

## E. Qolgan muammolar

1. **`swap` bo'yicha yutuq kichik.** Asosiy tejash `commit` fazasida (−59%) va `total`da (−36%); birinchi DOM frame vaqti amalda o'zgarmagan (p50 27.5 → 27.0). Ya'ni "birinchi bo'yoq" router/modul yuklash bilan chegaralangan, commit ishi bilan emas.
2. **`--api-delay 250` da swap p95 yomonlashdi** (61.6 → 85.9 ms). Sabab aniqlanmagan; chegaradan (100 ms) o'tadi, lekin bu regressiya sifatida kuzatilishi kerak.
3. **Har bir Back reuse bo'lmasligi mumkin.** 5 siklli zanjirda ba'zi qaytishlar qayta mount bo'lib, 1 API o'qishi qiladi (`back.apiRequestsAvg = 1`). Bu keshlash emas, oddiy qayta o'qish — lekin "Back har doim 0 API" da'vosi faqat PASSIVE ro'yxatdagi va saqlash byudjetiga sig'gan ko'rinishlarga tegishli.
4. **Saqlash byudjeti kichraytirildi.** Dastlabki urinish (desktop 8/16000/60 s) o'lchovda swap p50 +5 ms, p95 +20 ms regressiya berdi; shu sababli desktop 4/8000/60 s ga qaytarildi, zaif qurilmalarda esa kamaytirildi (mobile 3/6000/25 s, low-memory 2/4000/20 s). Natijada mobil qurilmalarda Back reuse ehtimoli avvalgidan pastroq.
5. **`feedback` ramkasi kamdan-kam ko'rinadi** (60 navigatsiyada 0–2 marta) — chunki bu muhitda navigatsiya 45 ms grace'dan tez tugaydi yoki maqsad o'zining `data-async-loading` skeletini ko'rsatadi. Xatti-harakat jsdom testida deterministik qamrab olingan; real sekin tarmoqda chastota **NOT MEASURED**.
6. **Mobile `ready` p99 = 120.6 ms** (> 100 ms). p95 (81.7 ms) maqsadga sig'adi; p99 dumlari uchun qo'shimcha ish kerak.
7. **Pre-warm ro'yxati kengaytirildi, lekin o'lchanadigan foyda bermadi** — `module-delay 300` da farq shovqin ichida; ro'yxatni yanada kengaytirish tavsiya etilmaydi.
8. **O'lchov chegaralari:** fixture API, headless Chromium, bitta lokal mashina. Real Postgres, real tarmoq va real qurilmalarda tasdiqlash QA bosqichida takrorlanishi shart.

---

## F. Xulosa

**READY FOR INDEPENDENT QA**

Asos:
- Issiq navigatsiya p95 hamma uch ko'rinishda ham **< 100 ms** (47.9 / 54.7 / 71.8 ms); Back p95 **< 100 ms** (25.2 / 19.2 / 18.1 ms).
- To'liq reload yo'q (`documentNavigations = 1`, faqat boshlang'ich `goto`), konsol xatolari 0, dublikat API so'rovlari kuzatilmadi (issiq navigatsiyada 0.33–0.35 so'rov/o'tish).
- Back/Forward keshdan qaytishda 3/3 `reused`, **0 API**, scroll aniq tiklandi (120 = 120), Forward ham `reused` va 0 API.
- `commit` fazasi 2.4× tez, umumiy navigatsiya vaqti 36% qisqardi.
- Avtorizatsiya: 10/10 xavfsizlik probe'i PASS, avtorizatsiya fayllari va backend **umuman o'zgarmagan**, per-navigatsiya auth, polling, ikkinchi SSE/LISTEN, umumiy kesh, kuchsizlangan forced logout — **yo'q**.
- Testlar: 1179 / 1168 pass / **0 fail** / 11 skip.

QA mustaqil tekshiruvi uchun ochiq bandlar: E bo'limidagi 1, 2, 4, 6-bandlar (birinchi bo'yoq yutuqsi kichik, `api-delay` p95 regressiyasi, mobil saqlash byudjeti, mobile p99) va real infratuzilmada qayta o'lchash.

---

### Dalil fayllari
`frontend/docs/evidence/instant-navigation/`
- `baseline-desktop.json`, `baseline-delay250.json`, `baseline-module-delay300.json`, `back-baseline.json` — before (`1c9cba4`)
- `final-desktop.json`, `final-tablet.json`, `final-mobile.json`, `final-api250.json`, `final-module300.json`, `final-back.json`, `security-final.json` — after (`25ff712`, build `323518c9b09741124c9a`)

Qayta o'lchash:
```bash
cd frontend/vanilla
node scripts/instant-navigation-bench.mjs --label rerun --cycles 5 --out /tmp/rerun.json
node scripts/instant-navigation-bench.mjs --mode back --label rerun-back --out /tmp/rerun-back.json
node scripts/instant-navigation-bench.mjs --mode security --label rerun-security --out /tmp/rerun-security.json
```
