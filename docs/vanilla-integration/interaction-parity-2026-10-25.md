# Main bilan boshqaruv va ish oqimi auditi — 2026-10-25

Target: `arena/learners-area-next`. Mustaqil Main reference: `b62b78f469e4f73aa80f441f630b012dc422af39`.
O‘zgarishlar `ad6b0a51d11b401e60f0d8647cf338e50d6a2d1a` ustiga qo‘shiladi. Main bilan merge qilinmaydi.

## Bo‘limlar qanday ishlaydi va nimalar tuzatildi

| Bo‘lim | Ish oqimi |
| --- | --- |
| Vocabulary kutubxonasi | So‘z/manba statistikasi, mastery/due/weak filtrlari, bitta yoki ko‘p so‘z qo‘shish, packlar, papka yaratish va tanlangan so‘zlarni ko‘chirish, sahifalash va so‘z tafsilotlari. Kech kelgan metadata javobi draftni o‘chirmaydi yoki davom etayotgan yozishni takrorlamaydi. |
| Dictionary | EN/UZ qidiruv, klaviaturada tanlash, oxirgi qidiruvlar, so‘z turkumi, talaffuz, shakllar, alohida ma’nolar, tarjimalar, misollar, collocation, bog‘liq so‘zlar va attribution. Add aynan tanlangan ma’noni mavjud/yangi papka oynasi orqali saqlaydi. Owner amallari learner oynasida berilmaydi. |
| SRS Revision | Server due navbati → javobni ochish → recalled/missed → stage/interval/keyingi sana → yakuniy natija. Xatoda ayni karta qoladi. Ketma-ket kartadagi bloklangan tugma tuzatildi. Rasmiy SRS faqat review API orqali o‘zgaradi. |
| Flashcards | Barqaror ikki yuzli DOM, karta/klaviatura bilan aylantirish, talaffuz, yon navbat, Known/Not yet, animatsiya kutish, Not yet yoki hammasini qayta ishlash. O‘zini baholashdan ball berilmaydi. |
| Multiple choice | Variant tanlash, to‘g‘ri/noto‘g‘ri ko‘rinish, bitta yuborish, Next yoki vaqtli avtomatik o‘tish. Eski taymer keyingi kartani o‘tkazib yubormaydi. |
| Matching | Chap/o‘ng juftlik, xatodan keyin qayta tanlash, tugallash va qayta boshlash. |
| Gap | Namunadagi so‘z joyini yashirish, hint, muqobil yozilishlar, tekshirish va keyingi savol. |
| Translation game | Xatoda misol va qayta urinish, to‘g‘ri javobda muqobil javoblarni ko‘rsatish. Qayta urinishda eski o‘tish taymeri bekor qilinadi. |
| Sentence builder | Takrorlangan so‘zlar alohida tile bo‘lib qoladi. Tanlash, bekor qilish, tozalash, yig‘ilgan gapni serverda tekshirish. |
| Typing race | Taymer haqiqiy matn kiritishdan boshlanadi. Harf animatsiyasi, server tasdiqlagan natija, skip/unverified farqi va item/raund statistikasi. |
| Use in a sentence | Papka, avtomatik so‘z aylanishi yoki tanlangan so‘zda qolish, RIWI tekshiruvi, manual/tekshirilgan gaplar farqi va tarix. So‘rov xatosida so‘z va yozilgan matn qoladi. |
| Vocabulary board | Ball, streak, rank, sinf ro‘yxati va award tarixi. Compact ham reytingni ko‘rsatadi. Award xatosida faqat shu tarixni qayta yuklash mumkin. |
| Writing Lessons | Mavjud darslar, batafsil matn va mark done server amali. |
| Writing Exam | Task 1/2/Full, resume, Full task almashtirish, taymer, har task drafti, revision asosidagi autosave, lokal zaxira, retry, leave/submit va natija. Bitta taskda ortiqcha task tugmasi olib tashlandi. Biriktirilgan materiallar endi ruxsatli read model orqali chiqadi. |
| Writing Translation | Random/topic kartalari va izohlari, barcha 5 question type va 6/7/8 band, mavjud bo‘lmagan filtrlarning disabled holati, to‘plam/gaplar soni, server boshqaradigan tarjima va natija. |
| Writing Typing | Presetlar, server imzolagan text/run, haqiqiy satrlarga ajratish, faol harf ichidagi caret, faqat o‘zgargan so‘zni yangilash, Full pause/resume, grafik, natija va run tarixi. |
| Topic Vocabulary | Mavzu/task/function, words/collocations/phrases/frames, namuna gaplar, canonical vocabulary save, pattern bank toggle va Activation manzillari. Saved so‘z uchun qayta yozish tugmasi qolmaydi. |
| Grade My Work | Task 1/2, o‘z savoli yoki published Task 1 va uning materiali, lokal draft, so‘z sanog‘i, bir draftga bir idempotency key. Server saqlagan failed/pending natijaga ham o‘tish mumkin. |
| Activation | Own/random, writing/speaking, invent/Uzbek/upgrade, target level, instant/summary. How-to/progress paneli, per-item mezonlar, yaxshilangan gap, fixes va usage holati tiklandi. |
| Language Stealing | Source → brainstorm → draft → analyse → compare → memorise → kechiktirilgan rewrite. Server yashirgan matn ochilmaydi. Pattern practice yangi mavzu, copy guard, mezonlar va server ruxsat berganda Save ko‘rsatadi. |
| Speaking | Part → Topic → Questions URL yo‘li, bounded sahifalash, tanlangan savol study support’i, yozuvni saqlash/yuborish va tarix. AI mode/retry/progress/recorder oqimlari saqlanadi. Mikrofon bosilmaguncha permission so‘ralmaydi. |
| Reading | Main Academic passage/questions joylashuvi, mobil panel, passage almashuvi, savol turlari, highlight, taymer, autosave, submit/natija. Matn terilganda passage DOM va caret saqlanadi. |
| Listening | Academic va General exam boshqaruvlari Main bilan solishtirildi. Audio, draft, section, submit va natija server shartnomalarida qoladi. Imtihonda yordamchi javoblar ochilmaydi. |
| Qolgan modullar | Grammar Correct It/Translate/Activate boshqaruvlari Main bilan solishtirildi. Dashboard, Progress, Mocks, Assignments, AI Coach, Courses, TED/Podcast, Live Classes va staff/admin/owner oynalari umumiy native testlar va real ASGI read-model gate bilan tekshirildi. Bu barcha event kombinatsiyalari/piksel isboti emas. |

## Navigatsiya

History API va saqlanadigan sahifa qobig‘i ishlatiladi. Statik URLlar Map, dinamik URLlar oldindan tayyorlangan regex orqali topiladi. go{id} nomining o‘zi tezlik bermaydi. Map eski native ketma-ket regex qidiruvini qisqartiradi.

Hover/focus/pointerdown bo‘yicha cheklangan code/data prewarm ishlaydi. Writing tab kodi ham oldindan import qilinadi. Oddiy kataloglar uchun identity/generation/revision bilan chegaralangan 15 soniyali xotira bor. Imtihon, due navbati, game raundi, javoblar va staff holati keshlanmaydi. Mutatsiya boshida ham, oxirida ham kesh bekor qilinadi.

Controlled benchmark, 32 o‘lchov: {"p50": 6.17, "p95": 17.71, "max": 19.9} ms. Native router/DOM va haqiqiy ASGI JSON xotiradan berilgan JSDOM sinovi. Tarmoq, DB, serverless cold start va browser paint kiritilmagan. Barcha sahifalar internetda 10–100 ms ochiladi degan kafolat berilmaydi.

Tanlov manbalari: [MDN History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API), [web.dev prefetch](https://web.dev/articles/link-prefetch), [FastAPI async](https://fastapi.tiangolo.com/async/). Bu loyiha uchun mexanizm va o‘lchov asosidagi tanlov, universal eng tez framework da’vosi emas.

## Sessiya

Login/boshlang‘ich presentation identity’ni oladi. Sog‘lom event ulanishida ichki navigatsiya auth/state so‘rovini yubormaydi. Himoyalangan data/mutatsiya serverda tekshiriladi. Bir HTTP so‘rovi ichidagi takroriy identity o‘qishlar birlashadi, boshqa HTTP so‘rovlari orasida keshlanmaydi.

PostgreSQL NOTIFY → SSE faqat o‘zgargan user ID’ga signal beradi. LISTEN qaytganda durable auth version va revocation holati tekshiriladi, o‘zgarmaganlar uyg‘otilmaydi. Offline odam qayta ulanganda eskirgan sessiyasi aniqlanadi. Yangi login eski qurilmaning kuzatilgan version’ini almashtirmaydi. Rol o‘zgarishi Main token siyosatiga ko‘ra sessiyani bekor qilsa, qayta login kerak bo‘ladi.

LISTEN tayyor bo‘lgach bir martalik yangi identity tekshiruvi subscription oralig‘idagi poygani yopadi. Dastlab ready keladi. Keepalive DB’ni qayta o‘qimaydi. Transport gap/reconnect, unavailable event xizmati, expiry va 401 tiklanishlari saqlangan. [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Dalillar

- Frontend: 981 pass, oldindan mavjud 11 skip. Backend: 2 569 pass.
- Main HTTP: 2 120/2 120 javob. Workflow: 119/119 javob va 29/29 holat. Farq 0.
- Main reference 684 fayl checksum’i tekshiriladi. Render qilingan 43 holatda control tartibi, accessible nom, klass va disabled holati farqi 0. Bunga bosishdan keyingi holatlar ham kiradi.
- Real ASGI + alohida embedded PostgreSQL: 66 migration, 126 table, 333 HTTP check, 148 decoder check, 120 native DOM mount. Yettita game server bilan bajarilib, SRS o‘zgarmasligi tekshirildi. Faqat review SRS’ni o‘zgartirdi. Prompt materiallari va tarjima gaplar soni SQL’dan tekshirildi.
- Test bazasida faol Dictionary release yo‘q, recent 409 unavailable holati alohida tekshirildi. Sog‘lom entry/folder/save oqimlari transport fixture testlarida tekshirilgan. Production Dictionary worker/R2 ulanishi bundan isbotlanmaydi.
- Production build Python stdlib bilan ishlaydi. Runtime assetlarda Next/React/Node importi yo‘q. Taqqoslash testi mustaqil Main paketlaridan foydalanadi, ular deploy qilinmaydi.
- Yangi Chrome/Safari screenshot/piksel sertifikatsiyasi bajarilmagan. Haqiqiy mikrofon, WebRTC, production AI/R2/login fixture’dan alohida. Standalone Live Partner signal host’i ushbu Git branch push’i bilan deploy qilinmaydi.

Reproduksiya: scripts/compare-main-interactions.mjs, scripts/benchmark-native-navigation.mjs, scripts/run-main-parity.mjs, scripts/verify-vanilla-fastapi.mjs va frontend/vanilla/tests/*v70.test.mjs.
