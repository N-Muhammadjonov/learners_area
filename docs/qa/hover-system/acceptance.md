# Learners Area — hover tizimi

2026-11-10. Ish asosi: `arena/learners-area-next`, `2d38fbdd1270bfda8f77294e548964f2ae2e37f1`.

Mavjud design system kengaytirildi. Yangi hover JavaScript’i, pointer listener, kutish taymeri yoki biznes mantiqi qo‘shilmadi. Kartadagi effekt CSS `:hover`, strelka esa aynan shu elementning `::after` dekoratsiyasi orqali boshqariladi.

| N | Component | Before | After | Changed files | Rapid-hover QA | Visual QA | Status |
|---|---|---|---|---|---|---|---|
| 1 | Interaktiv kartalar | 2 px lift, ichida tugmasi bor har qanday article ham ko‘tarilgan | Aniq navigatsiya kontraktlari, 1.015 scale, −3 px lift, accent border va glow | `modules/shared/design-system.css` | Selector testi va dastlabki Chrome sinovi o‘tdi | Yakuniy tekshiruv foydalanuvchida | Kod tayyor |
| 2 | Primary tugmalar | Lift, brightness 1.08 | Scale 1.02, −1 px lift, brightness 1.06, 90 ms press | Shu CSS | Disabled/busy holatlari o‘tdi | Foydalanuvchida | Kod tayyor |
| 3 | Secondary tugmalar | Qisman hover, aria-disabled cheklovi yetishmagan | Border, yumshoq shadow va lift, selected holatning fill’i saqlanadi | Shu CSS | Disabled va selected kontraktlari o‘tdi | Foydalanuvchida | Kod tayyor |
| 4 | Input, select, textarea | Umumiy focus ring | Hover border/glow va focus border, o‘lcham va joylashuv animatsiyasi yo‘q | Shu CSS | Inputlar transform kontraktiga kirmaydi | Caret, IME va dropdown foydalanuvchida | Kod tayyor |
| 5 | Filter va tabs | Background/color transition | Yengil lift, selected holat saqlanadi, font o‘zgarmaydi | Shu CSS | Selected state testi o‘tdi | Foydalanuvchida | Kod tayyor |
| 6 | Hover strelkalari | Umumiy karta strelkasi yo‘q, ayrim CTA strelkalari doim ochiq | Oldindan ajratilgan joy, 120 ms reveal, 4 px travel, pointer-events none | Shu CSS | Har bir karta alohida, busy spinner bilan aralashmaydi | Foydalanuvchida | Kod tayyor |
| 7 | Pointer ownership | Broad article:hover | CSS holati faqat haqiqiy hover egasida, JS state yo‘q | Shu CSS | 12 kartada 21 yo‘nalishli selector sinovi, 252 holat | To‘liq rapid sweep foydalanuvchida | Kod tayyor |
| 8 | Accessibility | Focus-visible va reduced motion bor | Focus ring saqlandi, keyboard arrow, reduced motion uchun scale/travel/press nolga tushadi | Shu CSS | Focus va reduced-motion kontraktlari o‘tdi | Keyboard va OS reduced motion foydalanuvchida | Kod tayyor |
| 9 | Mobile | Mavjud responsive gridlar | Mouse hover faqat fine pointer’da, 639 px gacha karta scale’i 1 | Shu CSS | Capability query kontrakti o‘tdi | Touch va overflow foydalanuvchida | Kod tayyor |
| 10 | Regression | Mavjud Phase 1/2 va Speaking | Dock, SVG, recorder, exam va game kodi o‘zgarmadi, Speak or Die hub kartasidagi important konflikti olindi | Shu CSS, `modules/speaking/speaking.css` | Frontend va build o‘tdi | Foydalanuvchida | Avtomatik tekshiruv o‘tdi |

Jadvaldagi `modules/` yo‘llari `frontend/vanilla/` ichida. `services/backend/app/data/riwi_site_catalog.json` faylida faqat ikki o‘zgargan CSS manbasining build uchun zarur hash’i yangilandi. Backend funksiyalari o‘zgarmadi.

## Modullar bo‘yicha qamrov

| Modul | Qo‘llaniladigan kontrakt |
|---|---|
| Dashboard | Mavjud `a.card` skill shortcuts, primary/secondary actions. Statistika kartalari qimirlamaydi. |
| Listening | Ochiq Academic katalog kartalari va lesson navigatsiyasi. Focus exam mustaqil qoladi. |
| Reading | Academic katalog, General passage kartalari, lesson va history navigatsiyasi. Answer panellariga karta transform’i berilmaydi. |
| Writing | Lesson kataloglari va native navigation cards, tabs va inputlar. Editor paneli ko‘tarilmaydi. |
| Speaking | Hub, practice part/topic kartalari, mavjud CTA strelkalari. Recorder, robot va danger physics kodi o‘zgarmaydi. |
| Grammar | Lesson katalogi, umumiy tugma va inputlar. |
| Vocabulary | Native navigation/game-library kartalari, gold accent token, filter va inputlar. Flashcard flip mexanikasi o‘zgarmaydi. |
| TED / Podcast | `data-video-lesson-open` havolalari, dekorativ strelka va mavjud controls. Playerga karta transform’i berilmaydi. |
| Assignments | Action va textarea feedback. Javob yoziladigan article ko‘tarilmaydi. |
| Mock Tests | Ishlaydigan start/resume tugmasi bor katalog kartalari. Runner va timer mustaqil qoladi. |
| Live Classes | Action mavjud upcoming kartalari va recording katalogi. Room/player panellari ko‘tarilmaydi. |
| My Progress | Mavjud filter, tab va actionlar. Read-only statistika qimirlamaydi. |
| Study Plan | Mavjud actions, day controls va form inputlar. |
| Management | Native `a.card` navigatsiyasi. |
| Profile | Actions, inputlar va icon controls. Profile form paneliga karta transform’i berilmaydi. |
| Dialog va filters | Mavjud aniq button/input/tab klasslari. Dialog containeriga karta transform’i berilmaydi. |

## Avtomatik QA

- To‘liq frontend to‘plami: 1 470 test, 1 459 passed, 0 failed, 11 skipped.
- Oxirgi busy-arrow tuzatishidan keyin hover va Phase 1 to‘plami: 17 passed, 0 failed, 0 skipped. Bu 17 ta test yuqoridagi to‘plamga kiradi, alohida yangi test soni emas.
- Yangi hover kontraktlari: 8 test. 21 marta yo‘nalishni almashtirishda 12 ta karta, jami 252 selector holati tekshirildi. Bu haqiqiy pointer sweep bilan tenglashtirilmaydi.
- Python native build: 858 fayl, 136 route, muvaffaqiyatli. Test fixture fayllari runtime paketiga kirmaydi.
- `git diff --check`: o‘tdi.

## Brauzer tekshiruvi chegarasi

Foydalanuvchi manual QA’ni o‘zi bajarishini aytganidan keyin brauzer ishlari to‘xtatildi. Ungacha Chrome’da Dashboard kartasi uchun `matrix(1.015, 0, 0, 1.015, 0, -3)` va faqat shu kartada ko‘rinadigan strelka kuzatildi. Alohida fixture’da 12 ta karta ustidan 4 ta to‘liq o‘tish, 79 pointer namunasi, 0 noto‘g‘ri hover egasi, 0 grid DOM mutatsiyasi, hover boshlanganidan keyin 0 layout shift va o‘zgarmagan 15 ta resource qayd etildi.

21 martadan ortiq haqiqiy rapid sweep, barcha sahifalarda day/night ko‘rinishi, before/after screenshotlar, touch, IME, nested controls, focus outline clipping, haqiqiy qo‘shni hitboxlar va click destinations — foydalanuvchining manual QA’sida. Safari/WebKit va Firefox bu ishda ishga tushirilmagan. Ular passed deb belgilanmaydi.

Mentora ZIP va reference screenshotlari bu topshiriqqa biriktirilmagan. Ularning original CSS’i yoki tasviri bilan aniq solishtirish bajarilmadi. Moslashtirish promptdagi mexanizm tavsifi va mavjud native komponentlar asosida qilindi.

## Takrorlash

```bash
npm test
node --test frontend/vanilla/tests/hover-system.test.mjs frontend/vanilla/tests/phase1-design.test.mjs
node scripts/riwi-site-catalog.mjs
python3 scripts/build_native_assets.py
```

Build uchun mavjud loyiha muhitidagi `rcssmin` va `rjsmin` paketlari kerak. Isolated QA fixture: `frontend/vanilla/tests/hover/fixture.html`. Uni mavjud GET-only Phase 1 preview server orqali ochish mumkin. Fixture’da learner ma’lumotlari va backend yozuvlari yo‘q.

Push faqat `arena/learners-area-next` uchun. Main’ga push/merge va production deploy bajarilmaydi.
