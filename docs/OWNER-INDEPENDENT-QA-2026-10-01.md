# Learners Area — mustaqil QA hisoboti, 2026-10-01

**Umumiy holat: PARTIAL. Part 1 / Part 2 to‘liq tugagan deb tasdiqlanmagan.**

Tekshirilgan boshlang‘ich Arena commit: `4aecaabb04613202cc9d2ef07c3679e5799ab857`.
Mening push qilingan tuzatishlarim: `12eaa933293046b7e59c2b7908604506dc88de52`, keyin `56cda51f1bbb5b88514ad1b236cb605f0bccf1ff`.
Branch: `arena/01a0f1a0-learners-area`. Force-push ishlatilmagan.
Yakuniy kod Preview: https://learners-area-beldjwvf4-learners-area.vercel.app
GitHub deployment 6786095784 aynan 56cda51 SHA uchun SUCCESS.

## Arena hisobotidan farqli topilmalar

| Masala | Mustaqil dalil | Hozirgi holat |
|---|---|---|
| Email/parol login | Eski Preview login POST 503, column_missing; QA bazasida google_sub yo‘q | Login majburiy ustunlargagina so‘rov qiladi. 12eaa93 va 56cda51 Preview login muvaffaqiyatli |
| N07 leave/unmount | Boshlang‘ich UI suite 95/96; recovery so‘rovi bekor qilinishi testi yiqildi | Controller va timer cleanup tuzatildi; test signal haqiqatan aborted bo‘lishini tekshiradi |
| N14 rubrikadagi alohida so‘zlar | Alohida rubrika terminlari ayrim matnlarda 100 olish xavfi | v5 alohida termin ro‘yxatlarini to‘liq da’vo sifatida hisoblamaydi; eski urinishlar qayta baholanmagan |
| N14 matnning o‘zi | 8 draftning manba matni avval 90 edi | Manba jumlalari aniqlashtirildi: 75/75 canonical va 75/75 source 100; bu inson tahriri/semantic certification emas |
| N16 manba yo‘q yoki collision | Asl ZIP assets/learners-area-brand branchida bor | Ta’riflarni o‘zgartirmasdan v2 identifikator; dry-run exit 0, 104 publishable, 1 held draft. Preview import qilinmagan |
| Listening start/submit | Mijozda chegarasiz so‘rov; serverda ketma-ket bo‘lmagan writes | 12 s limit, leave abort, single-flight, owned transaction locks, qayta submit 409; PGlite yozuv testi va UI recovery testlari o‘tdi |
| O‘qish oynasida Daraja tanlash | Preview’da assigned reading paytida tugma chiqardi | 56cda51’da olib tashlandi. UI regressiya testi bilan tekshirildi; aynan yangi tugma yo‘qligi Preview’da hali alohida sinovdan o‘tmagan |
| Speaking Practice | 12eaa93 Preview error boundary, digest 2402713788 | HALI FAIL. Missing speaking schema ehtimoli kuchli; aynan digest sababini runtime logs bilan yakunlash kerak |
| QA migratsiya tarixi | Jurnalda 24 yozuv; 0020 dan keyin 0022 bor, 0021 hash ko‘rinmaydi; oxirgi hash 0024 | Tarix prefix bilan mos emas. 0021 ustuni holati hali yakuniy tasdiqlanmagan. Himoyani o‘chirib 0025–27’ni qo‘llash mumkin emas |
| QA backup | Supabase QA Backups: Free Plan does not include project backups | Haqiqiy recovery nusxasi va maxfiy DB ulanishi kerak; hech qanday Production/QA DDL bu tekshiruvda qo‘llanmagan |

## Ikki marta avtomatik tekshiruv

Yakuniy funksional kod, Retention reading tugmasi o‘zgarishidan keyin:

| Tekshiruv | 1-davra | 2-davra |
|---|---:|---:|
| Asosiy testlar | 686 jami: 656 PASS, 0 FAIL, 30 SKIP | 686 jami: 656 PASS, 0 FAIL, 30 SKIP |
| UI testlar | 98/98 PASS | 98/98 PASS |
| Typecheck | PASS | Oxirgi kodda PASS |
| Lint, 0 warnings | PASS | Oxirgi kodda PASS |
| Production build | PASS | Yakuniy kodda build PASS; Vercel ham SUCCESS |
| Retention schema | 11/11 PGlite | Bu real Preview DB verifikatsiyasi emas |

30 SKIP — alohida PostgreSQL bazasi bilan ishlaydigan access, migration, OAuth/call races, import, cleanup, vocabulary va Writing tekshiruvlari. Men ularni real PostgreSQL’da qayta bajarmadim. PGlite mahalliy sinovlari real ko‘p-connection concurrency o‘rnini bosmaydi.
Birinchi qayta ishga tushirishda ikkita socket testi sandbox tarmoq ruxsati sabab EPERM bilan yiqildi. Tarmoq ruxsati berilgach to‘liq suite qayta o‘tdi; bu muvaffaqiyatsiz run yashirilmagan.

Test o‘zgarishlari: vendor manzillari uchun blanket taqiq server-only adapter fayllarini aniq allowlist bilan ajratishga moslandi; mijoz/routes/data/core’da taqiq saqlangan. N07 testi tasodifiy 40 ms kutish o‘rniga so‘rov milestone’ini kutadi va haqiqiy abort’ni tekshiradi. Retention reading testiga level-switch yo‘qligi talabi qo‘shildi. Oldingi asosiy assertions olib tashlanmagan.

## Real brauzer dalili va chegarasi

Chrome ishlatilmagan. Safari va alohida Codex brauzeri ishlatilgan.

| Qism | Dalil | Status |
|---|---|---|
| Login | QA owner bilan ikkala yangi Preview’da dashboard ochildi | Tekshirilgan |
| Navigatsiya | 56cda51: Listening → TED → Reading → Writing → Dashboard, 3 davra, 15 finished transitions; async content marker yuklanishi kutildi | Shu yo‘llarda tekshirilgan, barcha tugmalar emas |
| Full reload | 15 o‘tishda documentId e81175dc-6924-41bf-8a58-a9072865e34b o‘zgarmadi | Kuzatilgan o‘tishlarda yo‘q |
| Tezlik | Route commit median 14.5 ms, p95 nearest-rank 540.8 ms; async data median 42.5 ms, p95 1089.9 ms | Barcha mazmun 10–20 ms bo‘lish talabi bajarilmagan |
| Retention | 12eaa93: matn deadline’da yopildi; 30-word QA recall 72/100, tarix/totals yangilandi | Shu oqim tekshirilgan |
| Retention refresh | Ikkinchi QA recall refresh’dan keyin tiklandi; timer uzaymadi; natija 21/100, reading allocated 0:42 | Recovery va erta transition kuzatilgan; barcha race/back holatlari emas |
| My Progress Open | Ochish → /dashboard haqiqatan bosib tekshirildi | Tekshirilgan |
| Management Retention | 56cda51: bank/inventory/paging ochildi; visual measurement builder va disabled incomplete save ko‘rildi | Ochish/builder PASS; katta bank yaratish/tahrirlash CRUD hali to‘liq live tekshirilmagan |
| TED admin | Link → sarlavha → notes, transcript majburiy emas; ikkita published lesson ko‘rindi | Forma ko‘rildi, create/edit yozuvi bu run’da yuborilmagan |
| TED learner | Fresh ochishda ikkala published standalone video ko‘rindi; QA TED ochildi va notes tugmasi matnni ko‘rsatdi | Dars ochish va notes tekshirilgan; to‘liq playback emas |
| TED tashqi havolalar | Native iframe’da Watch on YouTube, channel/title va Copy link bor | Ownerning tashqi havolasiz pleer talabi HALI bajarilmagan |
| Flashcard | Local fixture’da side/front/back va card boundary tekshirildi | Barcha ekranda 3D motion live acceptance emas |
| 7 games / Use | Kod va UI tests mavjud; barcha file-randomization sikllari barcha qurilmalarda yakunlanmagan | PARTIAL |
| Roles/privacy | Server checks va mavjud testlar saqlangan | Teacher/ikkinchi learner bilan to‘liq Preview QA yo‘q |

Natija kartalari — haqiqiy QA hisobi yozuvlari. Maxfiy parol/keylar bu faylda yo‘q.

## Pullik xizmatlarga tayyorgarlik

Server-only OpenAI Responses baholash va audio transcription adapterlari yozildi; register qilingan, schema/limits/cancellation/privacy testlari bor. Key va model o‘rnatilmasa not_configured; transkriptsiz yoki audio dalilisiz talaffuz bahosi yaratilmaydi. Tashqi xizmatlar default OFF.
Google OAuth kodi bor; kalit va callback sozlanishi hamda QA schema talab qilinadi.
Live signalling server uchun non-root Dockerfile, aniq origin allowlist va service-identity health tekshiruvi tayyor. TURN hozir coturn REST HMAC kontraktini qo‘llaydi. Istalgan vendorning API kalitini shunchaki qo‘yish bilan ishlamaydi — shu kontraktli relay yoki alohida vendor adapter kerak.
Hech qanday pullik xizmat sotib olinmagan; haqiqiy vendor, OAuth va ikki taraf audio sinovlari bajarilmagan.
Ulash bo‘yicha fayl: docs/PAID-SERVICES-ACTIVATION.md.

## Tashqi kalitlardan tashqari qolgan KOD ishlari

1. Listening master §37–44: 9 bo‘limli hub, exam notes/autosave/history, authored segment evidence va real question-ID bo‘yicha partial submission. Mavjud Revision/Keyword/Speed/MCQ’ni qayta ishlatish kerak. Hozirgi butun-test submit partial scope hisoblanmaydi. Timestamp taxmin qilinmasin.
2. Progress trends src/lib/data/progress-trends.ts dagi ROW_CAP=1000: katta activity history jim kesilishi mumkin. SQL aggregates/weighted buckets va 1001+ test kerak.
3. Listening revision “words from this test” hozir wordsFromSource(userId,"listening") bilan moduldagi so‘zlarni oladi; canonical sourceId bo‘yicha cheklash va DB test kerak.
4. Reading barcha partial-submit/evidence/answer leakage holatlari, 7 games, Use, responsive breakpoints va back/refresh — katta master’ning to‘liq ikki-davra acceptance matritsasi yopilmagan.
5. 63 PDF sahifani shu mustaqil run’da to‘liq alohida ko‘zdan kechirish bajarilmagan. Oldingi Arena ko‘rgan degan gap mening proof’im emas.
6. 149493362 va 2721559850 eski digest’lar route/SHA/runtime logs bilan yopilmagan. Yangi Speaking digest ham alohida yopilishi kerak.

## Tashqi operatsion/content gates

- Owner-confirmed QA DB’da haqiqiy backup, journal reconciliation, keyin guard bilan 0025–27. 0021 journal gap’ini schema dalilisiz “applied” deb yozmang.
- 30 PostgreSQL gates — maxsus QA2 DB’da ikki davra, hech bir skipped check’ni pass deb olmang.
- Google consent/state/account linking — haqiqiy configured Preview.
- Live Partner: signal host/TLS/WebSocket + TURN; ikki foydalanuvchi, ikki tarmoq, relay audio va reconnect/end/block/privacy.
- 75 Retention AI drafts — inson tahriri va tasdiqi kerak; hozir bankga import/publish qilinmagan. Preview bank A2=1, qolgan darajalar=0 kuzatildi.
- 880 Speaking draft va 105 Reading source — tasdiqlangan target’da idempotent import va review/publication boundary. Dry-run real import emas.
- Tashqi YouTube havolalarsiz custom pleer uchun foydalanish huquqi bor direct media/captions kerak. Cross-origin native YouTube DOM’ini buzish yoki foydalanuvchi controls’ini to‘liq bloklash yechim emas.

**Bu hisobot “100% tayyor” sertifikati emas. Koddagi ochiq ishlarni faqat API kalitlari yo‘qligi bilan berkitib bo‘lmaydi.**
