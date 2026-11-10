# Speak or Die — egaga topshirilgan manual QA

Canonical route: `/app/speaking/speak-or-die`. Agent haqiqiy browser, mikrofon, audio yoki qurilma tekshiruvini bajarmadi. Quyidagi qabul va screenshotlar egaga topshirildi. DOM va synthetic signal testlari bu tekshiruvlarning o‘rniga yozilmagan.

1. Speaking hub: Speak or Die kartasi, qolgan uch karta, purple CTA. Hub va Practice intro’da robot yo‘q. Practice heading/card/microphone, Part 1/2/3 va Situations o‘zgarmagan.
2. Idle screenshot: Intermediate tanlangan; mikrofon ruxsati hali so‘ralmagan, browser mic indikatori o‘chiq.
3. Beginner va Advanced tanlangan holatlarning alohida screenshotlari. Tab, Space/Enter, arrow, Home/End bilan difficulty tanlang. Focus ko‘rinsin.
4. Start → permission → 1.2 soniya jim calibration → savol → 60 soniya. Mikrofon ruxsatini rad etish, device yo‘qligi va permissionni javobsiz qoldirish holatlarini tekshiring. Kutish paytida Quit ishlasin.
5. Running silence screenshot: disk chapdan o‘ngga yaqinlashsin. Beginner, Intermediate va Advanced amalda turli tezlik/grace bilan ishlasin.
6. Running speech screenshot: waveform real ovozga mos o‘zgarsin, disk oldinga yurishdan to‘xtasin va orqaga qaytmasin. Ventilyator, klaviatura, jim xona va turli mikrofon sezgirligini tekshiring. Bu semantic speech recognition emas.
7. Near collision screenshot: qizil glow, robot ifodasi va status ko‘rinsin. Miltillash bo‘lmasin. Arena oynasi o‘zgarganda normalized collision saqlansin.
8. Lost screenshot: actual survived seconds, savol, Play again va Change level. Mikrofon indikatori o‘chsin. Yana o‘ynash yangi savol, yangi input va shu difficulty bilan boshlansin.
9. Won screenshot: 60/60, band/coin/reward ko‘rsatilmasin. Yozuv yoki transcription yaratilmasin. Mikrofon indikatori o‘chsin.
10. Quit, Change level, browser Back/Forward, reload va boshqa route’ga ketish. Oldingi audio context, stream, RAF yoki timer qolmasin. Reload idle’dan boshlansin.
11. Boshqa tab/oynaga o‘ting yoki qurilmani mute/disconnect qiling. Vaqt va xavf pauzada oshmasin. Qaytishda faqat explicit Resume bilan yangi input ochilsin. Safari audio interruption’dan ham Resume orqali tiklansin.
12. Desktop Chrome/Safari, 360/390 px mobile va tablet. Day/Night, reduced motion, keyboard va Dock/Back ishlashi. Horizontal overflow, actorlarning boshlanishda ustma-ust tushishi yoki matn kesilishi bo‘lmasin.

Tarmoq panelida game faqat authorized Speaking question GET ishlatsin. Speaking attempts, upload, transcription, AI grading yoki reward POST yuborilmasin. Eski `/app/speaking/ai`, Speaking History, saqlangan yozuvlar, Lessons va Live Partner’ni alohida regressiya sifatida oching.

Talab qilingan 10 screenshotning hech biri agent tomonidan yaratilgani yoki PASS bo‘lgani da’vo qilinmaydi. Mentora ZIP va to‘rtta alohida reference screenshot bu sessiyada topilmadi. Mavjud PDF 25–26-sahifalari intro kompozitsiyasi uchun ko‘rildi. O‘yin parametrlarining asl Mentora qiymatlari tasdiqlanmagan.
