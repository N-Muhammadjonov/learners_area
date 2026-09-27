# BotFather qolgan qadamlari

Bu hujjat agent bajara olmaydigan qadamlarni yozadi. Hech qanday token, webhook secret yoki parol shu yerga yozilmaydi va chatga yuborilmaydi.

Bot allaqachon yaratilgan: `@learnersareaaccessbot`. `/newbot` ni qayta ishlatmang.

## 1. Buyruqlar

Bot ishga tushganda buyruqlarni o'zi yozadi. Qo'lda tekshirish kerak bo'lsa, `@BotFather` da `/setcommands` ni oching va shu ro'yxatni kiriting.

O'zbek (`uz`):

```
start - Menyuni ochish
menu - Asosiy menyu
help - Yordam
support - Qo'llab-quvvatlash
status - Hisob holati
settings - Sozlamalar
cancel - Bekor qilish
```

Ingliz (`en`):

```
start - Open the menu
menu - Main menu
help - Help
support - Support
status - Account status
settings - Settings
cancel - Cancel
```

## 2. Tavsif

`/setdescription` — qisqa matn, masalan: Learners Area ga kirish va ariza. Parol so'ralmaydi.

`/setabouttext` — xuddi shu ma'noning qisqaroq shakli.

## 3. Profil rasmi

Tasdiqlangan manba: `public/brand/learners-area-logo-mark-dark.png`.

Telegram uchun kvadrat nusxa: `services/telegram-bot/assets/profile-512.png`.

Bu yangi logo emas. Mavjud belgi kvadrat fon ustiga qo'yilgan.

`@BotFather` da `/setuserpic` ni oching, botni tanlang va shu PNG ni yuklang. Agent Telegramga rasm yubormaydi.

## 4. Maxfiylik

`/setprivacy` `Enable` bo'lib qolsin. Bot guruhdagi barcha xabarlarni o'qimasin.

## 5. Webhook

Webhookni qo'lda `setWebhook` qilmang. Bot `BOT_MODE=webhook` bilan ishga tushganda o'zi o'rnatadi.

`WEBHOOK_SECRET` 1–256 belgi, faqat `A-Z`, `a-z`, `0-9`, `_` va `-`. Qiymatni chatga yubormang. Bot yaroqsiz formatda ishga tushmaydi va secretni logga yozmaydi.

## 6. BotFather egasi alohida

Learners Area bot boshqaruvini topshirish @BotFather egaligini aniqlamaydi va o'zgartirmaydi. Agent userbot, MTProto, shaxsiy sessiya, Telegram 2FA paroli yoki API hash saqlamaydi.

BotFather egasini o'zgartirish faqat @BotFather ichidagi qo'lda qadam. Buni kod "kim da'vo qilsa shu egasi" qilib tekshirmaydi. Sayt OWNER i ham, `TELEGRAM_OWNER_ID` ham BotFather egasi emas.

## 7. Tekshirish

1. Botda `/` bosing. Yetti buyruq ko'rinishi kerak.
2. `/start` ichki menyuni ochishi kerak.
3. Profil rasmi kvadrat belgi bo'lishi kerak.
