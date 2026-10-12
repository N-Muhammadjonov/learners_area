# RIWI joriy holati — Railway tayyorgarligi

Oxirgi tasdiqlangan publication `df0c2d17187ee7c341e3eaa88521fd9c57c90147`; branch `arena/01a10bac-learners-area`.
Yangi source `ea4d1aee74e7d44c5299a83a142712a12ada8a42b9e6fde2d61794e933e4f378` —1265kanonik fayl.7ta kod/config yo‘li o‘zgardi. Bu yangi paket hali push yoki Railway deploy qilinmagan.

Railway uchun web config va har soat bir marta tugab chiqadigan chat retention worker tayyor. Worker oldingi canonical D-01 service’dan foydalanadi; default dry-run, apply alohida opt-in va database identity talab qiladi. Speaking deletion/lifecycle yoqilmagan. Learners Area qayta loyihalanmagan.

Ikki yangi native PostgreSQL16.14 bosqichning HAR BIRIDA1499backend+265UI test o‘tdi;0fail/skip/cancel/todo. Har ikki bosqich production build, typecheck/lint, compiled `next start` orqali13R04+53R06HTTP va real bazadagi4bundled-worker holatini qamrab oldi.34rawgate log SHA va manba1265fayl mustaqil tekshirildi; asl Listening/Speaking inputlar o‘zgarmadi. Har ikki cluster to‘xtatildi, vaqtinchalik password olib tashlandi.

Oldingi bbd source’ning115jadval/181FK physical PITR va4rol Chrome dalili tarixiy scope’da saqlanadi. Application/schema/package o‘zgarmagan, ammo yangi worker yoki hosting-provider restore/browser qabulini ular avtomatik tasdiqlamaydi. Real AI/STT, private R2 read-back/expiry, physical microphone va full device matrix bajarildi deb yozilmagan.

GitHub Vercel statusi failure; link cron pricing hujjatiga olib boradi. Hourly `vercel.json` Vercel Hobby daily limitiga mos kelmasligi ehtimoliy blocker; actual deployment log olinmagani uchun exact sabab tasdiqlangan deb yozilmagan. Railway config hourly schedule’ni saqlaydi. Setup: `RIWI-RAILWAY-QA-SETUP-UZ.md`.

Yakunlangan original guruhlar20/34=58.82%. Yangi full-group closure0; qolgan14guruhning konkret talablari:

| Guruh | ID | Yakuniy qabul uchun qolgan talab |
| --- | --- | --- |
| 4 | R04 | Deployed scheduler executions and physical deletion receipts |
| 6 | R06 | Exact hosted target, live provider, real signed-object URL expiry and full browser revocation/security/timeout matrix. Current compiled local HTTP role tests passed twice; published bbd browser proof remains separately scoped. |
| 7 | R07 | Actual authorized hosting-provider restore/backup policy and owner-selected contractual RPO/RTO. Local physical PITR rehearsal is complete, not provider acceptance. |
| 8 | R08 | Mandatory operational evidence and final GO/NO-GO |
| 9 | B01 | Positive/negative/edge/injection semantic acceptance for every original task |
| 12 | B04 | Task-specific semantic/live-provider acceptance; unavailable capabilities earn no completion credit |
| 13 | B05 | Actual configured provider/fallback fixtures on current target |
| 20 | C05 | Real microphone/STT, timeout/retry and cleanup browser journeys |
| 21 | C06 | Actual R2 signed URL expiry and private bytes read-back |
| 22 | C07 | Actual browser and consent/privacy acceptance |
| 23 | C08 | Specific owner policy remains unapproved; no deletion executor or R2 lifecycle enabled; real environment/browser evidence pending |
| 24 | C09 | Complete mobile/tablet/desktop language/theme/keyboard/failure/sensor journeys. Loaded local compiled desktop EN/UZ/day/night is verified; real microphone and remaining matrices are open. |
| 28 | D04 | Real private R2/S3 object-scope/owner/access/copy/rollback receipts |
| 33 | D09 | Two fresh local rounds including production build, compiled HTTP and bundled worker have passed. Remaining full operational scope includes configured live provider/R2, exact-target browser/full-device and all-task semantic acceptance and actual provider recovery. |

Umumiy RIWI va butun sayt foizi uchun to‘liq tasdiqlangan denominator yo‘q; bu foizlar noma’lum. Push scope faqat reviewed code/evidence; to‘liq operational GO/NO-GO hali ochiq.

Joriy dalillar: `docs/evidence/riwi-railway-preparation/native/`. Oldingi snapshotlar shu papkaning yuqori darajasida saqlangan.
