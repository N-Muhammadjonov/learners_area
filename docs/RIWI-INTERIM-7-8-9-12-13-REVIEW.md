# 7/8/9/12/13-guruhlar natijasining tekshiruvi

`RIWI_INTERIM_RESULT.zip` yakuniy kod patchi emas. 142257 baytli paketning
SHA-256 qiymati `842bfe6b4f02a4a1e4bc5bfdd3d7c9a738e62350aeb08ce85022a36d119939da`.
CRC va barcha 28 fayl tekshirildi. Unda `src`, migration yoki runtime test
o‘zgarishi yo‘q. Qabul qilinmagan natija mavjud kodni almashtirmaydi.

Tekshiruv hozirgi 1249 faylli RIWI manbasida bajarildi:
`fdc822b9e14e1acfbbafcb8bff799c54d2ede71b248b8ae4eb559bc1a63e2a7d`.
Published base: `5203241429908f66913529ec96b0214bd814da35`.
Branch `arena/01a10bac-learners-area` qayta o‘qildi va shu commitda turibdi.
Learners Area saytini qayta qurish, branch merge, build, deploy yoki push bajarilmadi.

## Tuzatilgan kamchiliklar

1. ZIP README va REQUIREMENT_RESULTS hujjatlari R08 paketlari yozilmagan
   deydi, lekin paketda ular bor. Yangilangan dossier quyidagi haqiqiy holatni
   ko‘rsatadi: hujjatlar tayyor, operatsion qabul ochiq, hukm NO-GO.
2. Paket R06 ni eski OPEN_UNVERIFIED holatida ko‘rsatgan va B04/B05 uchun
   NOT_STARTED deb yozgan. Hozirgi ledgerning PARTIAL va tashqi qabul kutilayotgan
   holatlari saqlandi. Boshqa muhitdagi oraliq ish boshlanmagani mavjud kod yo‘q
   degani emas.
3. Tashqi baseline birinchi raundida fail/skip bor; to‘rtinchi log tugallanmagan.
   Ular yangi manbaning PASS dalili sifatida ishlatilmadi. Hozirgi manbada
   tanlangan 94 test qayta bajarildi: 94 pass, 0 fail/skip/cancelled/todo.
4. Tashqi R07 skripti doimiy katalogni o‘chiradi, shell buyruqlaridan foydalanadi,
   hash/canary/FK farqida nonzero exitni kafolatlamaydi va cleanup `finally` ichida
   emas. Xavfsiz yangi variant `docs/qa/RIWI_R07_NATIVE_PITR_REHEARSAL.py` da:
   yangi tasodifiy private katalog, loopback bazalar, manba manifesti, qat’iy
   tekshiruvlar, migration-journal hashlar va `finally` cleanup. U tiklangan bazada
   haqiqiy `next dev` ilova, password login va private owner knowledge tekshiruvini
   ham bajaradi. Eski xavfli skript ishga tushirilmadi.
5. Tashqi restore receiptidagi vaqtlar qayta hisoblandi: request→ready 3.240736 s,
   start→ready 2.650763 s, request→verified 12.875271 s. Eski 3.0 s qiymat
   sekundlarni yaxlitlashdan kelgan. Bu tashqi timestamp hisobidir, mustaqil
   provider restore dalili emas. `written_at` client acknowledgement emas.
6. B01 katalogi asl kitobdan mustaqil qayta o‘qildi. To‘liq SHA, barcha 68 taskning
   kaliti, qatori, nomi, focus, method va guardi mos. Registry 106 ta. Literal
   guard matni yo‘qligi o‘z-o‘zidan behavioral fail emas; 68/68 katalog mosligi
   ham 68 ta taskning xatti-harakati to‘liq qabul qilindi degani emas. Frozen
   legacy v1 kontraktlar o‘zgartirilmadi.

## Guruhlarning aniq holati

| Guruh | Holat | Qolgan talab |
| --- | --- | --- |
| 7 / R07 | PARTIAL | Haqiqiy provider backup/PITR, ajratilgan restore target, rows/FK/hash, restored app va private objects, tanlangan RPO/RTO. Tashqi lokal rehearsal mustaqil tasdiqlanmagan. Yangi skriptning syntax tekshiruvi o‘tdi; preflight bu muhitda psql/pg_basebackup yo‘qligi sabab mashqni boshlashdan bosh tortdi. |
| 8 / R08 | PARTIAL / NO-GO | Dossier va cutover/rollback hujjatlari tayyor. Majburiy deployed/provider/browser/restore dalillari va 14 ochiq guruh hali bor. |
| 9 / B01 | PARTIAL | 68/68 kitob mosligi va registry regressiyalari o‘tdi. Har task uchun positive/negative/edge/injection semantik qabul alohida ochiq. |
| 12 / B04 | PARTIAL | Grammar, Vocabulary, retention, tutoring, reporting chegaralari lokal testdan o‘tdi. Barcha task va applicable jonli acceptance hali to‘liq yopilmagan. |
| 13 / B05 | REMOTE_PUBLISHED_APPLICABLE_EXTERNAL_ACCEPTANCE_PENDING | Strict provider/input/output chegaralari lokal fixture bilan o‘tdi. Haqiqiy provider transporti va exact deployment natijalari ochiq. |

Dalillar `docs/evidence/riwi-interim-7-8-9-12-13-review/` da. `external-claims/`
fayllari asl tashqi baytlar bo‘lib, qabul qilingan natija sifatida belgilanmagan.
Hozirgi source uchun oldingi R06 native 1478 backend / 261 UI, typecheck/lint
va HTTP dalillari o‘z scope’ida saqlanadi. Hozirgi 94 test ularni almashtirmaydi.

Pushga tayyor lokal o‘zgarishlar R06 ishlari bilan bir checkoutda saqlandi.
Oldingi tartib R06 yakunlangach bitta push edi. Egasi terminalda pushni ishga
tushirgach, skriptdagi kod publication va to‘liq acceptance shartlari ajratildi.
Tekshirilgan joriy kod/dalillar birga push qilinadi; barcha ochiq holatlar saqlanadi.
Hozir push bajarilmadi. R08 operatsion NO-GO kod publicationiga to‘sqinlik
qilmaydi; push deployment yoki 100% acceptance dalili bermaydi.

Joriy prompt: 20/34 = 58.823529%. Umumiy RIWI va umumiy loyiha uchun to‘liq
tekshirilgan denominator yo‘q; ularning foizi noma’lum. Bu tekshiruv 0 guruh yopdi.
