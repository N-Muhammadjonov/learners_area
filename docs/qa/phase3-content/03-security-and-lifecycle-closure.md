# Phase 3 — yakuniy kod va avtomatik tekshiruvlar

Sana: 2026-11-10, Asia/Tashkent. Boshlang‘ich arena: `bde29af18a3d306604303856f50f9f9a99c274e4`. Read-only main: `bc48ac44ebb8dc65df69d3e477a1494845b60938`.

`00-scope-and-findings.md` va `02-evidence-summary.json` avvalgi yetkazib berishning tarixiy holatini saqlaydi. Ushbu hujjat P3-SEC-01 va Listening lifecycle bo‘yicha joriy natijadir.

## Sabab va tuzatishlar

Javob kaliti bor study runtime va ayrim grading/review API yo‘llari serverdagi exam/review holatini bir xil tekshirmagani sababli kalitlar topshirishdan oldin olinishi mumkin edi.

| Muammo | Joriy xatti-harakat | Dalil |
|---|---|---|
| P3-SEC-01: oldindan yuborilgan runtime | Yangi o‘quvchi faqat start, faol attempt egasi faqat resume oladi. Answer-bearing runtime topshirilgandan keyin ochiladi. | Real login, owned PostgreSQL, ASGI |
| Study/practice API bypass | Study, practice va activity serverdagi shu chegarani tekshiradi. Unstarted/active student 409 oladi. | Alohida oldin FAIL, keyin PASS API reproduksiyasi |
| Eski review orqali faol retake kaliti | Faol retake paytida oldingi completed review ham 409. Recent mistakes faol test kalitlarini qaytarmaydi. | Oldin FAIL, keyin PASS API reproduksiyasi |
| Chiqishda draft yo‘qolishi | Route abortdan mustaqil, 12 soniya bilan chegaralangan save. Bir flight va eng so‘nggi pending snapshot. | Frontend lifecycle regression |
| Ikki tab javobni almashtirishi | Server row lock + draft hash. Eskirgan o‘zgarish 409, yo‘qolgan ACK retry idempotent. Server/local tanlovi aniq harakat talab qiladi. | Real DB write/resume/conflict va frontend queue testlari |
| Current package bilan pinned attempt baholanishi | Snapshot savollari, kalitlari va explanation ishlatiladi. Nomos legacy mapping 409 bilan ushlab qolinadi. | Current key o‘zgarganda pinned score saqlanishi; drift/foreign/missing snapshot testlari |
| Key-free examda manba map yo‘qolishi | Mavjud PARTS’dan faqat inert SVG geometriya olinadi. Script, URL yoki DATA uzatilmaydi. Mavjud image reference saqlanadi. | Source geometry + hostile SVG regression |
| Content version SQL xatosi | `$12` ning INSERT va CASE joylarida bir xil varchar turi aniq berildi. | Real PostgreSQL’da published pin + submit |

Original study runtime, audio, transcript, key, passage, pack va rasmlar o‘zgartirilmadi. Yangi savol yoki explanation yaratilmagan. Staff content-preview vakolati saqlanadi, ularning faol attempti ham himoyalanadi. Oldingi session, admission, RBAC, scoring va timing siyosati o‘zgarmadi. Schema/migration va dependency o‘zgarishi yo‘q. Token yubormagan eski draft clientining javobi hali ham `{ok:true}`.

## Avtomatik natijalar

| Tekshiruv | PASS | FAIL | SKIP | Natijaning chegarasi |
|---|---:|---:|---:|---|
| To‘liq frontend | 1,407 | 0 | 11 | DOM/unit regressiyasi. 11 eski importer case uchun original embedded-audio fixture yo‘q. |
| To‘liq backend | 5,942 | 0 | 0 | Qo‘shimcha 282 subtest PASS. Bitta dependency deprecation warning. |
| Phase 3 real PostgreSQL + auth + ASGI | 51 | 0 | 0 | Synthetic foydalanuvchilar; real lifecycle, scoring, ownership, retry va review. |
| Phase 2 real PostgreSQL + auth + ASGI | 67 | 0 | 0 | Oldingi asosiy backend/persistence/RBAC regressiyasi. Stability run emas. |
| Read-only revision compatibility | 1,430 | 0 | — | 62 published snapshot, missing row/prompt mismatch 0. Editorial accuracy tasdig‘i emas. |
| Python native build | PASS | 0 | — | 846 fayl, 131 route, revision `829878ca7efd9243072e`. |

Backend command: `cd services/backend && python -m pytest -q`.

Frontend command: `cd frontend/vanilla && node --test tests/*.test.mjs tests/staff-final30/*.test.mjs`.

API commands: repo rootdan `python services/backend/tests/phase3_content/core_integration.py --output /tmp/phase3-qa` va `python services/backend/tests/performance_phase2/integration_followup.py --output /tmp/phase2-qa`. Ikkalasi o‘z disposable PostgreSQL bazasini yaratadi, tashqi DSN qabul qilmaydi.

Raw output, XML va aggregate JSON yakuniy QA paketida. Oldingi FAIL reproduksiyalari tarixiy dalil sifatida saqlangan. Ular joriy PASS bilan almashtirilmagan yoki yashirilmagan.

## 21 qatorning joriy holati

Mentora backend/scoring xususiyatlari va row-specific winner claimlari NOT VERIFIED. Quyidagi PASS faqat ko‘rsatilgan avtomatik kontraktga tegishli.

| # | Modul | Tuzatish yoki asosli no-change | Joriy qabul holati |
|---|---|---|---|
| 28 | Full Listening | Secure start/resume, key-free 40 savol, exit save va server grading | Avtomatik PASS; real audio/timer/device qabuli egada |
| 29 | Listening types | Multi input aniqligi va original map geometriyasi; mavjud formatlar saqlangan | Avtomatik regressiya PASS; browser interaction egada |
| 30 | Listening review | Server-owned completion, retake guard va immutable question mapping | Avtomatik PASS; owner review/demo qabuli qolgan |
| 31 | Academic Reading | Phase 2 draft/recovery, split workspace kodi o‘zgarmagan | Avtomatik regressiya PASS; split/drag QA egada |
| 32 | General Reading | Individual passage-practice kontrakti saqlangan | Alohida GT exam banki tasdiqlanmagan |
| 33 | Articles | Mavjud passage study/word saving saqlangan | Published article/course lesson materiallari yo‘q |
| 34 | Writing Task 1/2 | Mavjud editor/timer/save; 66 Task 1 va 78 Task 2 published | Avtomatik regressiya PASS; image/editor QA egada |
| 35 | Writing feedback | Server/role-scoped feedback, pending/unavailable holati saqlangan | Haqiqiy external grader va manual qabul tasdiqlanmagan |
| 36 | Speaking 1/2/3 | Mavjud prompt/link/recording lifecycle saqlangan | Avtomatik regressiya PASS; mic/recording QA egada |
| 37 | Speaking mock | General Mock fixed/auto speaking kodi saqlangan | Standalone catalogue yoki published mock tasdiqlanmagan |
| 38 | Speaking partner | Mavjud discovery/leave/relay kontrakti saqlangan | Real peer/TURN/WebSocket qabuli egada |
| 39 | Fluency game | Tasdiqlanmagan scoring yoki yangi activity qo‘shilmagan | Dedicated activity NOT IMPLEMENTED |
| 40 | Podcast | Mavjud media engine saqlangan | Podcast yozuvlari 0, approved content talab qilinadi |
| 41 | TED/video | 25 published video, transcript/source va duration fallback saqlangan | Avtomatik regressiya PASS; real playback/sync egada |
| 42 | Grammar | Mavjud engine saqlangan | Topics/exercises/lessons 0; curriculum blocker |
| 43 | Vocabulary | Arena 9 pack/1,782 so‘z; main-only Media/Art ko‘chirilmagan | Avtomatik regressiya PASS; editorial/manual qabul qolgan |
| 44 | SRS | 7 casual game tarixni surmaydi; concurrent revision bir marta | Real DB avtomatik PASS |
| 45 | Games | Server verdict, retry, exact gap, ambiguity va duplicate counting tuzatilgan | 7 game API PASS; browser QA egada |
| 46 | Retention | 75 active version/source/history saqlangan | Avtomatik regressiya PASS; read/recall/result QA egada |
| 47 | Explanations | Listening oldindan kalit bermaydi; pinned explanation stable ID bilan | Security PASS; editorial tekshiruv va 90 Reading evidence quote qolgan |
| 48 | Mock admin | Mavjud authoring/source/upload/manual-grade lifecycle saqlangan | Avtomatik regressiya PASS; published mock 0, manual lifecycle egada |

## Phase 1/2, material va deploy chegarasi

Reading exam/attempt/adapter, backend draft/feedback, design system va Dock CSS bloblari o‘zgarmagan. Listening exam faqat yuqoridagi draft/conflict oqimi uchun o‘zgardi. Mavjud media node’ni saqlash regressiyalari o‘tdi. Build hajmi performance yoki haqiqiy playback isboti deb talqin qilinmaydi.

Main-only Media 161 / Art 175 materiallari main’da qoldi. Arena’dagi Media 126 va boshqa mavjud materiallar qayta yozilmadi. Production DB’da faqat aggregate SELECT ishlatilgan. R2, Worker, DNS, environment yoki production konfiguratsiyasi o‘zgarmagan.

Foydalanuvchi ko‘rsatmasiga binoan bitta final arena push qilinadi. Git integration shu commitdan bitta Vercel preview yaratadi. Alohida deploy/redeploy yoki production promotion qilinmaydi. Aniq commit, URL va READY holati pushdan keyingi yakuniy hisobotda qayd etiladi.

## Qolgan qabul

Agent zimmasidagi reproduksiya qilingan kod xatolari yopilgan, joriy test FAIL soni 0. Butun Phase 3 release acceptance hali PARTIAL: owner manual QA, yuqorida aniq ko‘rsatilgan mavjud bo‘lmagan kontent va editorial/source tasdiqlari qoladi. Bu ishlar to‘qib chiqarilgan material yoki soxta PASS bilan yopilmadi. Phase 4/5 boshlanmadi.
