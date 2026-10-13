> Historical bot-branch document. Its release results, migration numbers and setup instructions are not current production proof. Follow [the current integration runbook](TELEGRAM-PRODUCTION-INTEGRATION-2026-10-13.md). Reuse @learnersareaaccessbot; never recreate or rotate it.

# Telegram bot xavfsizligi

- Ichki API `Authorization: Bearer <BOT_SERVICE_SECRET>`. Taqqoslash SHA-256 va `timingSafeEqual`.
- Servis siri OWNER vakolati emas.
- Parol, `AUTH_SECRET`, Supabase yoki Vercel paroli Telegramda so'ralmaydi.
- `/shell`, `/sql`, `/eval` yo'q.
- So'rovlar ORM orqali. Foydalanuvchi matni Telegram HTML da qochiriladi.
- Login intent: 256 bit, qisqa muddat, bir martalik, nonce, replay uchun holat yangilanadi.
- Callback serverda qayta tekshiriladi. Soxta tugma ruxsatsiz aktordan o'tmaydi.
- Webhook `X-Telegram-Bot-Api-Secret-Token` ni tekshiradi. Noto'g'ri sir rad etiladi.
- Takroriy `update_id` e'tiborsiz qoldiriladi.
- Ariza qarori atomik. Ikkinchi qaror 409.
- O'quvchi o'zini tasdiqlay olmaydi.
- Yuborilgan deb yozilmaydi, agar Telegram rad etsa, bloklangan bo'lsa yoki foydalanuvchi botni boshlamagan bo'lsa.
- Audit: tasdiq, rad, to'xtatish, tiklash, bog'lash, uzish, bot admin, ruxsat, o'chirish, ommaviy xabar. `source = telegram_bot`. Sir yozilmaydi.
- `/health` sir va foydalanuvchi qaytarmaydi.
