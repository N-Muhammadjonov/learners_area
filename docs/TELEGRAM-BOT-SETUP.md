# Telegram botni sozlash

Bu hujjatda haqiqiy token yo'q. Tokenlarni Arena chatiga yopishtirmang. Ularni Railway, Vercel yoki o'z terminalingizga kiriting.

## 1. BotFather

1. Telegramda `@BotFather` ni oching.
2. `/newbot` yuboring.
3. Ko'rsatilgan nomni yozing, masalan `Learners Area`.
4. Username tanlang. U `bot` bilan tugashi kerak.
5. BotFather bergan tokenni nusxalang va **chatga yubormang**.
6. `/setdescription` va `/setabouttext` ni xohlasangiz to'ldiring.
7. `/setprivacy` ni `Enable` qoldiring. Bot guruhdagi barcha xabarlarni o'qimasin.

## 2. Eganing raqamli ID si

1. `@userinfobot` ga `/start` yuboring.
2. `Id` qatoridagi sonni oling. Username emas.
3. Shu son `TELEGRAM_OWNER_ID` bo'ladi. Bu faqat bootstrap. Bazada topshirish yozilgach, env vakolatni tortib ololmaydi.

## 3. Umumiy sir

Uzoq tasodifiy satr yarating. Bir xil qiymat ikki joyda turadi:

- Vercel: `BOT_SERVICE_SECRET`
- Railway: `BOT_SERVICE_SECRET`

Bu `AUTH_SECRET` emas va foydalanuvchi paroli emas.

## 4. Vercel

Mavjud Learners Area loyihasiga qo'shing:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME` (oxirida `bot`, `@` siz)
- `BOT_SERVICE_SECRET`
- `TELEGRAM_OWNER_ID`

Saytni qayta deploy qilishdan oldin migratsiyalarni bitta ko'rib chiqilgan oynada, shu tartibda qo'llang: avval `0021_telegram_intent_purpose.sql`, keyin `0022_telegram_owner_authority.sql`. 0019 va 0020 allaqachon qo'llangan — ularni o'zgartirmang va qayta ishga tushirmang. `0023` yo'q. Agent bu migratsiyalarni productionga qo'llamaydi.

`0021` login niyatiga `purpose` ustunini qo'shadi. `0022` sayt egaligini o'tkazish uchun Telegram tasdig'i va bot boshqaruvini ikki tomonlama topshirish jadvallarini qo'shadi. Ikkalasi ham hali qo'llanmagan.

## 5. Railway

Yangi servis. Root directory: `services/telegram-bot`.

Env:

- `TELEGRAM_BOT_TOKEN`
- `BOT_SERVICE_SECRET`
- `TELEGRAM_OWNER_ID`
- `TELEGRAM_BOT_USERNAME`
- `INTERNAL_API_URL` = `https://<sayt-domeni>/api/internal/telegram`
- `PUBLIC_SITE_URL` = `https://<sayt-domeni>`
- `BOT_MODE` = `webhook`
- `WEBHOOK_BASE_URL` = `https://<railway-domeni>`
- `WEBHOOK_SECRET` = boshqa uzun tasodifiy satr
- `WEBHOOK_PATH` = `/telegram/webhook`
- `HOST` = `0.0.0.0`
- `PORT` = `8080`

Nusxa soni: 1. Ikkinchi jarayon webhookni tortib oladi.

Health: `GET /health`. Javobda sir yoki foydalanuvchi yo'q. `{"ok":true,"service":"learners-area-telegram-bot"}` bo'lishi kerak. Railway healthcheck shu yo'lda qoladi.

`GET /ready` ichki API va bazani tekshiradi. U liveness emas. API yiqilsa `/ready` 503, `/health` esa 200 qoladi.

`WEBHOOK_SECRET` faqat `A-Z a-z 0-9 _ -` va 1–256 belgi. Bot yaroqsiz qiymatda `setWebhook` chaqirmaydi va secretni chop etmaydi.

## 6. Mahalliy polling

`services/telegram-bot` ichida `.env` yarating (gitga kirmaydi):

```
TELEGRAM_BOT_TOKEN=...
BOT_SERVICE_SECRET=...
TELEGRAM_OWNER_ID=...
INTERNAL_API_URL=http://localhost:3000/api/internal/telegram
BOT_MODE=polling
```

`python bot.py`. Productionda `polling` ishlatilmaydi.

## 7. Birinchi tutun testi

1. `/health` 200 qaytaradi.
2. Owner hisobidan botga `/start`.
3. Boshqa hisobdan `/start`. U boshqaruv tugmasini ko'rmaydi.
4. Saytda email/parol bilan kirish hali ishlaydi.

## 8. Egalik va bot boshqaruvi

`TELEGRAM_OWNER_ID` faqat birinchi ishga tushirish. Bazada `primary_owner_telegram_id` yozilgach, keyingi env o'zgarishi vakolatni tortib ololmaydi. Topshirish kod, env yoki qayta deploy talab qilmaydi.

Sayt OWNER, Learners Area bot egasi va @BotFather egasi uch xil narsa. BotFather egaligi avtomatik aniqlanmaydi. Username ruxsat emas.

Sayt egaligini o'tkazish parol bilan boshlanadi, lekin Telegram tasdig'isiz yozilmaydi. Telegram ulanmagan bo'lsa, parolning o'zi yetarli emas. Batafsil: `docs/OWNER-SECURITY.md`.
