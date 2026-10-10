RIWI Batch 16 davomi

Yuklangan original checkpoint SHA256: `f3e26bed9557467817c8355a0b65ee4c6012552a35ae73978a7db1d168cf3b03`. Original fayl va oldingi QA dalillari saqlandi. Mac checkoutdagi oldingi source-state `c6faf3529485aefe80b9069102278a29de9a8b56d648cc991c10516c1e15ffd9` aynan mos chiqdi. Reset, branch almashtirish yoki qayta yaratish bajarilmadi.

Davomiy kod o'zgarishlari:

- Besh domenning direct LLM adapter chaqiruvlari ham resolver ishlatadigan umumiy input/output kontraktidan o'tadi. Bo'sh/uzun ish, boshqa domen kontrakti, dalilsiz iqtibos va noto'g'ri kriteriyalar qabul qilinmaydi.
- Writing sentence-check outer content bilan nested answer mosligini tekshiradi. Nol essay target ishlaydigan uchta sentence-check yo'li saqlangan.
- Pronunciation bahosi, takroriy pronunciation kriteriyasi va mos kelmaydigan Writing analysis olib tashlanib yashirilmaydi; noto'g'ri javob rad etiladi.
- Keltirilgan bo'sh yoki whitespace-only iqtibos dalil emas. Iqtibosning null/yo'q holati undan alohida saqlanadi.
- Speaking summary attempt/item partini va saqlangan kontraktni tekshiradi. Teaching evidence va before-example ham reviewed transcriptga bog'langan. Active yoki qamrovi to'liq bo'lmagan session uchun overall chiqarilmaydi.
- Grounded legacy null-contract yozuvlari hali ishlaydi. Saqlangan overall summary balliga manba bo'lmaydi; uchta qo'llab-quvvatlangan mezon asos bo'ladi.
- Transport testi endi Writing so'roviga mos to'rtta Writing kriteriyasi va grounded analysis qaytaradi. Avvalgi Grammar verdictini Writing natijasi sifatida qabul qilish xatosi yashirilmagan.

Yangi source-state: `558ffebe124f68a1ad941ab23a67a9ef56f771d81db0b76aae8ba9795d2c96a4` (1203 source fayl).

Joriy QA holati va raw receipt hashlar `RIWI-BATCH-16-CONTINUATION-QA-RESULTS.json` ichida. Original Batch 16 QA c6f holatini isbotlaydi. Yangi dalillar alohida `RIWI-BATCH-17-*` fayllarida 558f holatiga bog'langan. Receipt set raqami yangi publish yoki progress foizi degani emas. Ledger qatorlari o'tgan testlar sifatida hisoblanmaydi.

Qabul qilingan original guruhlar 17/34 = 50%. Yangi to'liq yopilgan guruhlar 0. Kamida oltita qo'shimcha original guruh qabul qilinmaguncha push sharti bajarilmaydi. B01/B04 uchun barcha 68 vazifaning actual semantics/runtime bog'lanishi qolgan; real provider/browser/R2, native PostgreSQL va restore/PITR muhit dalillari ham hali to'liq emas.

GitHub bazasi `147305642fc60470fd7097ec68349e66527b6ae4`; Production GO berilmagan. Vercel/cron sozlamasi, deploy va Speaking retention muddati o'zgartirilmagan. Build egasi ko'rsatmasiga binoan qayta ishga tushirilmagan.

Yakuniy mahalliy QA: backend 1324 jami / 1233 PASS / 0 FAIL / 91 SKIP; UI 257 PASS / 0 FAIL / 0 SKIP; typecheck va lint exit 0. Alohida provider/speaking tekshiruvlari 48 PASS. Fresh scoped receiptlar 38 PASS. Bu bir mahalliy gate; ikkita native publication gate yoki real provider/browser qabulining o'rnini bosmaydi.
