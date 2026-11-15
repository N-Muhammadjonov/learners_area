# Main merge auditi — 2026-11-15, Asia/Tashkent

## Hukm

Promptdagi barcha ishlar xatosiz va to‘liq tugagan deb aytish mumkin emas.
Koddagi regressiyalar tuzatildi. Lokal dalil bilan production dalili ajratildi.
Academy/Tuition boshqariladigan muhitda migratsiya va alohida faollashtirishsiz yopiq qoladi.
Main’ga kod birlashtirish yangi modulning production’da ishlashini isbotlamaydi.

## Tekshirilgan kirishlar va vakolat

- Main: `1231d6fa0db1ef283c3f97917d49a845cb8d581b`.
- So‘ralgan branch: `arena/learners-area-next`, `c7519c0cea2d6d4fbb2276fe1df1049e78108e25`.
- Integratsiya: `audit/learners-area-next-main-20261115`; ikkala tarix saqlanadi.
- Foydalanuvchi 15-noyabrda tekshirish, tuzatish va main’ga push qilishga aniq ruxsat berdi.
- Yuklangan prompt va repodagi `LEARNERS_AREA_FINAL_WORK_META_PROMPT.md` SHA-256 qiymati bir xil:
  `ee933499ea3bfb915bacbe3766c0fcc7e10b37eb83d0a6d1d6498bc63cf056ed`.
- Production schema, moliyaviy yozuv, secret, merchant yoki biometrik yig‘ish o‘zgartirilmadi.
- Aloqasiz ochiq PR’lar birlashtirilmadi. Main’dagi 12 ta keyingi landing commit saqlandi.

## Topilgan va tuzatilgan xatolar

| ID | Asl sabab | Tuzatish va dalil |
|---|---|---|
| A-01 | Support birlashtirilgan, eski teacher URL canonical alias jadvaliga kiritilmagan | `private-modules` manbalari va Python route katalogida alias; query/hash saqlanadi; Management parity testi saqlangan |
| A-02 | CEFR regressiyasi main o‘chirgan `landing-inline.js`dan eski savollarni ajratgan | Joriy landing saqlandi; 150 savolning avvalgi tekshirilgan fayli checksum bilan qotirildi; 30 level/skill katagi va answer/audio/passage shartlari tekshiriladi |
| A-03 | Validator uchta variant bo‘lsa ham `range(4)` ishlatgan | `range(len(options))`; to‘rtinchi javobni rad etuvchi yangi test |
| A-04 | Eski dependency pinlari ma’lum zaifliklarni olib kelgan | FastAPI 0.136.3 / Starlette 1.10.0; Rollup 4.68.3, fflate 0.8.3, Zod 4.6.7, selector-parser 6.1.6 va yangilangan transitive locklar |
| A-05 | Zod 3 oversized array tekshiruvini barcha elementlarda davom ettirgan | Haqiqiy Zod 4 API’iga o‘tildi; `/v3`ga yashirin qaytish yo‘q; dictionary limitida 30 001 noto‘g‘ri element bitta `too_big` bilan to‘xtaydi |
| A-06 | TypeScript’da o‘chirilgan React komponent turlariga import, yo‘q overlay turi va takror `startedAt` bo‘lgan | Mavjud domen turlari, aniq overlay va Listening savol DTO; takror maydon olib tashlandi; `npm run typecheck` |
| A-07 | RIWI katalogi manba xeshlariga mos kelmagan | Generator qayta ishlatildi: 144 route / 571 source; katalog drift tekshiruvi CI’da saqlangan |
| A-08 | Capability matrix tarixiy “yo‘q”/“test yiqiladi” gaplarini joriy holat qilib ko‘rsatgan | Qatorlar kod va receipts bilan yangilandi; risk va priority ustunlari 15 ustunli kontraktga keltirildi |
| A-09 | Faqat main’da ishlagan CEFR workflow’i o‘chirilgan inline landingni `node --check` bilan ochgan | Joriy landing page/runtime/markup tekshiriladi; ayni gate endi PR’da ham ishlaydi; scoring va UI assertionlari saqlangan |

Yangi FastAPI 0.163.1 router inventari shaklini o‘zgartirgani uchun nomzod sifatida rad etildi.
Inventar assertionlari qisqartirilmadi. Xavfsizlik tuzatishlari bilan mos kelgan 0.136.3 tanlandi.

## Prompt talablari bo‘yicha natija

| Bo‘lim | Holat | Kod / dalil | Ochiq mezon |
|---|---|---|---|
| 0–1: haqiqat, branch, ziddiyatlar | `VERIFIED_LOCALLY` | Ushbu audit, capability matrix, ikki parentli integratsiya | Production schema o‘qishi tasdiqlanmagan |
| 2–3: ustuvorlik va domen dalili | `PARTIAL` | Domain contracts, rasmiy manbalar, moliyaviy fixtures | Xaridor siyosati, joriy huquq va tijorat tasdig‘i |
| 4–5: arxitektura va ma’lumot | `VERIFIED_LOCALLY` | FastAPI monolit, 131 SQL, 189 typed table migratsiya tekshiruvi | Content-bearing staging upgrade |
| 6: barcha rol uchun UX | `PARTIAL` | Native UI/JSDOM; akademiya feature gate | Bitta uzluksiz real brauzer buyer rehearsal |
| 7: guruh va enrollment | `VERIFIED_LOCALLY` | `academy_groups.py`, 1122; last-seat, transfer, tarix | Production faollashtirish |
| 8: jadval va sessiyalar | `VERIFIED_LOCALLY` | `academy_sessions.py`, 1123; parallel collision, bayram/reschedule | Alohida normalizatsiyalangan xona katalogi yo‘q |
| 9: davomat | `VERIFIED_LOCALLY` | `academy_attendance.py`, 1124; correction/retry/guardian scope | Jonli markaz sinovi |
| 10: tuition, ledger, refund, kassa | `VERIFIED_LOCALLY` | `tuition_ledger.py`, 1115–1121; exact amount, balans, parallel callback | Real vendor adapter, hisob siyosati va fiskal receipt yo‘q |
| 11: payroll | `VERIFIED_LOCALLY` | `academy_payroll.py`, 1126; accrual, adjustment, payout confirmation | Xaridor shartnomasi, soliq va bank integratsiyasi |
| 12: qabul CRM | `VERIFIED_LOCALLY` | `academy_leads.py`, 1125; trial, dedupe, atomic conversion | Haqiqiy pilot |
| 13: filiallar | `PARTIAL` | Guruh filtri va collision scope | Filialga cheklangan moliya/vakolat yo‘q; shartli P1 |
| 14: ota-ona | `VERIFIED_LOCALLY` | Guardian va bot suites; asl xodimga reply, revoke, dedupe | Haqiqiy Telegram hisoblari bilan ikki tomonlama tasdiq |
| 15: IELTS va coin | `VERIFIED_LOCALLY` | To‘liq regression; bank checksum; coin/lock/attempt testlari | Audio/WebRTC/STT va qurilma qabul dalili |
| 16: uch innovatsiya | `PARTIAL` | Journey, Rescue, Capacity; permission/source tests | Pilot task-time, false-positive va foyda o‘lchovi |
| 17: passkey / kamera | `MISSING` / `BLOCKED_EXTERNAL` | Kamera yoqilmagan; passkey implement qilinmagan | Optional P2, alohida identity va privacy qabul mezoni |
| 18: xavfsizlik | `PARTIAL` | IDOR/role suites, dependency gates, Host regressiyasi | To‘liq ASVS L2 control matrix va mustaqil assessment |
| 19: 10k | `PARTIAL` | Tarixiy lokal 10k dataset, 50–1000 parallel HTTP | 100+da SLO yiqilgan; mixed writes, 2000-submit burst, soak va staged scale yo‘q |
| 20: tiklash/operatsiya | `PARTIAL` | Sintetik restore tarixi, health, durable outbox | Joriy staged restore, RPO/RTO va kuzatuv dalili |
| 21: onboarding/import | `PARTIAL` | CSV/XLSX mapping, preview, 10k import, identity linking | Xaridorga xos group/history/opening-balance import xaritasi |
| 22: UI/accessibility/IP | `PARTIAL` | Native route/theme/focus va responsive regressionlar | To‘liq WCAG, o‘quv materiallari huquqiy manba inventari |
| 23: CI | `VERIFIED_LOCALLY` | Full suites, migrations, typecheck, security gates | Yangi commit uchun GitHub Actions dalili quyida |
| 24–25: gate va buyer hikoyasi | `PARTIAL` | Bog‘langan sintetik ASGI journey | Barcha modul, live provider va browserni birlashtirgan qabul yo‘q |
| 26: yagona owner ro‘yxati | `VERIFIED_LOCALLY` | `docs/SALE_READY_MANUAL_ACTIONS.md` | 7 sale / 3 pilot / 1 handover / 1 optional band ochiq |
| 27: topshirish hujjatlari | `PARTIAL` | Architecture, contracts, capability, recovery, demo va audit | Tashqi qabul va haqiqiy pilot imzosi |
| 28: narx/xarajat | `PARTIAL` | Scenario paketlari va ROI farazlari | Joriy provayder narxlari bilan to‘liq 1k/5k/10k xarajat modeli yo‘q |
| 29: yakunlash qoidasi | `VERIFIED_LOCALLY` | Kamchiliklar yashirilmadi; main ruxsati joriy xabardan olindi | “EVERYTHING IS READY” = NO |

`VERIFIED_LOCALLY` faqat ko‘rsatilgan test doirasini anglatadi. Bitta ham yangi
imkoniyat production’da tekshirildi deb e’lon qilinmaydi. Oddiy joy nomi filtri
filiallar orasidagi vakolat izolyatsiyasi hisoblanmaydi.

## Tekshiruv amallari

Muhit: Linux x86_64, Python 3.12.14, Node 24.22.1, ajratilgan PostgreSQL 18.6.

```bash
npm ci
npm ci --prefix frontend/vanilla
python -m pip install -r services/backend/requirements-dev.txt
python scripts/build_native_assets.py
python scripts/serve.py --check
npm run typecheck
npm run test:validation
npm test
cd services/backend
CI=1 python -m pytest -q -ra
cd ../..
npm run test:migrations
npm run backend:test:postgres
npm run build:browser
npm run test:bundles
pip-audit -r services/backend/requirements.txt
npm audit --audit-level=high
npm --prefix frontend/vanilla audit --audit-level=high
```

PostgreSQL testlari qat’iy lokal `127.0.0.1:55439/coin_qa`dan foydalanadi.
Telegram bot testlari alohida muhit va faqat sintetik qiymatlar bilan bajarildi.
Worker kontrakti synthetic authority/R2 bilan haqiqiy FastAPI ASGI’ni chaqirdi.

## Cheklovlar va release chegarasi

- Lokal Chromium ishga tushishi host Unix socket ruxsatida to‘xtadi. Bu brauzer
  dalili sifatida hisoblanmaydi. Repository CI’dagi Chromium gate o‘tdi; natija yuqorida qayd etilgan.
- Supabase schema SELECT va Cloudflare account metadata o‘qishi avtomatik approval
  review’da rad etildi. Rad etish chetlab o‘tilmadi. Haqiqiy student, parent yoki
  moliyaviy ma’lumot eksport qilinmadi.
- Railway’da tekshirilgan boshlang‘ich production deployment:
  `85996d8c-b573-4f06-93ea-541c3fd1c03e`, main `1231d6fa`, `SUCCESS`.
  Bu faqat eski deploy holatini tasdiqlaydi.
- npm’da 4 ta moderate dev-tool finding (`drizzle-kit` → `esbuild` zanjiri)
  qolgan. Python requirements’da ma’lum finding yo‘q. npm high/critical = 0.
  Bu to‘liq ASVS tekshiruvini almashtirmaydi.
- Vendor adapter, scale/performance, ASVS, content provenance, cost model va
  browser rehearsal muhandislik ishlari. Ular owner qo‘lda bajaradigan ish deb
  ko‘rsatilmagan. Tashqi ruxsat/merchant/pilot ishlari faqat yagona manual faylda.

## Yakuniy test va GitHub dalili

| Tekshiruv | Natija |
|---|---|
| To‘liq backend, FastAPI 0.136.3 / Starlette 1.10.0 | 7 502 passed, 287 subtests passed, 0 fail / skip / xfail; 165.54 s |
| To‘liq frontend, yakuniy dependency va source | 1 816 passed, 0 fail, 11 mavjud legacy-fixture skip; 68.58 s |
| Telegram bot | 92 passed, 0 fail; 5.98 s |
| Live signalling | 7 passed, 0 fail; 0.43 s |
| Mavjud Worker → FastAPI ASGI | 101 checks passed; synthetic R2/identity |
| TypeScript | `npm run typecheck`, exit 0 |
| Zod bounded/domain contracts | 3 passed, 0 fail |
| Yangi Host/URL dependency regressiyasi | 4 passed; to‘liq backend hisobiga kirgan |
| Migratsiya kontrakti | 4 passed, 0 fail |
| Fresh migration runner | 110 schema / 21 named content-deferred / 189 typed tables / 9 ASGI checks |
| Browser bundle va uning testlari | build exit 0; 2 passed |
| Python dependency audit | 0 known vulnerabilities |
| Root npm audit | 0 high / critical, 4 moderate dev-tool findings |
| Frontend npm audit | 0 vulnerabilities |
| Native build va ASGI startup check | passed; 1 028 files / 144 routes |

Starlette TestClient mavjud `httpx` transporti uchun deprecation warning chiqaradi;
server yoki test failure emas. 11 frontend skip tashqi owner Listening legacy
fixture’iga bog‘langan, uydirma fixture bilan yashirilmagan.

Kod commit’i: `bbfe29225b47980736c0fb47caa95ad0944044ac`. [PR #197](https://github.com/N-Muhammadjonov/learners_area/pull/197).

- [Full Stability 43721200756](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43721200756): SUCCESS; backend 7 502 + 287 subtest, 125.09 s; frontend 1 816, 0 fail, 11 mavjud skip.
- [Parent Connect](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43721200761): SUCCESS.
- [Coin Economy](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43721200758): SUCCESS.
- [Leaderboard](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43721201134): SUCCESS.
- CI Chromium: Rescue/Capacity → FastAPI → PostgreSQL, 5 rol, 1440/390 px, 27-qator sahifalash o‘tdi. Motion parity 4 ta day/night × desktop/mobile juftlikda o‘tdi. Bu real provider/audio tekshiruvi emas.
- Vercel commit status: SUCCESS. Production rollout dalili sifatida olinmaydi.

Ushbu receipt commit’i faqat dalil/hujjatni yangilaydi; bajariladigan kod va dependency locklari yuqoridagi tekshirilgan commit bilan bir xil.

### Tekshirilgan rasmiy texnik manbalar

- [Starlette Host header security advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-86qp-5c8j-p5mr)
- [FastAPI release notes](https://fastapi.tiangolo.com/release-notes/)
- [Rollup path traversal advisory](https://github.com/rollup/rollup/security/advisories/GHSA-mw96-cpmx-2vgc)
- [Zod 4 migration guide](https://zod.dev/v4/changelog)
- [Zod v3 collection-limit issue](https://github.com/colinhacks/zod/issues/6653): paket versiyasini almashtirib `/v3`da qolish haqiqiy tuzatish emas.

## Main’dan keyingi workflow tekshiruvi

`f1398961` merge’i Railway’da `0a4cfa3e-9234-4d32-91a2-ba05e9ce216a` deploymenti bilan SUCCESS bo‘ldi. Bu yangi modullar yoki real providerlarning E2E qabulini anglatmaydi.

Main-only CEFR [43722184851](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43722184851) runida backend scoring/audio gate o‘tdi, frontend sintaksis qadami eski `landing-inline.js` manzili tufayli yiqildi. Joriy landing manzillari bilan sintaksis va ikki focused UI fayli lokal o‘tdi. `cefr-diagnostic.yml` endi ayni path-filter bilan `pull_request`da ham bajariladi; shunday qilib bu xato merge oldida ushlanadi. Ushbu keyingi tuzatish bajariladigan ilova kodini yoki dependency locklarini o‘zgartirmaydi.
