# Learners Area — Phase 2 yakuniy hisobot

2026-11-09 yangilanish: backend 5,923 test va 282 subtest PASS, xato yo‘q. Avvalgi17 xato tuzatildi. Frontend1,385 PASS,11 skip,0 fail. Joriy dalillar: [05-backend-validation.md](05-backend-validation.md). Quyidagi avvalgi o‘lchov va test natijalari tarixiy dalil sifatida saqlandi. Umumiy Phase2 holati PARTIAL.

Natija: PARTIAL. Tasdiqlangan tuzatishlar arena branchiga yuborildi. Barcha acceptance shartlari yopilmagan. Phase1 dizayni saqlandi. Keyingi mahsulot bosqichi boshlanmadi.

## A. Git va boshlang‘ich holat

| Maydon | Qiymat |
|---|---|
| Repository | `N-Muhammadjonov/learners_area` |
| Branch | `arena/learners-area-next` |
| Boshlang‘ich SHA | `76f73b81d731a11348b91082e4e42e3402f923f7` |
| Kod commit SHA | `6abe47bbca3dbaf4733d10db17c91d7267fbbceb` |
| Yakuniy hisobot commit SHA | Ushbu fayl joylashgan commit. Aniq SHA va remote tekshiruv ZIP ichidagi `final-git-receipt.json`da |
| Boshlang‘ich main | `68b0faeb4e1033c24d87ad2198102bc4ed584462` |
| Hisobot tayyorlashdagi main | `bc48ac44ebb8dc65df69d3e477a1494845b60938` — tashqi o‘zgarish |
| Boshlang‘ich farq | Arena84 commit oldinda,1 ortda. Yakuniy farq Git receipt’da |
| Push | Faqat arena, actual remote parent/tree asosida, expected-head guard, force ishlatilmagan |

Main’ga yozilmadi, undan merge/rebase/cherry-pick qilinmadi. Main boshqa commit bilan siljigani uchun uni global ravishda “o‘zgarmadi” deb yozmaymiz. Production deployment, konfiguratsiya, database migration va production ma’lumotlariga write bajarilmadi.

## B. Majburiy 13 bandli taqqoslash

Mentora’ning ish tezligi barcha qatorlarda NOT VERIFIED. PDF va ZIP ishlaydigan raqib saytning nazoratli benchmarki emas. PASS faqat ko‘rsatilgan test qamrovini bildiradi.

| N | Performance afzalligi / sabab | Oldingi LA | Mentora reference | Amalga oshirilgan o‘zgarish | O‘lchangan yangi LA | G‘olib / dalil | QA / status |
|---|---|---|---|---|---|---|---|
|15|Initial loading, kamroq trafik|Dock JPEG9,275,458 B|NOT VERIFIED|WebP va3 keraksiz landing preload olib tashlandi|Dock212,396 B,97.71% kichik|Asset trafiki kamaydi; cold LCP NOT MEASURED|Build/asset PASS, umumiy PARTIAL|
|16|Navigation, barqaror lifecycle|Router avval ham lazy edi|NOT VERIFIED|Router saqlandi, noto‘g‘ri startup refresh olib tashlandi|20 foreground proxy: p50100.2/p95220.9ms; oldin100/233.2|Tezlik g‘olibi isbotlanmadi|Back/Forward PASS, readiness PARTIAL|
|17|Warm navigation, keraksiz private yuklashni kamaytirish|DTO va barcha ochiq audio warm qilingan|NOT VERIFIED|Code-only prefetch, constrained policy|5 yangi policy testi PASS|Kamroq speculation; hit/miss baytlari NOT MEASURED|Scoped PASS, real network PARTIAL|
|18|DOM rendering, inputni saqlash|1000 editda107000 yangi element/1000 pane almashtirish|NOT VERIFIED|Incremental answer/save patches|0 yangi element/0 pane/input almashtirish; p954.110→1.785ms|Synthetic DOM benchmark yaxshilandi, INP emas|Widgets/ACK va Chrome200 edit PASS|
|19|CSS/JS delivery, Range xotirasi|10-byte Range33,689,925 traced B|NOT VERIFIED|FileResponse streaming, stale katalog yangilandi|157,593 traced B; p5021.744→3.669ms|ASGI allocation/latency yaxshilandi|HTTP/build PASS, live proxy PARTIAL|
|20|API cache, identity/freshness|Mavjud identity cache|NOT VERIFIED|Policy/auth saqlandi, auto private DTO prewarm o‘chirildi|Cache/identity testlari PASS|API tezligi da’vo qilinmaydi|Unit PASS, barcha live role NOT VERIFIED|
|21|Audio, real playback/recovery|Redraw audio’ni uzgan, play takrorlanishi mumkin|NOT VERIFIED|Doimiy audio host, single-flight, native holat|Synthetic Chrome audio/resume37:41 ishladi;1 audio|Lifecycle fix tasdiqlandi, original faqat preflight|PARTIAL: protected original/Safari yo‘q|
|22|Long session, tab ochilganda examni saqlash|Startup refresh boshqa examni remount qilgan|NOT VERIFIED|Faqat noto‘g‘ri boshlang‘ich hint olib tashlandi|37min Listening/35min Reading, alohida resume/expiry|Uzluksiz60min NOT VERIFIED|PARTIAL|
|23|Backend capacity, saturation sababini ajratish|SSE/budgets/pool5 avval mavjud|NOT VERIFIED|Real PG load/SSE harness, API limitlar saqlandi|150SSE+400 request ikkala buildda400×200; katta mixed tierda503 bor|Causal capacity g‘olibi yo‘q|Matrix bajarildi, production PARTIAL|
|24|Error recovery, draft holati|Eski ACK yangi editni Saved deyishi mumkin|NOT VERIFIED|ACK guard va barqaror audio retry|ACK/widget/audio recovery testlari PASS|Correctness fix; latency NOT MEASURED|Scoped PASS, to‘liq offline matrix PARTIAL|
|25|Multi-tab, exam reset bo‘lmasligi|Yangi tab account refresh yuborgan|NOT VERIFIED|Faqat startup publish olib tashlandi|Ikki tab logout private UI’ni yopdi; yangi tab audio’ni reset qilmadi|Reproduksiya qilingan sabab tuzatildi|Scoped PASS, offline/concurrent submit PARTIAL|
|26|Health, deploy va feature holatini ajratish|Phase2 smoke receipt yo‘q|NOT VERIFIED|GET-only smoke va runbook|Local16/16; public0/6 ConnectError; source Vercel success|Diagnostika bor; production feature health NOT VERIFIED|Local PASS, public BLOCKED|
|27|Real responsiveness, qayta o‘lchanadigan A/B|Baseline saqlangan|NOT VERIFIED|DOM/Range/assets/load va Chrome QA|Input identity saqlandi; CSS o‘zgarmadi;360/390/768/1440 layout|DOM/Range/assets dalili bor, to‘liq A–D g‘olibi yo‘q|PARTIAL|

## C. Asosiy sabablar va tuzatishlar

P0 Listening: `exam.js:draw()` qayta renderda yangi audio yaratib, eski media’ni yangi daraxtga ko‘chirgan. Natijada audio DOM’dan uzilgan va ortiqcha preload paydo bo‘lgan. Endi media alohida doimiy hostda turadi. Pending play bitta promise bilan boshqariladi. Recovery tugmasi faqat haqiqiy playback boshlanganida yashiriladi. Autoplay bloklansa, tushunarli recovery qoladi.

Chrome’da synthetic3660s MP3 haqiqatan decode va ijro qilindi. Resume37:41’dan tiklandi. Bloklangan autoplay paytida timer yurmagan. Recovery click’dan so‘ng audio davom etgan. Notes/section almashtirish qo‘shimcha loadedmetadata yoki playing sikli yaratmagan. Yakuniy native audio3500.815/3660s, bitta element, error yo‘q.

Original R2 inventarida qaytgan34 audio obyektining size/MIME mosligi tekshirildi.01/18/32 fayllar connector ichida SHA256 va MPEG frame tahlilidan o‘tdi.18/32 hash manifestga mos,01 uchun expected hash yo‘q. Bu native decode yoki signed Worker orqali playback isboti emas. Protected original audio, CORS/Range/seek/expiry E2E tekshiruvi uchun tasdiqlangan QA sessiyasi mavjud emas. P0 acceptance ochiq.

P1 Reading: oddiy javob va save-status o‘zgarishi butun questions pane’ni qayta yaratgan. Endi tegishli input, counter, navigation va save badge patch qilinadi. Choice handlerlar joriy answer’ni o‘qiydi. Source Choose TWO va bir table row’dagi mustaqil radio guruhlari saqlandi. Eski ACK yangi pending javobni Saved deb ko‘rsatmaydi. Timer, submit, grading, question data va API semantikasi o‘zgarmadi.

Cross-tab: workspace ochilishida mutation bo‘lmasa ham refresh broadcast yuborilgan. Faqat shu chaqiriq olib tashlandi. Logout/profile/auth mutation hintlari, server authority, revocation va expiry saqlandi. Haqiqiy disposable auth bilan ikki tabda logoutdan so‘ng login formasi ochilgani tekshirildi.

Backend: joriy kod eski25s long-poll emas, SSE ishlatadi.150 stream oddiy request slotlarini band qilmadi.5 pool connection va1 listener kuzatildi.400 request va40 recovery ikkala buildda200 qaytardi.100/150 mixed client tierda mavjud64-request admission chegarasidan `503 busy`, presence rate policy’dan429 qaytdi. API/admission kodi o‘zgarmagani sabab keyingi pastroq503 soni optimizatsiya natijasi deb da’vo qilinmaydi.

## D. O‘lchovlar va muhit

Linux6.18.57 x86_64, Node24.22.1, Python3.12.14, FastAPI0.121.3, Starlette0.50.0, asyncpg0.32.0, Uvicorn0.54.0, PostgreSQL18.6. Deployment config Python3.14.9 logical CPU ko‘rindi, host cgroup limitlari ochilmagan. Shared runner shovqini bor. Browser aniq versiyasi qayd qilinmagan.

| Profil | Bajarilgan qamrov | Natija / chegarasi |
|---|---|---|
|A desktop Chrome|Managed preview, real local ASGI/PG, foreground warm20 route|p50100→100.2ms, p95233.2→220.9ms. Proxy, per-route readiness/INP emas|
|B mobile|360/390/768 iframe layout|Physical device,4G va CPU slowdown bajarilmagan|
|C low resource|SaveData/3g/2GB/2CPU unit fixture|Code prefetch suppression PASS; real hardware NOT VERIFIED|
|D Safari/WebKit|Mavjud emas|NOT VERIFIED|
|Reading paired|20×50 warm Node/jsdom edit|p50/p95/p99:2.329/4.110/14.654→1.115/1.785/2.865ms; browser paint emas|
|Reading Chrome|200 synthetic input|Identity/focus/selection yo‘qotish0; two-rAF33.2/34.3/38.8ms, INP emas|
|Static Range|32MiB fayl/10byte,3 warmup+20 sample|Peak33,689,925→157,593 traced B; p9522.525→5.193ms, p99 N/A|
|Load|1 worker/pool5/real PG,6 tier×3×20s, think1s|36 row; timeout0, lost acknowledged draft0. Yuqori tierda503 mavjud|

Field LCP/INP/CLS p75, controlled cold20–30-run cohort, CPU/network throttling, prefetch hit/miss byte tahlili va Mentora live benchmark NOT MEASURED. Raw lab first-render metrikalari field natija sifatida ishlatilmaydi. Oldingi background navigation run rAF throttling bilan aralashgan va canonical taqqoslashdan chiqarilgan.

Full packaged transfer115,931,099→116,144,560 B. Bu kamaymagan: original JPEGlar qoldi, WebP qo‘shildi. Foyda — Dock ishlatayotgan rasmlar97.71% kichik. Archive ichida101MB optional speech model ham bor, u initial page transfer emas. CSS source469,311 B o‘zgarmagan. Yakuniy build596 runtime fayl/131 route, revision `8bd607b35dfe5b24cb0c` Chrome build bilan mos.

Critical path koddan tekshirildi: no-store HTML → shared CSS/font → main/router/lazy workspace → session authority bilan parallel public module import → authorized mount va ma’lumot. Network waterfall/trace mavjud emas.

Listening37min va Reading35min uzluksiz segmentlar qayd qilindi. Writing untimed local practice hamda SPA navigation taxminan26min.45/60 markerlar oldidan browser hujjatlari yopilgan, aniq sabab aniqlanmagan. Keyin resume va Reading00:00 expiry tekshirildi. Bu uzluksiz60min soak emas. Native timer0 holatini eski probe null deb yozgan, DOM dalili0/00:00/disabled fieldsetni tasdiqlaydi. Yakuniy test probe’da0 encoding tuzatildi.

## E. Test dalillari

| Tekshiruv | Passed | Failed | Skipped | Vaqt / dalil |
|---|---|---|---|---|
|Frontend full1396|1385|0|11|68.889s, `frontend-final.log`|
|Backend full5912|5895|17|0|59.38s,282 subtest PASS, `backend-final.log`|
|Xuddi shu17 baseline test|0|17|0|1.74s, `backend-baseline-matching-failures.log`|
|Media targeted|26|0|0|.877s|
|Reading yangi regression|4|0|0|3.856s|
|Prefetch/intent targeted|38|0|0|1.231s|
|Workspace/authority targeted|11|0|0|.893s|
|Smoke/static/Range/multitab gate|16|0|0|.76s|
|Real local GET smoke|16|0|0|Per-check JSON|
|Public GET smoke|0|6 transport failure|0|ConnectError, sayt down degan xulosa emas|
|Native build, syntax/compile, diff whitespace|PASS|0|0|Receipt’da|

Targeted sonlar full suite bilan ustma-ust, ularni qo‘shmang.11 skip uchun ownerning original `LEGACY_LISTENING_FIXTURE` fayli sozlanmagan.17 backend xatosi baseline’da ham takrorlandi:10 eski route inventory,5 eski Phase1 SEO/copy/logo,2 audio_url’siz mock row. Baseline site-guide setup faqat mavjud generator bilan yangilanib, aynan17 failing node qayta bajarildi. Assert/API ishlashi o‘zgartirib yashirilmagan. Buyruqlar, aniq test ID va stack trace texnik ilova hamda loglarda mavjud.

## F. O‘zgartirilgan fayllar

46 ta kod/test/asset faylining aniq yo‘li va blob hash’i `source-changed-files.json`da. Har bir path → sabab → task → test mapping [texnik ilovaning F bo‘limida](02-final-report.md#f-changed-files). Muhim guruhlar:

- Listening exam/generated render: doimiy media va playback state.
- Reading exam/questions: incremental patch, source group va ACK guard.
- Workspace: noto‘g‘ri startup broadcast olib tashlandi.
- Module prewarm/shell/catalogue/MCQ: private blanket speculation olib tashlandi.
- Dock icon references,13 WebP va offline generator.
- StaticFrontend Range streaming, mavjud131-route site-guide regeneratsiyasi.
- Unit testlar, real PG/preview/load/soak probe va read-only smoke.
- Yakuniy hisobotlar va QA JSON. Product CSS/token/mascot/router/cache/API client o‘zgarmagan.

## G. Artifact va visual dalillar

ZIP’da before/after Reading/Range JSON, controlled load JSON/CSV, SSE/GET smoke, build/payload/hash receipt, test loglar, original media metadata/frame preflight va browser time-series bor. Trace/waterfall/forced-GC heap snapshot/Safari/fieldRUM artifactlari mavjud emas.

Screenshotlar: Dashboard Day/Night1440, Speaking Night390 va Reading catalogue Night360 before/after. Listening catalogue390, Vocabulary390, Progress768, Writing1440, Listening exam, Reading resume/expiry after. Ko‘rilgan juftliklarda Phase1 gradient/cards/Dock/mascot saqlangan.8 after layout’da document horizontal overflow yo‘q. CSS/source hash parity ham tekshirildi. Capture wrapper/scale farqi bor, pixel-perfect da’vo qilinmaydi. Management student fixture’da qayta render qilinmagan.

Railway/Cloudflare/GitHub holati faqat read-only ko‘rildi. Railway main’dan1 replica ishlatgan, deployment snapshot SUCCESS. Source6abe47b Vercel success. Bu authenticated production health isboti emas. Public origin ushbu muhitdan ConnectError berdi. Worker query-string redaction false ko‘rindi, invocation log off: operator review bandi, ma’lumot sizishi dalili emas. Secret qiymati o‘qilmadi, sozlama o‘zgarmadi.

## H. Qolgan ishlar

| Severity | Ochiq band | Keyingi aniq qadam | Operator qarori |
|---|---|---|---|
|P0 acceptance|Protected original audio E2E|Tasdiqlangan QA sessiyasi bilan original decode/seek/CORS/expiry matrix|Account/access kerak|
|P1 acceptance|Uzluksiz60min/four journeys|Persistent browser’da0/15/30/45/60 markerlar va save integrity|Test muhiti kerak|
|P1 acceptance|Native IME/drag/Safari/pending-save handoff/offline tabs|Izolyatsiyalangan fixture va haqiqiy browser profillarida tekshirish|Browser/hardware kerak|
|P1 capacity|High tier503/p95|Productionga o‘xshash staging resource caps/data bilan trace va admission review|Production worker/pool/plan o‘zgarishiga alohida ruxsat|
|P2 measurement|Cold/throttle/fieldRUM/Mentora live yo‘q|Yetishmayotgan A–D cohort va o‘lchovlar|Tool/hardware, live telemetry setup uchun ruxsat|
|P2 monitoring|Public smoke tarmoqdan o‘tmadi|Reachable operator muhitida expected productionSHA bilan GET gate|Network/session kerak|
|P2 operations|Worker redaction review|Capability URL log siyosatini tekshirish|Production config uchun ruxsat|

## I. Yakuniy status

PARTIAL. Branchdagi fixlar va ularning dalillari topshirildi. P0 original audio E2E, uzluksiz60min va to‘liq device/network acceptance yopilmagani sabab COMPLETE deyilmaydi. Backenddagi17 xato yopildi.11 importer skip va qolgan browser/device acceptance cheklovlari ochiq ko‘rsatildi.

Faqat arena branchiga push. Main’ga tegilmadi. Production deployment va keyingi bosqich bajarilmadi. Shu yerda to‘xtaldi.
