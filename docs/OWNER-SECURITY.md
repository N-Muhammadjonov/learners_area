# Egalik xavfsizligi

Bu hujjat kod tomonidagi qoidalarni yozadi. U production migratsiyasi, deploy yoki real Telegram tekshiruvi emas. BotFather egaligi avtomatik aniqlanmaydi.

## Uch xil egasi

| Vakolat | Qayerda | Nima qilmaydi |
| --- | --- | --- |
| Sayt OWNER | `users.role = owner`, aynan bitta jonli hisob | Bot yoki BotFather egasi bo'lib qolmaydi |
| Learners Area bot egasi | `telegram_bot_settings.primary_owner_telegram_id` | Sayt rolini o'zgartirmaydi. `telegram_bot_admin` qatori emas |
| @BotFather egasi | Telegramning o'zi | Kod buni o'qimaydi va o'zgartirmaydi |

Username hech birida ruxsat emas. `BOT_SERVICE_SECRET` egasi emas. Sayt ADMIN i avtomatik bot admin emas.

## Sayt egaligini o'tkazish

1. Joriy OWNER sessiyasi va joriy parol so'rovni boshlaydi.
2. Parol Telegramga, callback ga yoki chuqur havolaga kirmaydi.
3. Telegram ulanmagan yoki bot yozolmasa, o'tkazish to'xtaydi. Parolga yashirin qaytish yo'q. Hisobni ulang, botda Start bosing, keyin qayta urinib ko'ring.
4. Challenge maqsadi `website_owner_transfer`. Muddat 5 daqiqa. Bir martalik. Brauzer nonce faqat xesh sifatida saqlanadi.
5. Callback `wta:{uuid}` yoki `wtr:{uuid}`. Boshqa hech narsa yo'q.
6. Noto'g'ri Telegram ID, muddat, rad, bekor, qayta bosish va parallel ikkinchi chaqiruv commit qilmaydi.
7. Yozishdan oldin egasi, nishon va holat qayta o'qiladi. Nishon to'xtatilgan bo'lsa, rol o'zgarmaydi.
8. Bitta tranzaksiya. Jonli OWNER soni 1 bo'lmasa, tranzaksiya yiqiladi.
9. Umumiy `/api/admin/users/[id]/role` OWNER bera olmaydi.
10. Audit va ikki tomonga bildirishnoma bor. Parol bildirishnomada yo'q.

Favqulodda tiklash oddiy oqim emas. U operator, audit va alohida tasdiq talab qiladi. Ilova ichida bazadagi egani tozalash tugmasi yo'q.

## Bot boshqaruvini topshirish

`TELEGRAM_OWNER_ID` faqat bazada yaroqli egasi yo'q paytda ishlatiladi. O'qish env ni bazaga yozmaydi. Birinchi muvaffaqiyatli topshirish yozilgach, keyingi env o'zgarishi vakolatni ololmaydi.

Kelajakdagi topshirish kod, env yoki qayta deploy talab qilmaydi.

1. Joriy bot egasi raqamli nishon ID sini yuboradi. Username rad etiladi.
2. Nishon botni boshlagan bo'lishi kerak va bot uni bloklagan bo'lmasligi kerak.
3. Joriy egasi `bhc:` bilan tasdiqlaydi. Nishon `bha:` bilan qabul qiladi. Rad `bhr:`.
4. Vakolat faqat nishon qabul qilganda ko'chadi. Eski egasi keyingi tekshiruvda yo'qotadi.
5. Parallel qabul qilish `pg_advisory_xact_lock` bilan ketma-ket. Ikkinchisi eskirgan egani ko'radi va yozmaydi.

Ruxsatni tekshirish har safar bazadan o'qiydi. Qisqa kesh qo'yilmagan: boshqa jarayondagi keshni topshirish bekor qila olmaydi, eski egasi esa darhol vakolatni yo'qotishi kerak.

## Ixtiyoriy bog'lash

Sayt formasidagi belgi bot topshirishini faqat ochiq rozilik bilan boshlaydi. U yashirin emas. Joriy sayt egasining Telegram ID si hozirgi bot egasi bo'lishi kerak. Sayt tasdig'i joriy egasi roziligini yozadi va `current_confirmed` qator ochadi. Nishon baribir qabul qilishi kerak.

Agar belgi yoqilgan bo'lsa va commit paytida nishon Telegram ID si yo'qolsa, o'zgarsa yoki bot unga yozolmasa, butun sayt o'tkazuvi bekor bo'ladi. Qisman yashirin o'zgarish yo'q.

## Migratsiya

Qo'llanmagan. Tartib, bitta keyingi oyna:

1. `drizzle/0021_telegram_intent_purpose.sql`
2. `drizzle/0022_telegram_owner_authority.sql`

`0023` yo'q. 0019 va 0020 ga tegilmaydi. Agent migratsiyani qo'llamaydi, deploy qilmaydi va secret aylantirmaydi.

OWNER SECURITY + DYNAMIC BOT OWNER CODE-SIDE HARDENING COMPLETE — READY FOR ONE FINAL CONSOLIDATED DEPLOYMENT AND E2E ACCEPTANCE
