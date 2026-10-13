> Historical bot-branch document. Its release results, migration numbers and setup instructions are not current production proof. Follow [the current integration runbook](TELEGRAM-PRODUCTION-INTEGRATION-2026-10-13.md). Reuse @learnersareaaccessbot; never recreate or rotate it.

# Telegram bot arxitekturasi

Telegram bot Learners Area'ning ikkinchi haqiqat manbai emas. Sayt va uning bazasi qoladi:

- foydalanuvchi;
- `account_status`;
- admission;
- audit;
- retention.

Bot qo'shimcha kanal: kirish, ariza, yordam, boshqaruv, bildirishnoma.

## Jarayonlar

| Joy | Nima |
| --- | --- |
| Vercel | Next.js sayt va `/api/internal/telegram/*` |
| Railway | faqat `services/telegram-bot` |
| PostgreSQL | bitta Learners Area bazasi |

Bot saytga `BOT_SERVICE_SECRET` bilan murojaat qiladi. Bu sir foydalanuvchini OWNER qilmaydi. Har bir sezgir amal yana Telegram raqamli ID, bot ruxsati, nishon va joriy holatni tekshiradi.

## Identitet

Vakolat: Telegram raqamli ID. Username faqat ko'rinish.

`users.telegram_id` yagona login bog'lanishi. `telegram_contacts` bot bilan suhbatni saqlaydi. Ikkalasi bir hisobga ikki Telegram, yoki bitta Telegramga ikki hisob bog'lashga yo'l qo'ymaydi.

## Ruxsat

`TELEGRAM_OWNER_ID` asosiy egadir. Sayt roli `admin` bot admin emas.

Bot admin ruxsatlari: `VIEW_USERS`, `MANAGE_USERS`, `ADMISSIONS`, `SUPPORT`, `DIRECT_MESSAGE`, `BROADCAST`, `VIEW_STATS`, `VIEW_AUDIT`.

Faqat asosiy ega: `MANAGE_BOT_ADMINS`, `DANGEROUS_USER_DELETE`, `BOT_SETTINGS`.

## Uch xil olib tashlash

- Botdan olib tashlash: kontakt `removed_at`. O'quv tarixi qoladi.
- Telegramni uzish: `users.telegram_id` tozalanadi. Hisob qoladi.
- Hisobni o'chirish: faqat asosiy ega, ikki qadam, anonimlashtirish. Akademik qatorlar o'chmaydi.

## Navbatlar

Ommaviy xabar va bildirishnoma bazadagi outbox. Bot kichik batch olib yuboradi, `retry_after` ni hurmat qiladi, qayta ishga tushganda lease muddati o'tgan qatorni qayta oladi. Yuborildi deb yozilmaydi, toki Telegram javob bermaguncha.
