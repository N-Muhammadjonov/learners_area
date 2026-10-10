Kelgan holat saqlandi. Reset, qayta klonlash, branch almashtirish, rebuild, majburiy push yoki website bilan merge bajarilmadi.

Oxirgi mustaqil tekshirilgan GitHub checkpoint: `arena/01a10bac-learners-area`, `7f805af85705906f6c37710a3030f3eb357e90c0`. Step 14 ning 8/8 blob dalili `RIWI-STEP-14-REMOTE-VERIFICATION.json` da. Batch 15 hali shu checkpointdan keyingi candidate hisoblanadi; uning native QA/push dalili alohida kerak.

17.65 foiz punktli paket uchun olti guruh ko'zlangan: R01, R02, R03, B06, D08, D10. Hisob o'zgarmaydi: oldingi qabul 11/34 = 32.35%; oltita guruh to'liq tekshirilib, push va remote blob tasdig'idan keyin 17/34 = 50%. Paket tayyorlash yoki 15,476 ta manba qatorini ro'yxatlash bu foizni avtomatik oshirmaydi. Butun RIWI yoki website foizi uchun tekshirilgan umumiy denominator yo'q.

| Guruh | Natija va dalil | Qabul chegarasi |
| --- | --- | --- |
| R01 | Barcha 1,482 published fayl va dastlabki 38 yo'l tekshirildi; eski ledgerning asl 11,263,730 bayti/blobi saqlandi. `PRESERVATION-RECONCILIATION.json` | Yangi paketning native gate va atomik publication/blob tasdig'i kerak |
| R02 | Ikkala branchning to'liq SHA/path matrixi, 15 migratsiya to'qnashuvi, SQL/journal/catalog/snapshot farqlari va aniq runbook | Reconciliation dalili; haqiqiy merge, yangi integrated migration yoki cutover bajarilmagan |
| R03 | To'rtta original promptning SHA/bloblari tekshirildi; yangi ledger haqiqiy manba satri, implementation hash, bajarilgan command/result va content state bilan bog'langan | Faqat aniq mappingli lokal talablar lokal verified; qolganlari REVIEW_REQUIRED, live dalil NULL |
| B06 | Rollback candidate, exact hash approval, v3 haqiqiy validator fixtures, v2 moslik, EN/UZ parser/UI, rol va historical-evaluation himoyasi | Lokal DB/JSDOM va native code QA; deployed rol/browser/provider proof R06 da ochiq |
| D08 | 113/113 table allowlist va barcha kerakli non-row schema sinflari, ikki alohida canonical rehearsal, service/object/backup/rollback inventory | Bu source reconciliation; native restore, production catalog va real storage dalili R05/R07/D03–D05 da ochiq |
| D10 | Shu topshirish hujjati, 576 ta aniq manual/runtime holat, barcha ochiq guruhlar va inherited skiplar | Hujjat/matrix tayyor; 576 ta browser testi o'tdi degan da'vo yo'q |

Owner policy odatdagi tartibi: ruxsat etilgan taqdimot xabarini yuboring, previewdagi tekshiruvlarni ko'ring, alohida tasdiqlang. Oldingi sozlamaga qaytishda superseded versiyani tanlang va undan yangi nomzod yarating; eski policy shu zahoti faollashmaydi. Yangi preview va tasdiq kerak. Xato yoki huquq bekor qilinsa amal avtomatik qaytarilmaydi. UZ namuna ham EN bilan bir xil ruxsat etilgan maydonlarga aylanadi.

Yangi original-prompt dalili `RIWI-BATCH-15-CURRENT-EVIDENCE.jsonl` va `RIWI-BATCH-15-EVIDENCE-MANIFEST.json` da. Eski `RIWI-FINAL-REQUIREMENT-LEDGER.jsonl` arxiv sifatida o'zgarishsiz saqlangan; undagi tarixiy PASS yozuvlari bugungi acceptance emas. Eski generator endi arxivni default yoki explicit target sifatida qayta yozishni rad etadi. Yangi generatorning test natijasi, skipi, manba SHA si yoki state xeshi mos kelmasa lokal acceptance berilmaydi. Fake caller SHA bilan PASS yasalmaydi.

Hali bajarilishi kerak bo'lgan chegaralar:

| Qolgan guruhlar | Keyingi aniq ish / yetishmayotgan dalil |
| --- | --- |
| R04 | Identifikatsiyalangan authorized scheduler/environmentda cron, dry-run va haqiqiy chat deletion receipts |
| R05 | Native PostgreSQL fresh/upgrade/concurrency va canonical Listening/Speaking bank/source; 91 inherited skipning asl sharti |
| R06 | Exact deployed URL/state, to'rt rol sessiyasi, live AI fixed fixtures va manual matrix receipts |
| R07 | Provider backup/PITR safety point, actual isolated restore/app boot, o'lchangan RTO/RPO; maqsadlar owner tomonidan tanlanishi kerak |
| R08 | Barcha mandatory runtime/operational dalillardan keyingi final GO/NO-GO; hozir Production NO-GO |
| B01 | 68 source taskning registrationdan tashqari haqiqiy semantics/positive-negative-edge execution dalili |
| B04 | Grammar/Vocabulary/retention/tutoring catalog vazifalarining haqiqiy executable yo'llari va truthful unavailable holatlari |
| B05 | Barcha provider/local contracts uchun actual evaluator fixturelari, output/schema drift/fallback/provenance parity |
| C05–C07 | To'liq audio/review/send/retry, provenance, private history va summary acceptance; published qisman kodni tekshirish |
| C08 | Alohida Speaking audio/transcript retention qarori, dry-run va real R2 lifecycle; chatning 7/30 qoidasini qo'llamaslik |
| C09 | Haqiqiy desktop/tablet/mobile microphone/STT, UZ/EN/day/night va keyboard/focus browser matrix |
| D03 | Broader multi-owner identity reconciliation, native concurrent/uncertain-COMMIT acceptance |
| D04 | Real O1 access va O2 immutable copy/read-back, staged object cleanup/failure reconciliation |
| D05 | A/B/C uchta native clean destination, >1,000 row, FK/hash/identity/object va representative app boot |
| D09 | Oxirgi source uchun ikki final native gate; owner no-rebuild ko'rsatmasi sabab oxirgi-source build acceptance da'vo qilinmaydi |

Keyingi native gate/push faqat bitta ko'rib chiqilgan patchni exact 7f805af base ustiga qo'llaydi. Ikkita backend/UI/typecheck/lint gate muvaffaqiyatli bo'lmasa commit/push bo'lmaydi. Existing dirty native fayl, boshqa branch yoki o'zgargan remote ref bo'lsa script to'xtaydi va mavjud holatni saqlaydi. Force ishlatilmaydi. Build owner ko'rsatmasiga ko'ra qayta bajarilmaydi. Push logidagi SHA keyin GitHub ref/tree va har bir changed blob orqali mustaqil tekshiriladi.

Deployment, Production migration, provider-policy activation, Speaking lifecycle deletion, PITR restore yoki website merge bu paketga kirmaydi. Ular uchun kerakli authorized target va real receipts hali yo'q; bu chegaralar 100% deb yashirilmaydi.
