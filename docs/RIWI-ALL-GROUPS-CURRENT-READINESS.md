# RIWI joriy publication holati

Joriy manba: `bbd0186cbd749a0cbf23969ea84b102e874b110aafa01453826a3998a71255bf` —1258 kanonik fayl.
Bazaviy oxirgi tasdiqlangan GitHub commit: `c538704f92937d142feb056d22542d9a905f0852`.
Branch: `arena/01a10bac-learners-area`. Joriy kod farqi:23fayl. Push hali bajarilmagan.

7/8/9/12/13 kiruvchi ZIPda runtime patch bo‘lmagan; uning manbasi va foydali dalillari tekshirilgan, noto‘g‘ri completion da’volari qabul qilinmagan.20–25 kiruvchi ZIPdagi foydali speaking-rate tuzatishlari joriy qat’iy implementation bilan birlashtirilgan; zaif parallel retention-planner o‘rniga bitta read-only/repeatable-read canonical snapshot saqlangan.6-guruh chat abort/localStorage/eskirgan javob tuzatishlari,28-guruh object copy/uncertain-commit himoyalari va33-guruh mahalliy regression dalillari shu publication tarkibida.

Yangi tuzatish: explicit EN/UZ language preference RIWI sahifasi va gateway javobiga qo‘llanadi; cookie foydalanuvchi identity/role/scope ni o‘zgartirmaydi. Valid cookie yo‘q bo‘lsa profile fallback avvalgidek qolgan; umumiy shell default tilini almashtirish yoki to‘liq default/theme/device matrix PASS deb yozilmadi.

QA:ikki yangi native PostgreSQL16.14 bosqichning har birida1495/1495backend+265/265UI,0fail/skip/cancel/todo,typecheck/lint0,53R06+13R04HTTP.30rawgateSHA mustaqil tekshirildi. Asl Listening ZIP va Speaking bank o‘zgarmadi. Har ikkala cluster yopilgan, vaqtinchalik password olib tashlangan.

Ayni joriy source fizik backup/WAL PITR sinovi:115jadval/181FK,5oldingi canary tiklangan,3keyingi canary yo‘q, restored ownerlogin200/knowledge200/anonymous401. Backup/WAL baytlari hash bilan mustaqil qayta tekshirildi; app va ikkala cluster yopildi. Bu real mahalliy fizik restore; actual hosting-provider restore yoki contractualRPO/RTO tasdig‘i emas.

Chrome:student explicit EN→UZ→EN, har ikkala tildagi RIWI javobi, refresh/history va logout tekshirildi. Mikrofon ruxsati so‘ralmagan, haqiqiy STT yoki tashqi AI/R2 tekshiruvlari bajarilgan deb ko‘rsatilmagan. To‘rtta rolning current-source HTTP sinovlari o‘tgan; oldingi1a6f751f browser4-role basic dalili tarixiy scope’da saqlangan.

Push scope:REVIEWED_CURRENT_CODE_AND_EVIDENCE. Production deployment, traffic cutover, shared DB migration va irreversible Speaking deletion bu buyruqqa kirmaydi. Tekshirilgan code publication qolgan acceptance talablarini CLOSED qilib ko‘rsatmaydi.

| Guruh | ID | Push paketidagi holat | Yakuniy qabul uchun qolgan talab |
| --- | --- | --- | --- |
| 4 | R04 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Deployed scheduler executions and physical deletion receipts |
| 6 | R06 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Exact deployed target and full history/revocation/security/timeout matrix, live provider and real signed-object URL expiry. Current local Chrome basic login/render for all 4 roles passed; not full deployed acceptance. |
| 7 | R07 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Actual authorized hosting-provider restore/backup policy and owner-selected contractual RPO/RTO. Local physical PITR rehearsal is complete, not provider acceptance. |
| 8 | R08 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Mandatory operational evidence and final GO/NO-GO |
| 9 | B01 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Positive/negative/edge/injection semantic acceptance for every original task |
| 12 | B04 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Task-specific semantic/live-provider acceptance; unavailable capabilities earn no completion credit |
| 13 | B05 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Actual configured provider/fallback fixtures on current target |
| 20 | C05 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Real microphone/STT, timeout/retry and cleanup browser journeys |
| 21 | C06 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Actual R2 signed URL expiry and private bytes read-back |
| 22 | C07 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Actual browser and consent/privacy acceptance |
| 23 | C08 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Specific owner policy remains unapproved; no deletion executor or R2 lifecycle enabled; real environment/browser evidence pending |
| 24 | C09 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Full loaded UI device/language/theme and failure matrix plus physical sensor flows. Current Chrome UZ microphone gate visibly loaded; incoming blank-shell images are not full matrix proof. |
| 28 | D04 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Real private R2/S3 object-scope/owner/access/copy/rollback receipts |
| 33 | D09 | Joriy kod va mavjud dalillar kiritilgan; to‘liq CLOSED emas | Required complete operational/full-gate scope: build remains unrun under existing owner constraint, actual provider/R2/browser and required target acceptance remain; current two native non-build rounds have passed. |

Yopilgan20/34=58.823529%. Joriy prompt closure58.82%; umumiyRIWI/umumiyloyiha denominatorlari to‘liq tasdiqlanmagan, foizlari noma’lum.

Dalillar: `docs/evidence/riwi-final-publication/`. Oldingi source/native/PITR/browser dalillari tarixiy holicha saqlangan. Shu source o‘zgarsa joriy QA dalili yangi kodga avtomatik o‘tmaydi.
