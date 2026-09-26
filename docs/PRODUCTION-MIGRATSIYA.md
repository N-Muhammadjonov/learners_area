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
(`DATABASE_URL` o'z joyida).

**Nega buni siz bajarasiz:** agent ishlaydigan sandbox'dan tashqi tarmoqqa
ma'lumot uzatish yopiq — `learners-area.vercel.app:443` va Supabase pooler'iga TLS
handshake o'tadi, keyin ulanish uziladi (faqat npm registry va GitHub ochiq).
Shuning uchun production'ga na brauzer bilan kirib, na `curl` yubora olaman; shu
sabab **migratsiyani ham sandbox'dan ishga tushirib bo'lmaydi** — uni siz
bajarishingiz shart, bu to'g'ri qaror bo'ldi.

Quyidagi blokni nusxalab, o'z mashinangizda bajaring va **chiqishini yuboring**
(parol yo'q, sir yo'q):

```bash
B=https://learners-area.vercel.app

# (a) Deploy qaysi versiyada? 1 => tuzatilgan build, 0 => eski build
curl -s "$B/register" | grep -c "Xizmat vaqtincha ishlamayapti"

# (b) Ro'yxatdan o'tish — PENDING bo'lishi kerak (200 + accountStatus: pending)
curl -s -i -X POST "$B/api/auth/register" \
  -H "Content-Type: application/json" -H "Origin: $B" \
  --data '{"name":"Test Hisob","email":"test.hisob@example.uz","password":"TestHisob-2026!"}' | head -20

# (c) Xuddi shu email bilan takroriy urinish — 409 email_taken bo'lishi kerak
curl -s -i -X POST "$B/api/auth/register" \
  -H "Content-Type: application/json" -H "Origin: $B" \
  --data '{"name":"Test Hisob","email":"test.hisob@example.uz","password":"TestHisob-2026!"}' | head -12

# (d) O'sha hisob bilan kirish
curl -s -i -X POST "$B/api/auth/login" \
  -H "Content-Type: application/json" -H "Origin: $B" \
  --data '{"email":"test.hisob@example.uz","password":"TestHisob-2026!"}' | head -12
```

Kutiladigan natijalar:

| So'rov | Migratsiyadan oldin | Migratsiyadan keyin |
| --- | --- | --- |
| (b) register | `500` + HTML xato sahifasi (42P01) | `200 {"ok":true,"accountStatus":"pending"}` |
| (c) takroriy | `500` | `409 {"error":"email_taken"}` |
| (d) login | `500` | `200 {"ok":true,"accountStatus":"pending"}` |

Brauzerda ko'z bilan tekshirish (ixtiyoriy, lekin foydali): `/register` da formani
to'ldirib yuboring — hisob yaratilsa kutish xonasiga (`/pending`) o'tishi va tugma
qayta bosiladigan holatda qolishi kerak.

> **Diqqat:** (b) qadami haqiqiy hisob yaratadi va u bazada PENDING bo'lib qoladi.
> Emailni o'zingiz tanlang; keyin uni `/admin` (owner tasdiqlagandan keyin) yoki
> bevosita bazadan o'chirib tashlash mumkin. Demo/seed ma'lumot EMAS — bu sizning
> sinov hisobingiz, shuning uchun uni o'zingiz boshqarasiz.

Agar (b) hali ham 500 bersa va HTML qaytarsa, demak baza hali migratsiya
qilinmagan yoki Vercel eski build'ni ishlatyapti — 2-qadam chiqishini va Vercel
deployment commit'ini yuboring.

---

## Menga nima yuborish kerak

1. 2-qadam chiqishi (`migrate-production.mjs`, ko'rish rejimi) — **avval shu**
2. mening tasdiqimdan keyin 3-qadam chiqishi (`--apply`)
3. 4-qadam chiqishi (`verify-production-schema.mjs`)
4. 5-qadam chiqishi (`bootstrap-owner.mjs`)
5. 6-qadam chiqishi, ya'ni (a) build belgisi va (b)/(c)/(d) javoblari
6. Vercel deployment commit'i (Vercel → Deployments → eng yuqoridagi commit xeshi)

Har bir chiqishda parol bo'lmasligi kerak — skriptlar o'zi maskalaydi, lekin
nusxalashdan oldin bir qarab qo'ying.

**6-band nima uchun muhim:** Vercel deploy qilinayotgan commit `main` bo'lsa
(`f679c65`), u holda bu vazifada qilingan tuzatishlar — ro'yxatdan o'tish
tugmasining qotib qolmasligi, 42P01 o'rniga tushunarli 503, brend sarlavhasi —
production'da umuman yo'q. Baza migratsiya qilinsa ham, eski build eski xatolarni
ko'rsatishda davom etadi. Bu holda arena branch'ini deploy qilish (yoki uni `main`
ga qo'shish) kerak — bu sizning qaroringiz, men `main` ga hech narsa qo'shmayman.

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

---

# P0: productionda Reading sahifalari ishlamayapti — sabab va aniq qadamlar

**Belgi:** productionda Reading bo'limi (ro'yxat, passa mashqi) xato beradi yoki
bo'sh chiqadi, boshqa modullar ishlaydi.

**Sabab (aniq):** hozir productionda **17/17 migratsiya** qo'llangan, ya'ni
`drizzle/0000…0016`. Bu branchdagi kod esa **19 migratsiyani** kutadi: Reading
kutubxonasi uchun `0017_reading_105_library.sql` va material kompozitori uchun
`0018_resource_blocks.sql` hali productionda yo'q. Kod `reading_question_groups`,
`reading_passage_paragraphs` va `reading_passages.test_no` kabi yangi ustunlarni
so'raydi — ular bo'lmasa so'rov xato qaytaradi. Ya'ni muammo ma'lumotda emas,
**sxemada**.

> Diqqat: shu sababli Reading ilgari ishlagan bo'lsa ham hozir xato berishi mumkin —
> Vercel deployment shu branchga ergashadi, ya'ni yangi kod eski sxema bilan
> ishlashga urinadi.

**Tuzatish — o'zingizning kompyuteringizda (3 qadam):**

```bash
# 1) Ko'rish. Read-only: hech narsa yozmaydi, nima qo'llanishini ko'rsatadi.
#    Connection string sifatida 5432 (direct) yoki session pooler ishlatiladi —
#    transaction pooler (6543) migratsiya uchun yaramaydi.
cd <repo>
DATABASE_URL="postgres://…" node scripts/migrate-production.mjs

# 2) Qo'llash. Faqat xulosa 'empty' yoki 'resume' bo'lganda.
DATABASE_URL="postgres://…" node scripts/migrate-production.mjs --apply --yes

# 3) Tekshirish. Kutilgan natija: 19/19 migratsiya, 62 jadval, 42/42 tekshiruv.
DATABASE_URL="postgres://…" node scripts/verify-production-schema.mjs
```

**Kutilgan natija:** `0017` va `0018` qo'llanadi (yangi 4 jadval:
`lexical_occurrences`, `reading_passage_paragraphs`, `reading_question_groups`,
`resource_blocks` va mavjud jadvallarga yangi ustunlar). Eski qatorlarga
tegilmaydi, hech narsa o'chirilmaydi, demo kontent qo'shilmaydi.

**Keyin:** Reading kutubxonasi 105 ta passa bilan ochilishi kerak. Agar 105 ta
passa bazada hali yo'q bo'lsa (ya'ni kontent importi hali qilinmagan bo'lsa),
import ham alohida qadam — u ham faqat kontent va lug'atga tegadi:

```bash
# Avval quruq yurish (hech narsa yozmaydi), hisobotni ko'ring:
node --import tsx --env-file=.env scripts/import-reading-105.mjs --source <papka>

# Keyin qo'llash:
node --import tsx --env-file=.env scripts/import-reading-105.mjs --source <papka> --apply

# Va tekshirish (read-only):
node --import tsx --env-file=.env scripts/import-reading-105.mjs --verify
```

**Import qilishdan oldin (muhim):** importer shu branchdagi versiyada bo'lishi
kerak — 144 ta ko'p tanlovli savolda variant matni yo'qolib qolgan xato
tuzatilgan (`optionListFor` endi savolning o'z option qatorlarini o'qiydi).
Productionga hali import qilinmagan bo'lsa, shu branchdagi kod bilan import
qilinsa xato umuman paydo bo'lmaydi. Import allaqachon bo'lgan bo'lsa, eski
qatorlar **o'zgartirilmaydi** (importer mavjud passani qayta yozmaydi) — buni
faqat hisobotda aytib o'ting, o'zingizcha qayta import qilmang.

**Importdan keyingi tekshiruv (read-only):** `--verify` hisoboti
`questions 1406`, `groups 299`, `paragraphs 857`, `occurrences 3921`,
`lexiconRows 2589` ko'rsatishi kerak va bitta DRAFT
(`t29-p2-the-importance-of-law`) qolishi kerak. Brauzerda istalgan
"Choose TWO letters"/MCQ passa ochilsa variantlar "A — …" ko'rinishida matn
bilan chiqishi kerak.

**Xavfsizlik:** bu buyruqlar foydalanuvchilarga, rollarga, urinishlarga yoki
tarixga tegmangmaydi; ular faqat sxema va kontent bilan ishlaydi. `db:push`,
`db:seed` va `reset-db.mjs` ishlatilmaydi.
