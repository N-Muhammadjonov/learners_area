> Historical bot-branch document. Its release results, migration numbers and setup instructions are not current production proof. Follow [the current integration runbook](TELEGRAM-PRODUCTION-INTEGRATION-2026-10-13.md). Reuse @learnersareaaccessbot; never recreate or rotate it.

# Qo'lda tekshirish

Avval avtomatik testlar yashil, migratsiya tasdiqlangan, webhook sog'lom bo'lsin. Undan oldin bu ro'yxatni productionda o'tgan deb yozmang.

Kerak: 1 asosiy OWNER, 1 oddiy hisob, 1 cheklangan bot admin.

## Oddiy foydalanuvchi

- `/start`
- ariza
- holat `PENDING` qoladi
- yordam xabari
- saytda Telegram orqali kirish
- chiqish va qayta kirish
- bildirishnoma sozlamasi

## OWNER

- ega deb taniladi, username emas
- qidiruv
- navbatdagi arizani ko'rish va test arizani tasdiqlash
- yordamga javob
- to'g'ridan-to'g'ri xabar, oldindan ko'rish, tasdiq
- bot admin qo'shish, ruxsatni o'zgartirish, olib tashlash
- o'ziga test ommaviy xabar
- vaqtinchalik test hisobni to'xtatish va tiklash
- vaqtinchalik Telegramni uzish
- auditda iz qolgani

## Cheklangan bot admin

- berilgan amal ishlaydi
- berilmagan amal rad etiladi
- soxta callback rad etiladi

Holat yorliqlari: `LOCAL VERIFIED`, `AUTOMATED VERIFIED`, `REAL TELEGRAM VERIFIED`, `PRODUCTION VERIFIED`, `EXTERNALLY UNVERIFIED`. Mock test real Telegram tekshiruvi emas.
