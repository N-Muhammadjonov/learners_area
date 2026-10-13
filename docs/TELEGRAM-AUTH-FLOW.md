> Historical bot-branch document. Its release results, migration numbers and setup instructions are not current production proof. Follow [the current integration runbook](TELEGRAM-PRODUCTION-INTEGRATION-2026-10-13.md). Reuse @learnersareaaccessbot; never recreate or rotate it.

# Telegram orqali kirish

Email va parol o'z o'rnida qoladi. Telegram qo'shimcha yo'l.

## Sayt

1. Brauzer `POST /api/auth/telegram/intent` chaqiradi.
2. Server 256 bitlik tasodifiy token va alohida brauzer nonce yaratadi. Bazada faqat SHA-256 hash turadi. Token ichida email, rol yoki sessiya yo'q.
3. Muddat: 5 daqiqa. Bir marta ishlatiladi.
4. Brauzer `https://t.me/<bot>?start=<token>` ni ochadi. Bu sessiya cookie emas.
5. Bot `POST /api/internal/telegram/auth/confirm` ga o'z raqamli ID sini yuboradi. Tasdiq atomik: `pending` bo'lmagan yoki muddati o'tgan token rad etiladi.
6. Brauzer nonce bilan holatni so'raydi. Noncesiz so'rov rad etiladi.
7. `confirmed` bo'lgach, `POST /api/auth/telegram/intent/exchange` shu nonce bilan sessiyani oladi. Cookie email login bilan bir xil mexanizm.
8. `ACTIVE` ichkariga, qolgan holatlar `/pending` kutish xonasiga. Bot hech kimni o'zi `ACTIVE` qilmaydi.

Agar saytda allaqachon sessiya bo'lsa, intent shu hisobga bog'lash uchun yaratiladi. Boshqa hisobning Telegramini yashirin egallab bo'lmaydi.

Bekor qilish: `POST /api/auth/telegram/intent/cancel`.

## Eski widget

`TelegramButton` endi sahifaga qo'yilmaydi. `/api/auth/telegram/callback` yangi hisob yaratmaydi. Tanilgan bog'langan hisob uchun ham oddiy sessiya beradi, admissionni o'zgartirmaydi.
