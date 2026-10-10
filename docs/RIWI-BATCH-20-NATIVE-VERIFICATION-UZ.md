Batch20 native QA tekshiruvi

2026-10-10 kuni owner Terminal natijasi mustaqil tekshirildi.
Manba: 9ab8ab6fb9a8a396f6a3445bb6feb44e0ebdf32cc0bcd445a155eefaf42ca905.
Joriy 1215 manba faylining barcha SHA256 qiymatlari va to'liq inventari shu holatga mos.

Har ikkala davra natijasi:
- Backend: 1358 total, 1354 pass, 4 asl-manba skip, 0 fail.
- UI: 260 pass, 0 fail, 0 skip.
- Typecheck va lint: exit 0.
- Har davra uchun yangi private PostgreSQL 16.14 klasteri.
- QA va portability bazalari: 51 tadan canonical migratsiya.
- Klaster identity tekshiruvi testlardan oldin va keyin o'tgan.
- Ikkala klaster yopilgan. PID va vaqtinchalik password fayli yo'q.

29 ta ZIP a'zosi local owner fayllari bilan byte-for-byte mos. 26 ta gate logning SHA256 va exit code qiymatlari tasdiqlangan.
Avvalgi92skipdan88tasi har davrada PASS bo'lgan. Batch19dagi5ta native dalildan tashqari83ta yangi case uchun dalil qo'shildi.
Ikki davra bir xil testlarni takroriy tekshiradi, ular ikki baravar unique test deb hisoblanmaydi.

Qolgan4skip:
- Original Listening paketining tarkibi, sonlari va transcript dalili.
- Original Listening manbasi bilan40javob grading va immutable qayta-submit.
- Original Speaking bank bilan idempotent re-import.
- Original Speaking bank bilan draftning Practice/Live Partner'da yashirinligi.

Populated0019→0020 upgrade va fresh native portability dry-run/apply/duplicate rollback testlari ikki davrada o'tgan. Bu real backup/PITR, historical full restore yoki R2 object movement acceptance o'rnini bosmaydi.

Oldingi blocked environment urinish, Batch19 va Batch20 immutable ZIP'lari saqlangan. Runtime kod, native checkout, build, commit yoki push o'zgarmagan.
Qabul qilingan original guruhlar17/34=50%. Yangi to'liq yopilgan guruh0. Umumiy RIWI va loyiha foizlari tasdiqlanmagan.

To'liq dalil: RIWI-BATCH-20-NATIVE-VERIFICATION.json.
Loglar: docs/evidence/riwi-batch20-native.
