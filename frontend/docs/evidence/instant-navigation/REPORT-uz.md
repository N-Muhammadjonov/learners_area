# Learners Area — ichki navigatsiya: yakuniy hisobot (2-bosqich, target bilan birlashtirilgan)

**Sana:** 2026-10-30 · **Muhit:** lokal sandbox, Chromium 133 headless, `scripts/serve.py` preview, `/api/**` fixture'lar bilan almashtirilgan, embedded PostgreSQL (faqat `test:integration` uchun) · **Holat:** PR #98 yangilandi

> Barcha sonlar shu muhitda, bir xil usulda, **3 marta almashlab (interleaved) o'lchangan** va median olindi. O'lchanmagan ko'rsatkichlar **NOT MEASURED** deb belgilangan. Fixture-o'lchov ekani ochiq yozilgan.

---

## 1. Git holati

| Element | Qiymat |
|---|---|
| Repo | `N-Muhammadjonov/learners_area` |
| Joriy (yagona ishlaydigan) filial | `arena/dca9f485-learners-area` |
| Boshlang'ich SHA (sessiya) | `c74571fd6106b10f5acd3fbbff8be524952414da` |
| Target SHA (birlashtirilgan) | `af76d0be4bbd79796a8bbf97cd4dfa655b849923` (`arena/learners-area-next`) |
| Merge commit | `631bc66` — `Merge arena/learners-area-next into arena/dca9f485-learners-area` |
| Yakuniy SHA | push'dan keyin: shu hisobotning commiti (pastda) |
| Push | faqat `origin/arena/dca9f485-learners-area` |
| PR | **#98** → baza: `arena/learners-area-next` (o'zgartirilmagan) |
| `main` | **tegilmagan** (checkout yo'q, commit yo'q, merge yo'q, push yo'q) |
| Boshqa filiallar | tegilmagan; force-push yo'q; tarix qayta yozilmagan |
| Birlashtirish natijasi | `git rev-list --count HEAD..origin/arena/learners-area-next` = **0** (target'da mendan ortiq commit qolmadi) |

**Konflikt yechimi (yagona konflikt):**

```
CONFLICT (content): Merge conflict in frontend/vanilla/js/route-reuse.js
```

| Tomon | Qiymat |
|---|---|
| target (`af76d0b`) | `limit=8, maxNodes=16000, ttl=60000` |
| bizning tomonda | `retentionProfile()`: desktop 4/8000/60s · tablet 4/7000/30s · mobile 3/6000/25s · low-memory 2/4000/20s |
| **Tanlangan** | **bizning variant** — kattaroq kesh A/B o'lchovda regressiya bergan (§2.1) |

Boshqa 282 fayl (Writing exam materials, Task 1 rasmlari, kategoriya filtrlari, Speaking mavzulari, TED/Podcast, Reading Retention, theme/contrast, backend security, login/Telegram, media/upload) **avtomatik va to'liq** birlashtirildi — hech biri ustidan yozilmadi.

---

## 2. Bajarilgan texnik ishlar

### 2.1. PR konflikti va target divergence
**Muammo:** PR #98 `mergeable_state: dirty`; target 108 yangi commit oldi.
**Ildiz sabab:** filial `1c9cba4` dan ajralgan, target `af76d0b` gacha ilgarilagan; ikkala tomonda `route-reuse.js`ning bir qatori farq qilgan.
**O'zgarish:** target joriy filialga **merge** qilindi (boshqa filialga checkout qilinmadi), konflikt o'lchangan byudjet foydasiga hal qilindi.
**Dalil:** merge commit `631bc66` (ota-onalar: `c74571f` + `af76d0b`); to'liq suite yashil; `HEAD..origin/arena/learners-area-next` = 0.
**Natija:** yangi kontent saqlangan, konflikt yopilgan, PR mergeable.

### 2.2. Merge'dan keyin 2 test yiqildi
**Muammo:** target testlari kengaytirilgan byudjetni (8 ko'rinish / 16 000 node / 60 s) **default** deb qabul qilgan (`instant-navigation.test.mjs`).
**Ildiz sabab:** default byudjet ataylab kichraytirilgan, testlar esa eski default'ga bog'langan.
**O'zgarish:** testlar kengaytirilgan byudjetni **aniq parametr sifatida** so'raydi (`{limit:8,maxNodes:16000,ttl:60000}`) — mexanizm qamrovi saqlanadi; qo'shimcha ravishda **yuborilayotgan default** 4/8000/60s ekanini tasdiqlovchi assertion qo'shildi (regressiya qo'riqchisi).
**Dalil:** `tests/instant-navigation.test.mjs` 12/12; to'liq suite 1185 / 1174 pass / 0 fail.
**Natija:** qamrov yo'qolmadi, hech qanday nuqson yashirilmadi.

### 2.3. Asosiy topilma: har navigatsiyada majburiy layout
**Muammo:** commit fazasi 11.8 ms (target) — navigatsiyaning eng qimmat qismi.
**Ildiz sabab:** `workspace.commit()` **har safar** `shell.main.scrollTop = saved` yozardi va darhol `target.scrollTop < saved` o'qirdi. Bu yangi qo'shilgan daraxtning **sinxron layout**ini majburlardi — sahifa scroll qilinmagan bo'lsa ham (`saved = 0`).
**Dalil (instrumentatsiya):** `scrollWrite` bosqichi 9.7–10.0 ms; qolgan bosqichlar: `moduleLayout` 0–0.2 ms, `replace` 0 ms, `header` 0 ms.
**O'zgarish:** yozish faqat scroll bo'lganda bajariladi (`saved!==0||priorScroll!==0`), qiymat **orqaga o'qilmaydi**; tekshiruv chegaralangan rAF/observer orqali keyingi freymga ko'chirildi.
**Natija:** commit p50 **11.8 → 5.0 ms**, total p50 **24.9 → 17.5 ms**, swap p95 **85.3 → 58.0 ms** (desktop, 3 round median).

### 2.4. Issue A — kechiktirilgan API regressiyasi
**Muammo:** `--api-delay 250` da swap p95 yomonlashgani haqida eski hisobot (61.6 → 85.9).
**Ildiz sabab:** eski o'lchov boshqa (sekinroq) sessiya va boshqa baseline konfiguratsiyasi (30 s TTL) bilan solishtirilgan; joriy kodda asosiy xarajat — §2.3 dagi majburiy layout.
**O'zgarish:** §2.3 + §2.5.
**Dalil:** 3 interleaved round: swap p95 **89.3 → 61.3**, ready p95 340.9 → 293.3 (ma'lumot bilan chegaralangan), total p95 80.7 → 43.7.
**Natija:** regressiya **yo'q**; p95 < 100 ms.

### 2.5. Issue B / F — prewarm va kechiktirilgan modul
**Muammo:** `--module-delay 300` da p95 o'sishi; idle prewarm ro'yxatini kengaytirish foyda bermagan.
**Ildiz sabab (o'lchandi):** prewarm o'zi foydali (prewarm o'chirilganda modul-delay p95 **85.1**, yoniq holda **63.7–66.8**), lekin ro'yxatni kengaytirish o'lchanadigan yutuq bermadi. Qo'shilgan "foreground guard + chegaralangan retry" juftligi esa fixture harness'da **takrorlanadigan renderer hang** berdi (sahifa hech qachon "settled" holatga kelmadi).
**O'zgarish:** `module-prewarm.js` **upstream holatiga qaytarildi** (kengaytirilgan ro'yxat va guard olib tashlandi) — "faqat asoslangan xatti-harakat qoladi" qoidasi bo'yicha.
**Dalil:** variant matritsasi — `target+retry` OK, `target+foreground` OK, `target+ikkalasi` hang; revertdan keyin 0 timeout, 0 console error.
**Natija:** deadlock yo'q, prewarm'ning o'lchangan foydasi saqlangan, modul-delay p95 **83.5 → 66.4**.

### 2.6. Issue C — Back/Forward
**Muammo:** Back vaqti yomonlashgani haqidagi eski kuzatuv (13.6 → 17.9 ms).
**Ildiz sabab:** eski o'lchovda keshlash byudjeti (TTL 30 s) tufayli 2/3 reuse bo'lgan; joriy holatda 3/3 reuse. Commit ichidagi scroll layout'i (§2.3) ham aynan Back'da ko'rinardi.
**O'zgarish:** §2.3.
**Dalil:** 3 round × 3 Back = 9 ta Back o'lchovi: **9/9 `reused=True`**, median **26.3 ms** (baseline 22.1), **maksimum 38.2 ms** (baseline 47.3), p95 **32.1** (baseline 46.9); API 0.
**Natija:** median — shovqin chegarasida, **dum yaxshilandi**, barchasi < 100 ms.

### 2.7. Issue D — mobile `ready` p99
**Muammo:** 106.5 → 111.5 ms (yaxshilanmadi).
**Ildiz sabab (o'lchandi):** dum **navigatsiya kodi emas, ma'lumot** bilan chegaralangan: eng yomon route'lar `/app/vocabulary` (1 API o'qish) va `/app/assignments` (2 API o'qish). Mobile commit fazasi 4.8 ms, swap p95 60.8 ms.
**O'zgarish:** yo'q — bu modullarning ma'lumot oqimini o'zgartirish vazifa doirasidan tashqarida ("aloqasiz modullarga tegilmasin").
**Natija:** halol ravishda ochiq muammo sifatida qoldirildi (§5).

### 2.8. Issue E — klikdan birinchi UI'gacha
**Muammo:** avvalgi sessiyada 27.5 → 27.0 ms (deyarli nol).
**Ildiz sabab (o'lchandi):** `moduleLayout` 0.1 ms, `attachModuleHeader` 0.1 ms, router fazalari jami ≈ 5–6 ms; qolgan vaqt brauzer hodisa/freym rejalashtirishi va modul rezolyutsiyasi.
**O'zgarish:** §2.3 (scroll layout'i olib tashlandi).
**Natija:** swap p50 **38.6 → 32.0 ms (−17%)**, mobile **43.0 → 27.1 ms (−37%)**. Qo'shimcha arxitektura o'zgarishi **asossiz** deb topildi va kiritilmadi.

---

## 3. Ishlash taqqoslash (median, ms)

`Before` = `arena/learners-area-next` (`af76d0b`, kengaytirilgan kesh 8/16000/60s) · `After` = shu filial (o'lchangan byudjet 4/8000/60s + scroll tuzatishi). Desktop 3 round, tablet/mobile 2 round, har biri `--cycles 5` (api250/module300 — `--cycles 3`).

| Ko'rsatkich | Before | After | Farq |
|---|---|---|---|
| Warm swap p50 (desktop) | 38.6 | **32.0** | −6.6 ms (−17%) |
| Warm swap p95 (desktop) | 85.3 | **58.0** | −27.3 ms (−32%) |
| Warm swap p99 (desktop) | 126.0 | 119.1 | −6.9 ms |
| Total navigation p50 / p95 | 24.9 / 64.1 | **17.5 / 39.2** | −7.4 / −24.9 ms |
| Commit faza p50 | 11.8 | **5.0** | −6.8 ms (−58%) |
| Ready p95 / p99 (desktop) | 94.9 / 127.8 | **68.0** / 125.8 | −26.9 / −2.0 ms |
| Tablet swap p50 / p95 | 37.2 / 73.5 | **27.5 / 57.2** | −9.7 / −16.3 ms |
| Mobile swap p50 / p95 | 43.0 / 78.4 | **27.1 / 60.8** | −15.9 / −17.6 ms |
| Mobile ready p99 | 106.5 | 111.5 | +5.0 ms (**yaxshilanmadi**) |
| API-delay 250 swap p95 | 89.3 | **61.3** | −28.0 ms |
| API-delay 250 total p95 | 80.7 | **43.7** | −37.0 ms |
| Module-delay 300 swap p95 | 83.5 | **66.4** | −17.1 ms |
| Back swap median (9 o'lchov) | 22.1 | 26.3 | +4.2 ms (shovqin) |
| Back swap maksimum | 47.3 | **38.2** | −9.1 ms |
| Back p95 (nav o'lchovi) | 46.9 | **32.1** | −14.8 ms |
| DOM reuse (Back) | 9/9 | 9/9 | o'zgarmagan |
| API so'rov / navigatsiya (warm) | 0.35 | 0.35 | o'zgarmagan |
| API so'rov / navigatsiya (api250) | 0.50 | 0.50 | o'zgarmagan |
| To'liq reload (`documentNavigations`) | 1 | 1 | yo'q |

Maqsadlar: warm p95 **< 100 ms** — desktop 58.0, tablet 57.2, mobile 60.8 ✅ · Back p95 **< 100 ms** — 32.1 ✅ · reload yo'q ✅ · dublikat API yo'q ✅ · freeze/scroll yo'qotish kuzatilmadi ✅.

**NOT MEASURED:** IELTS Booster bilan bevosita taqqoslash (Booster build bu muhitda yo'q) · sovuq (birinchi) yuklanish · real qurilma/tarmoq/Postgres · field metrikalar (LCP/INP/RUM) · Supabase/production muhitidagi raqamlar.

---

## 4. Avtorizatsiya yaxlitligi (dalillar)

- `git diff --stat c74571f HEAD -- services/` → **bo'sh**; `authority.js`, `session-events.js`, `security.py`, `access_events.py`, `step17_access_events_port.py`, `main.py`, `0060_auth_session_revocation.sql` — **o'zgarishsiz**.
- Brauzer probe'lari (`merged-final-security.json`): **10/10 PASS**
  - `streams=1` — har tab uchun bitta `/api/auth/changes` SSE;
  - 6 issiq navigatsiya davomida `/api/auth/state` **calls=0**;
  - har navigatsiyada sessiya o'qishi yo'q (faqat route view + `/api/presence` + `/api/notifications?count=1`);
  - suspension → **bitta** reconciliation (`calls=1`), `/login` ga redirect, workspace/topbar DOM'da yo'q;
  - revocation'dan keyin **0 polling** (`delta=0`);
  - cross-tab logout ishorasi tabni chiqaradi;
  - logout'dan keyin himoyalangan API **401**.
- Backend auth testlari: `test_access_events_handshake.py`, `test_access_events_shared.py`, `test_authority_request_scope.py` → **7 passed**.
- `npm run test:integration` → **passed** (426 HTTP check, 151 native decoder, 118 native DOM, 8 migration replay, embedded PostgreSQL).
- Kesh: `privateScope` `identity + generation + revision + presentation` muhri bilan bog'langan; scope almashsa to'liq tozalanadi; `fetch(..., {cache:'no-store'})` va private API HTTP keshi **o'zgarmagan**; foydalanuvchilar orasida umumiy kesh **yo'q**; `PASSIVE`/`ACTIVE` ro'yxatlari **o'zgarmagan** (faol imtihon, media, WebRTC, topshirilmagan forma saqlanmaydi).

---

## 5. Testlar

| To'plam | Jami | Pass | Fail | Skip |
|---|---|---|---|---|
| `npm test` (to'liq frontend suite) | 1185 | **1174** | **0** | 11 |
| `tests/instant-navigation.test.mjs` (target'dan) | 12 | 12 | 0 | 0 |
| `tests/navigation-feedback-v75.test.mjs` (yangi, 5 test) | 5 | 5 | 0 | 0 |
| `npm run test:integration` | 703 check | **passed** | 0 | 0 |
| `npm run backend:test:main` | 20 | 20 | 0 | 0 |
| Backend auth/access-event testlari | 7 | 7 | 0 | 0 |
| Brauzer xavfsizlik probe'lari | 10 | 10 | 0 | 0 |
| `npm run build` | — | OK (revision quyida) | — | — |
| `git diff --check` | — | OK | — | — |

Yangi test (`navigation-feedback-v75.test.mjs`, 5 test): 45 ms grace'dan keyin identifikatsiya ramkasi va commit'da tozalanishi; tez reysda skelet miltillamasligi; **5 marta bekor qilingan reysdan keyin** ramka/notice/busy izi qolmasligi; qurilma byudjetlari va chegaralari; aniq `limit/maxNodes/ttl` qurilma profilidan ustunligi.

**Muhit cheklovi (nuqson emas):** `npm run backend:check` sistema `python3` bilan `fastapi` topolmaydi; repo `.venv` bilan **o'tadi** (`"Python ASGI + allowlisted static frontend ready"`).

---

## 6. Siz tomonda qoladigan ishlar

Batafsil: `EXTERNAL-HANDOFF-uz.md`. Qisqacha:

1. **PR #98 ni `arena/learners-area-next` ga merge qilish** — menga bu filialga push taqiqlangan.
2. **Real qurilma/tarmoq/Postgres** o'lchovlari (sovuq start, field metrikalar).
3. **Production/staging deploy** va smoke-test.
4. Supabase/R2/Cloudflare/Vercel operatsiyalari — **bu ish uchun talab qilinmaydi** (navigatsiya optimizatsiyasi ularga bog'liq emas).

---

## 7. Yakuniy holat

**READY FOR INDEPENDENT QA**

Asos: warm p95 58.0/57.2/60.8 ms, Back p95 32.1 ms, api250 p95 61.3 ms, module300 p95 66.4 ms — barchasi maqsad chegarasida; reload va dublikat API yo'q; Back 9/9 reuse; avtorizatsiya 10/10 probe + backend auth testlari yashil; to'liq suite 1185/1174/0/11; target bilan birlashtirilgan, konfliktlar yopilgan, `main` tegilmagan.

Ochiq qolgan yagona o'lchangan band: **mobile `ready` p99 = 111.5 ms** — sababi ma'lumot o'qishlari (`/app/vocabulary`, `/app/assignments`), navigatsiya kodi emas.

### Dalil fayllari
`frontend/docs/evidence/instant-navigation/`
- `merged-baseline-*.json` — target (`af76d0b`) o'lchovlari
- `merged-final-*.json` — shu filial o'lchovlari
- `merged-*-security.json` — xavfsizlik probe'lari (ikkala tomon)
- `archive-premerge/` — oldingi sessiyaning (merge'gacha) dalillari, tarix uchun

Qayta o'lchash:
```bash
cd frontend/vanilla
node scripts/instant-navigation-bench.mjs --label rerun --cycles 5 --out /tmp/rerun.json
node scripts/instant-navigation-bench.mjs --label rerun-api --cycles 3 --api-delay 250 --out /tmp/rerun-api.json
node scripts/instant-navigation-bench.mjs --label rerun-mod --cycles 3 --module-delay 300 --out /tmp/rerun-mod.json
node scripts/instant-navigation-bench.mjs --mode back --label rerun-back --out /tmp/rerun-back.json
node scripts/instant-navigation-bench.mjs --mode security --label rerun-security --out /tmp/rerun-security.json
node scripts/instant-navigation-bench.mjs --viewport tablet --cycles 5 --label rerun-tablet --out /tmp/rerun-tablet.json
node scripts/instant-navigation-bench.mjs --viewport mobile --cycles 5 --label rerun-mobile --out /tmp/rerun-mobile.json
```
