# Tashqi handoff — lokal muhitda bajarib bo'lmaydigan ishlar

Bu hujjat **faqat** shu muhitda (sandbox, filial `arena/dca9f485-learners-area`) bajarib bo'lmaydigan ishlarni sanaydi. Kod, testlar va o'lchovlar **bajarilgan** — ular `REPORT-uz.md` da.

---

## 0. Umumiy holat bir qarashda

| # | Ish | Bloklaydimi? | Kim bajaradi |
|---|---|---|---|
| 1 | PR #98 ni `arena/learners-area-next` ga merge qilish | **Ha** (deploy'dan oldin) | Siz (target'ga yozish huquqi) |
| 2 | Real qurilma/tarmoqda navigatsiya o'lchovlari | Yo'q (QA bosqichi) | Siz |
| 3 | Production/staging deploy + smoke | Yo'q (merge'dan keyin) | Siz |
| 4 | Field metrikalar (RUM: LCP/INP) | Yo'q | Siz |
| 5 | Supabase / production DB | **Kerak emas** | — |

---

## 1. PR #98 ni target filialga merge qilish

1. **Nima qoldi:** `arena/dca9f485-learners-area` → `arena/learners-area-next` merge qilinmagan.
2. **Nega lokal bajarilmaydi:** menga faqat o'z filialimga push ruxsat etilgan; target'ga push qilish yoki u yerda merge commit yaratish taqiqlangan.
3. **Qaysi tizim:** GitHub (`N-Muhammadjonov/learners_area`), PR **#98**.
4. **Qadamlar:**
   1. `git fetch origin && git log --oneline origin/arena/learners-area-next..origin/arena/dca9f485-learners-area` — 3 commit ko'rinishi kerak (2 ta navigatsiya + 1 merge).
   2. GitHub'da PR #98 ni oching: `mergeable: MERGEABLE`, konflikt yo'q.
   3. **Merge commit** bilan birlashtiring (squash **emas** — merge commit target tarixini saqlaydi).
   4. CI yashil bo'lishini kuting.
5. **Kutilgan natija:** PR #98 `MERGED`; `arena/learners-area-next` da navigatsiya optimizatsiyasi + barcha yangi kontent.
6. **Tekshirish buyruqlari:**
   ```bash
   gh pr view 98 --json state,mergeable,baseRefName
   git log --oneline -5 origin/arena/learners-area-next   # merge commit ko'rinadi
   ```
7. **Merge/deploy'ni bloklaydimi:** **Ha** — bu yagona bloklovchi band.

**Konflikt bo'lsa (kutilmaydi):** yagona mumkin bo'lgan fayl — `frontend/vanilla/js/route-reuse.js`. Tanlanishi kerak: **`retentionProfile()` varianti** (desktop 4/8000/60s, tablet 4/7000/30s, mobile 3/6000/25s, low-memory 2/4000/20s), target'dagi `limit=8,maxNodes=16000,ttl=60000` **emas** — kattaroq kesh A/B o'lchovda swap p50 +5 ms, p95 +20 ms regressiya bergan.

---

## 2. Real qurilma va real tarmoqda o'lchov

1. **Nima qoldi:** navigatsiya metrikalarini haqiqiy qurilmalarda (iPhone Safari, Android Chrome, sekin 3G/4G) tasdiqlash.
2. **Nega lokal bajarilmaydi:** sandbox'da faqat headless Chromium 133 va fixture API bor; real qurilma/tarmoq yo'q.
3. **Qaysi tizim:** staging yoki production URL + real brauzerlar.
4. **Qadamlar:**
   ```bash
   cd frontend/vanilla
   node scripts/instant-navigation-bench.mjs --base https://<staging-host> --label staging-desktop --cycles 5 --out /tmp/staging-desktop.json
   node scripts/instant-navigation-bench.mjs --base https://<staging-host> --viewport mobile --cycles 5 --label staging-mobile --out /tmp/staging-mobile.json
   node scripts/instant-navigation-bench.mjs --base https://<staging-host> --mode back --label staging-back --out /tmp/staging-back.json
   node scripts/instant-navigation-bench.mjs --base https://<staging-host> --mode security --label staging-security --out /tmp/staging-security.json
   ```
   > Diqqat: harness `/api/**` ni fixture bilan almashtiradi va login sahifasidan boshlanadi. Real backend bilan ishlatish uchun fixture qatlamini o'chirish (yoki qo'lda login sessiyasi bilan variant) kerak — bu ish shu yerda tugaydi. Eng oddiy alternativ: Chrome DevTools Performance panelida qo'lda 5–10 navigatsiya o'lchash.
5. **Kutilgan natija:** warm p95 < 100 ms, Back p95 < 100 ms, reload yo'q, `documentNavigations = 1`.
6. **Bloklaydimi:** yo'q (QA bosqichi).

---

## 3. Production/staging deploy va smoke-test

1. **Nima qoldi:** yangi build'ni deploy qilish va smoke-test.
2. **Nega lokal bajarilmaydi:** deploy qilish taqiqlangan; Vercel/Cloudflare/Supabase boshqaruvi menga ochiq emas.
3. **Qaysi tizim:** Vercel (yoki mavjud hosting) + Cloudflare.
4. **Qadamlar:** merge → build (`python3 scripts/build_native_assets.py`) → deploy → quyidagilarni tekshirish: `/login` → `/app/dashboard` → barcha bo'limlar (Reading, Listening, Writing, Speaking, Vocabulary, Grammar, Progress, Assignments, Mocks) → Back/Forward → logout → login.
5. **Kutilgan natija:** sahifa to'liq reload qilmasdan o'tadi, scroll saqlanadi, hech qanday "skeleton flash" yo'q, konsol xatosi yo'q.
6. **Bloklaydimi:** ha, deploy uchun merge shart.

---

## 4. Field metrikalar (RUM)

1. **Nima qoldi:** LCP/INP/TTFB real foydalanuvchilarda.
2. **Nega lokal bajarilmaydi:** real trafik yo'q.
3. **Qaysi tizim:** mavjud analytics (agar mavjud bo'lsa).
4. **Qadamlar:** deploy'dan 24 soat keyin `/app/*` sahifalari uchun LCP/INP taqsimotini solishtirish.
5. **Kutilgan natija:** INP o'zgarishsiz yoki yaxshilangan (navigatsiya ishi main-thread ishini kamaytiradi).
6. **Bloklaydimi:** yo'q.

---

## 5. Supabase / production ma'lumotlar bazasi

**Bu ish uchun talab qilinmaydi.** Navigatsiya optimizatsiyasi hech qanday migration, trigger, `auth_version` semantikasi, LISTEN/NOTIFY yoki RLS o'zgarishini kiritmaydi:

```bash
git diff --stat c74571f HEAD -- services/     # bo'sh
```

Lokal `npm run test:integration` embedded PostgreSQL ustida 72 migration va 8 migration-replay check'ni muvaffaqiyatli o'tkazdi — shuning uchun alohida DB ishi yo'q.

---

## 6. Agar biror narsa teskari ketsa — qaytarish yo'li

- Faqat **frontend** o'zgargan: `git revert <merge-commit>` target'ga ta'sir qilmaydi, DB'ga tegmaydi.
- Kesh byudjetini yumshatish kerak bo'lsa: `frontend/vanilla/js/route-reuse.js` dagi `retentionProfile()` qiymatlari — yagona sozlash nuqtasi. O'lchovsiz oshirish **tavsiya etilmaydi**.
- Scroll tuzatishini qaytarish kerak bo'lsa: `frontend/vanilla/js/workspace.js` `commit()` ichidagi scroll bloki (yozish/tekshirish shartlari) — izohlar bilan belgilangan.
