# RIWI 7/8/9/12/13 — ORALIQ natija (tugallanmagan)

Bu YAKUNIY natija emas. Manba kodi o'zgartirilmagan (c4ef35e5, commit 5203241). Hech bir guruh yopilmadi; 20/34 o'zgarishsiz.

## Nima qilindi (dalil bilan)
- Paket baytlari VERIFY_PACKAGE.py bilan tekshirildi (1874 / 1248 fayl, SHA mos).
- BaseBook SHA 7b78fbae... mos. 68 vazifa kitobdan mustaqil qayta o'qildi: kalit, qator, sarlavha, focus, method, guard — 68/68 mos (evidence/b01).
- Reestr 106 kontrakt; 68 vazifaning hammasi topiladi. Bu katalog mosligi, xatti-harakat PASS emas.
- R07: mahalliy native PG16 PITR mashqi (evidence/r07): 114 jadval hash-bir xil, canary'lar to'g'ri, 181 FK. Bu sintetik mashq; provayder PITR emas.
- Baseline 1-raund: 1476 test, 1458 o'tdi, 2 yiqildi, 16 skip — toza baseline EMAS. Sababi mening muhitim (.git yo'q; RIWI_QA_DATA_DIR qo'yilmagan), manba xatosi emas. 2-raund tuzatilgan muhit bilan boshlangan, natijasi hali o'qilmagan.

## Nima qilinMADI
- B01: 68 vazifaning har biri uchun positive/negative/edge/injection testlari — NOT_EXECUTED.
- B04, B05: boshlanmagan.
- R08: dossier, GLOBAL_GATES, cutover/rollback paketlari yozilmagan. Hozirgi hukm: NO-GO.
- R07 haqiqiy qismi: provayder, ruxsat, maqsad yo'q — OWNER/EXTERNAL REQUIRED.
- UI/typecheck/lint/R04 HTTP: 2-raundda navbatda, o'qilmagan. Yangi build yo'q (owner qoidasi).

## YANGILANISH (yakuniy yig'ish paytida)
- Baseline 1-raund toza emas (muhit: .git yo'q, RIWI_QA_DATA_DIR yo'q). 3-raund bekor: parallel ikkita run bir bazani buzgan. 4-raund (evidence/baseline_round4_PARTIAL) TUGALLANMAGAN log — natija sifatida hisoblanmaydi.
- Qo'shildi: R07/ (fingerprint, runbook), R08/ (GO_NO_GO_UZ, GLOBAL_GATES, cutover, rollback), evidence/b01/ legacy guard review, B04_B05 ko'rsatkichlari.
- B01: kitob bilan 68/68 mos; legacy 31 vazifadan 15 to'liq, 8 qisman, 8 guard task qoidalarida yo'q (qo'lda ko'rib chiqish).
- Hukm: NO-GO. Guruhlardan hech biri yopilmadi. B04/B05 boshlanmagan.
