# RIWI Railway QA tayyorgarligi

Bu fayllar mahalliy tayyorgarlik. Railway xizmati hali yaratilmagan yoki deploy qilinmagan.

Bir repo va aynan `arena/01a10bac-learners-area` branchidan ikkita alohida service ishlatiladi:

| Service | Config path | Vazifa |
| --- | --- | --- |
| RIWI web | `/railway.riwi-web.json` | Production build va oddiy Next server, Railway `PORT` qiymatidan foydalanadi |
| RIWI chat retention | `/railway.riwi-retention.json` | Har soat bir martalik canonical chat cleanup, keyin process va DB pool yopiladi |

Veb xizmatdagi `/api/version` healthcheck faqat server ishlayotganini bildiradi. U schema, AI, R2 yoki to‘liq QA o‘tganini bildirmaydi. Configda avtomatik migration yo‘q. Birinchi sinov uchun alohida QA database/object prefix ishlatiladi; shared yoki Production bazani almashtirish bu paketga kirmaydi.

Workerning default CLI chaqiruvi dry-run. Railway configdagi `--apply` quyidagilar bo‘lmaguncha 64 bilan to‘xtaydi:

- `DATABASE_URL` — aniqlangan QA bazaga tegishli connection.
- `RIWI_CHAT_RETENTION_DATABASE` — aynan o‘sha database nomi, connectiondan mustaqil identity tekshiruvi.
- `RIWI_CHAT_RETENTION_JOB_ENABLED=true` — worker apply uchun alohida environment opt-in.

Worker faqat oldingi owner-approved D-01 chat retention service’ni ishlatadi: so‘nggi30kun,7kundan qat’iy ko‘proq offline. Speaking audio/transcript retention bu ishga qo‘shilmagan. User account, academic records va Speaking yozuvlari o‘chirilmaydi. Baza targeti mos kelmasa hech narsa o‘chirilmaydi. Advisory lock yoki SKIP LOCKED sabab pending work qolsa exit75 chiqadi; keyingi scheduler run qayta urinishi kerak. Config `restartPolicyType=NEVER`, cheksiz yoki darhol pullik retry loop yaratmaydi. Secrets, DSN, chat matni yoki SQL exception body job receiptga yozilmaydi.

Worker build existing lockfiledagi tsx→esbuild dependency orqali bitta CommonJS artifact chiqaradi. Runtimega faqat Node kerak; production image devDependenciesni olib tashlaganidan keyin ham tsx’ni yuklab olishga urinish yo‘q. Artifact `.riwi-jobs/` ichida, Gitga qo‘shilmaydi.

Vercel `df0c2d1` statusi `failure`, target havolasi cron usage/pricing hujjatiga olib boradi. Saqlangan `vercel.json` hourly cron Vercel Hobbyga mos kelmaydi. Railway config shu hourly cadence’ni saqlaydi; Vercel cronni daily qilib sekinlashtirish yoki owner retention muddatini o‘zgartirish bajarilmagan.

Hostingga obuna bo‘lish AI/STT provider kalitlarini, private R2/S3 bucketni yoki backup/PITR receiptlarini avtomatik yaratmaydi. To‘liq original34guruhni qabul qilish uchun ularning actual-target dalillari hali kerak.

Rasmiy hujjatlar:

- https://railway.com/pricing
- https://docs.railway.com/pricing/plans
- https://docs.railway.com/cron-jobs
- https://docs.railway.com/config-as-code/reference
- https://vercel.com/docs/cron-jobs/usage-and-pricing
