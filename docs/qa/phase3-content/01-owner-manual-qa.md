# Egaga topshirilgan manual QA

Bu ishlarni agent bajarmadi. Brauzer, haqiqiy audio/mikrofon, qurilmalar va uzluksiz stability tekshiruvi foydalanuvchi tomonidan bajariladi. Ishlab turgan o‘quvchi urinishlarini o‘chirmasdan, ajratilgan staging/test akkauntlaridan foydalaning.

| Modul | Siz tekshiradigan oqim | Qabul mezoni |
|---|---|---|
| Listening | Katalog → xavfsiz start → 4 part/40 savol → darhol chiqish/resume → submit → original study/review; ikki tab conflict; audio fallback va audio davomiyligi | P3-SEC-01 avtomatik API’da yopilgan. Audio real ijro etiladi; timer/answer/media nav bilan qayta boshlanmaydi; server javoblari tiklanadi. Conflict paytida Server javoblarini olish / Bu qurilma nusxasini saqlash tanlovi ishlaydi. Faol retake’da eski review ham ochilmaydi. |
| Reading | Desktop split; input/MCQ/matching/drag-drop; highlight/scroll; darhol chiqish; ikki tab; submit/review | Yangi javob yo‘qolmaydi; stale tab 409 oladi; focus/selection saqlanadi; 3 passage/40 savol kontrakti saqlanadi. |
| Writing | Task 1 rasm/diagramma; Task 2; word count; autosave; task almashish; finalize va vakolatli review | Grafiklar haqiqiy manba bilan mos; matn qayta ochilganda bor; pending yoki unavailable AI holati soxta band ko‘rsatmaydi. |
| Speaking | Part 1/2/3; Part 2 → bog‘liq Part 3; mic denied/revoked; record/save/reopen; partner leave/reconnect | Yozuv saqlanadi va faqat ruxsatli foydalanuvchiga ochiladi; ishlamagan peer aloqa muvaffaqiyat deb ko‘rsatilmaydi. |
| Video/Podcast | Mavjud video → transcript → resume → notes/vocabulary → completion; missing/restricted media | Transcript manbasi mos; shaxsiy progress/note/folder boshqa akkauntga o‘tmaydi. Podcast banki hozir bo‘sh. |
| Vocabulary | 7 o‘yin; server javobini kutish; save xatosi/retry; duplicate variant; builder Clear; SRS | Tasdiqlanmagan javob Correct bo‘lmaydi; gap to‘g‘ri joyni yashiradi; takror hisob yo‘q; oddiy o‘yin revision sanasini surmaydi. |
| Retention | Read → recall → save → resume → submit → result; Load more/View result | Vaqt va natija server kontraktiga mos; source/history va akkaunt chegarasi saqlanadi. |
| Mock | Owner/teacher yaratish → source tanlash → publish/window/assignment → attempt → upload retry → grade → publish/review/export | Faqat mos 40-savolli Listening va Academic Reading tanlanadi; General/MCQ aralashmaydi; admin private akademik natija ko‘rmaydi. |

Barcha oqimlarni Day/Night, desktop/mobile, keyboard, Chrome va sizdagi Safari/WebKit’da tekshiring. Logout/login va ikki akkaunt almashinuvida javob/cache/recording ajralgan bo‘lsin. Phase 2 uchun final-build cold/warm, haqiqiy offline/reconnect, device/CPU/network va oldindan sizga qoldirilgan uzluksiz stability tekshiruvi ham shu manual qabulga kiradi.

Listening importeridagi 11 eski skip uchun asl embedded-audio `Listening_Test_1.html` fixture kerak. Mavjud repository fayli bu fixture o‘rnini bosa olmaydi. Original 67-qatorli comparison hamda manba huquqlari/answer-key editorial tasdig‘i taqdim etilmagan joylar tekshirilgan deb yozilmadi.
