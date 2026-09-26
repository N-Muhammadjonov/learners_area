# Production bazani migratsiya qilish — qadam-baqadam qo'llanma

Bu hujjat **siz o'zingiz** (men emas) production Supabase bazasiga migratsiya qilishingiz uchun.
Men bu yerdan tayyor vositalarni yozdim va ularni bir martalik lokal bazalarda sinab ko'rdim;
haqiqiy bazaga yozish uchun kredentsial kerak, u sizda qoladi.

Holat: Vercel'dagi ilova Supabase'ga ulanmoqda, lekin baza bo'sh — shuning uchun
`relation "users" does not exist` (42P01) xatosi chiqadi. Sabab: sxema hali
qo'llanilmagan. Migratsiya zanjiri (`drizzle/0000…0016`) shu bazaga qo'llanishi kerak.

> **Hech qachon qilmang:** `npm run db:seed` (demo parollar ommaviy), `reset-db.mjs`
> (sxemani o'chiradi), `npm run db:push` (tarixni chetlab o'tadi).
> Va **parolni chatga yozmang** — men uni so'ramayman ham.

---

## 0. Qaysi connection string ishlatiladi

Supabase'ga uch xil yo'l bor va ular migratsiya uchun bir xil emas:

| Manzil | Port | Migratsiya uchun |
| --- | --- | --- |
| `db.<ref>.supabase.co` (to'g'ridan-to'g'ri) | 5432 | ishlaydi, lekin yangi loyihalarda faqat IPv6 |
| `<region>.pooler.supabase.com` (session pooler) | 5432 | **shuni ishlating** |
| `<region>.pooler.supabase.com` (transaction pooler) | 6543 | **ishlamaydi** — statement'lar sessiyani bo'lishmaydi |

Supabase dashboard → Project Settings → Database → Connection string →
**Session pooler**. Ilovaning o'zi Vercel'da transaction pooler (6543) da qolaversin —
bu faqat migratsiya buyrug'i uchun.

Agar `db.<ref>.supabase.co` bilan `ENETUNREACH` chiqsa — bu IPv6 muammosi, parol xato emas.

---

## 1. Reponi tayyorlash

Branch: `arena/01a0cf7b-learners-area` (push qilingan, `764775e`).

Agar shu branch allaqachon klonlangan bo'lsa — to'g'ridan-to'g'ri repo ildizida ishlang:

```bash
git fetch origin arena/01a0cf7b-learners-area && git checkout arena/01a0cf7b-learners-area
npm ci
```

Agar joriy branch'ni almashtirishni xohlamasangiz (xavfsizroq):

```bash
git fetch origin arena/01a0cf7b-learners-area
git worktree add /tmp/la-migrate FETCH_HEAD
cd /tmp/la-migrate && npm ci
```

Barcha buyruqlar repo ildizidan bajariladi.

---

## 2. Ko'rish (read-only — hech narsa yozmaydi)

```bash
export DATABASE_URL="postgresql://postgres.<ref>:<PAROL>@<region>.pooler.supabase.com:5432/postgres"
node scripts/migrate-production.mjs
```

Bu buyruq **hech narsa yozmaydi**. U:

1. zanjirni tekshiradi — 17 fayl, tartib, `DROP`/`TRUNCATE` yo'q, `WHERE`siz `DELETE` yo'q;
2. bazaga faqat o'qiydigan so'rovlar yuboradi: jadvallar, enum'lar, `drizzle.__drizzle_migrations` tarixi, `users` jadvali;
3. xulosa chiqaradi: `empty` | `resume` | `up-to-date` | `partial` | `divergent`.

Ekranda parol `****` bo'lib chiqadi (skript uni ataylab maskalaydi).

**Menga shu buyruqning chiqishini nusxalab yuboring** — men xulosani o'qib, keyingi
qadamni tasdiqlayman. Nusxalashdan oldin parol ko'rinmaganiga bir qarab qo'ying.

Kutiladigan natija: `tables 0`, `history missing`, `users table absent`,
`Verdict: empty`, oxirida `Nothing was written.`

Agar boshqacha chiqsa — to'xtang va chiqishni yuboring. `partial` yoki `divergent`
bo'lsa, skript o'zi ham davom etmaydi va sababini aytadi.

---

## 3. Qo'llash (faqat mening tasdiqimdan keyin)

```bash
# XULOSA 'empty' yoki 'resume' bo'lgandagina:
node scripts/migrate-production.mjs --apply
```

Skript baza nomini yozishni so'raydi (`postgres` deb yozasiz) — bu tasodifni
to'xtatish uchun. U `drizzle-kit migrate` ni o'zi chaqiradi (`npm run db:migrate`
bilan bir xil yo'l), parolni muhit orqali uzatadi, argument sifatida emas.

Kutiladigan natija: `history 17/17 recorded`, `tables 58`, `users table present, 0 row(s)`,
`Applied. No unexpected tables.` va oxirida `exit 2`.

**Muhim:** migratsiya hech qanday foydalanuvchi qo'shmaydi — na demo hisob, na
o'qituvchi, na kurs. Faqat jadval/indeks/konstraint. Buni men lokal bazada
o'lchab tasdiqladim: `0 row(s)`.

---

## 4. Tekshirish (read-only)

```bash
node scripts/verify-production-schema.mjs
```

42 ta tekshiruv: `users` va auth ustunlari, `account_status`/`role`/`is_owner`/faoliyat
maydonlari, 17 migratsiya yozuvi, CMS publication sxemasi, vocabulary/lexical sxemasi,
indekslar/konstraintlar, va productionda demo hisob **yo'qligi**.

Kutiladigan natija: `ALL CHECKS PASSED — 42/42`, ostida bitta "keyingi qadam":
`an active OWNER account exists` — chunki egasi hali yo'q (3-qadamda yaratiladi).

**Bu chiqishni ham menga yuboring.**

---

## 5. Birinchi OWNER hisobi

Bazada hech qanday hisob yo'q, va ilova egasiz boshqarilmaydi. Egasi **bir marta**
shu buyruq bilan yaratiladi (kod ichida hech qanday owner email/parol yo'q):

```bash
export OWNER_EMAIL="sizning.haqiqiy@manzilingiz.uz"
export OWNER_PASSWORD='kuchli-parol-kamida-8-belgi'   # yoki: o'qib so'raydi, export qilmasangiz
node scripts/bootstrap-owner.mjs --email "$OWNER_EMAIL" --name "To'liq Ism"
unset OWNER_PASSWORD
```

Skript: faol egasi bor bo'lsa ishlashdan bosh tortadi (o'g'irlab bo'lmaydi), parolni
ilova bilan bir xil narxda (bcrypt 12) xeshlaydi, hisobni ACTIVE va onboarded qiladi,
audit yozuvi qoldiradi va **hech qachon parol yoki xeshni chop etmaydi**.

Kutiladigan natija: `owner@… is now the owner. Active owners: 1. No password or hash was printed.`

Keyin `verify-production-schema.mjs` ni qayta ishga tushirsangiz, o'sha satr
`PASS — owners: 1` ga aylanadi.

---

## 6. Vercel'dagi haqiqiy oqim

Baza migratsiya qilingach Vercel'da hech narsani o'zgartirish shart emas
(`DATABASE_URL` o'z joyida). Faqat:

1. `https://<domen>/` → **Let's Get Started →**
2. `/register` → haqiqiy hisob yaratish → **PENDING** kutish xonasiga o'tishi kerak
3. o'sha email bilan yana urinish → `409 email_taken` (xavfsiz, ekranda xato)
4. o'sha hisob bilan kirish → kutish xonasi (faol bo'lmagan hisob ichkariga kirmaydi)

Buni men ham tekshira olaman — menga **domen URL** ni yuboring (URL sir emas) va
men haqiqiy oqimni brauzer bilan bosib chiqib, natijani hisobot qilaman.

---

## Menga nima yuborish kerak

1. 2-qadam chiqishi (`migrate-production.mjs`, ko'rish rejimi) — **avval shu**
2. mening tasdiqimdan keyin 3-qadam chiqishi (`--apply`)
3. 4-qadam chiqishi (`verify-production-schema.mjs`)
4. 5-qadam chiqishi (`bootstrap-owner.mjs`)
5. Vercel domen URL

Har bir chiqishda parol bo'lmasligi kerak — skriptlar o'zi maskalaydi, lekin
nusxalashdan oldin bir qarab qo'ying.

## Nima uchun bu xavfsiz

- Vosita `partial` (tarixsiz jadvallar) yoki `divergent` (boshqa tarix) holatida
  **yozmasdan to'xtaydi** — "kimningdir bazasi"ni bizning sxema deb hisoblab
  yuborish qaytarib bo'lmaydigan xato bo'lardi.
- Migratsiya fayllarida `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE` yo'q; `WHERE`siz
  `DELETE` yo'q (buni skript har safar o'zi qayta tekshiradi).
- Zanjir hech qanday kengaytma (`CREATE EXTENSION`) talab qilmaydi va faqat
  Supabase'dagi Postgres 15 da mavjud funksiyalardan foydalanadi
  (`gen_random_uuid`, `now`, `regexp_replace`, `hashtext`, advisory lock).
- `--apply` dan keyin ham hamma narsa qayta o'qib tekshiriladi.
