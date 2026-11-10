# O‘quv reja va progress — 49–61

Ish asosi `arena/learners-area-next` branchining `2c0278e054abe1be162233a87be81a149979822f` commiti. Branchning Phase 1 va Phase 2 o‘zgarishlari saqlandi. Mentora PDF’dagi Home, Study Plan, Vocabulary, Progress, Leaderboard va Market sahifalari hamda frontend bundle UI ma’lumotlari ko‘rib chiqildi.

| N | Imkoniyat | Learners Area’dagi manba | O‘zgarish | Tasdiqlangan |
|---|---|---|---|---|
| 49 | Moslashuvchan reja | Onboarding, material kataloglari, Coach | Saqlanadigan 7 kunlik reja, fokus va kunlik vaqt | Maqsad saqlash, qayta ochish, material va vazifa tekshiruvi |
| 50 | Maqsad bandi | Onboarding, to‘liq baholashlar va tekshirilgan natijalar | Umumiy va ko‘nikma bo‘yicha maqsad, haqiqiy baholash tarixi | Yarim band qadami, dalilsiz holat, UI |
| 51 | Imtihon prognozi | Baholash tarixi | Dalilga asoslangan vaqt oralig‘i va ishonch darajasi | Deterministik trend va dalil yetishmasligi uchun unit test |
| 52 | Bugungi reja | Dashboard | Asosiy ekranda vazifalar, band va yakunlanish | Dashboard DTO va DOM, haqiqiy mashqdan keyingi holat |
| 53 | Haftalik kalendar | O‘quv kunlari va topshiriq muddati | Tanlanadigan kunlar, ko‘chirish va yuklama cheklovi | Ko‘chirish, muddati bor vazifaning ustuvorligi, yil chegarasi |
| 54 | Tavsiyalar | Coach va Reading javoblari | Savol turiga mos ochiq materialni tanlash | Matching Headings uchun mavjud mashq tanlandi |
| 55 | Progress | My Progress, tekshirilgan natijalar | Band tarixi, davr va ko‘nikma filtrlari | DOM va maxfiy API javobi |
| 56 | Ball, yulduz va streak | Tasdiqlangan o‘quv yozuvlari | Server hisobi, kunlik yulduz, takroriy ballni bloklash | Qayta yuborish, ikkinchi sessiya, streak chegarasi |
| 57 | Reyting | Tasdiqlangan ball va o‘qituvchi bog‘lanishlari | Ixtiyoriy qatnashish, taxallus, filtrlar va sahifalash | Opt-in, opt-out va ko‘rinadigan maydonlar |
| 58 | Mukofotlar | Ball jurnali | Narxi serverda belgilangan doimiy virtual bezaklar | Yetarli balans, takroriy xarid, salbiy balansni bloklash |
| 59 | Lug‘at statistikasi | Vocabulary SRS | Mastery bosqichlari, takror soni va eslash aniqligi | Oddiy SRS endpointi bilan boshidan oxirigacha API sinovi |
| 60 | Zaiflikni kuzatish | Coach va tekshirilgan Reading | Savol turi bo‘yicha tarix va yaxshilanish | Reading natija → tavsiya → mashq → progress |
| 61 | Haftalik xulosani ulashish | Reja | Nusxalash, 7 kunlik havola, bekor qilish | Rozilik, anonim ochish, bekor qilish, maxfiy maydonlar |

## Kod

- `services/backend/app/study_plan_{rules,evidence,store,port}.py` — qoidalar, server dalili, saqlash va API.
- `services/backend/app/step21_reading_port.py` — mavjud tekshiruvdan savol turi bo‘yicha aggregate dalil.
- `frontend/vanilla/modules/study-plan/` — kalendar, analitika, reyting, mukofot va ulashish.
- `frontend/vanilla/modules/dashboard.js`, `frontend/vanilla/modules/progress/page.js` — mavjud sahifalarga integratsiya.
- `services/backend/tests/study_plan_postgres_probe.py` va `frontend/vanilla/tests/study-plan.test.mjs` — takrorlanadigan sinovlar.

## Baza va xavfsizlik

`0080_study_plan.sql` Drizzle va FastAPI migratsiya nusxalarida bir xil. U yettita yangi jadval qo‘shadi. Migratsiya mavjud jadvallar va tarixiy natijalarni o‘zgartirmaydi. Alohida PostgreSQL test bazasiga barcha 81 migratsiya qo‘llandi.

Student API o‘z sessiyasi bo‘yicha ishlaydi. Reyting boshqa qatnashchilarga taxallus, ball va o‘rinni chiqaradi. Ulashish havolasi tasodifiy token xeshini saqlaydi. Egasi uni bekor qilishi mumkin. U faqat sana, vazifa soni va rejalangan daqiqalarni ko‘rsatadi. Bezak almashtirish yakuniy va hisob bo‘yicha tranzaksiya ichida bloklanadi.

Orqaga qaytish uchun dastur commitini revert qilish mumkin. Yangi jadvallarni saqlash o‘quv rejalari, xaridlar va tarixni tiklashga imkon beradi. Production bazasiga migratsiya qo‘llanmagan.

## QA chegarasi

- Yangi PostgreSQL va ASGI sinovi 51 ta tekshiruvdan o‘tdi. Bugungi rejaning qayta ochilishi fixture bazasida 10 ta SQL amali bilan ishladi.
- Frontend regressiya to‘plamida 1 410 ta test o‘tdi, 11 tasi skip.
- Backend to‘plamida 5 941 ta test o‘tdi. Ikki Live Classes TCP testi mahalliy port ochish ruxsati tufayli to‘xtadi. Uchta test PDF kutubxonasi yoki to‘liq Git checkout talab qildi.
- Mavjud integratsiya to‘plamidagi teacher, admin va owner Dashboard uchun uchta Management havolasi assertioni boshlang‘ich commitda ham takrorlandi.
- Brauzer muhiti mahalliy sinov portini va fayl URL’ini blokladi. Real brauzerda to‘liq ssenariy, o‘lchamlar, day/night va skrinshotlar tasdiqlanmagan. Release acceptance ochiq.

## Ixtiyoriy 30 kunlik reja

7 kunlik reja asosiy ko‘rinish bo‘lib qoladi. O‘quvchi 30 kunlik variantni tanlab, Listening, Reading, Writing va Grammar mini-testini bajaradi. Obyektiv savollar serverda tekshiriladi. Writing bo‘limidagi qisqa namunaning uzunligi va jumla soni mashq yo‘nalishini tanlashga yordam beradi. Mini-test rasmiy IELTS bandini hisoblamaydi.

Kalendar 30 kunni, tanlangan o‘qish kunlarini va kunlik vaqtni qamrab oladi. Xato ko‘p bo‘lgan mavzular ko‘proq takrorlanadi. Kundalik yangilash oldingi kunlarni saqlaydi va kelgusi mashqlarni serverda qayd etilgan faoliyatga moslaydi. Ko‘rsatma har bir vazifani mavjud Learning moduliga bog‘laydi.

Listening uchun mos va ochiq qisqa General yozuvi ishlatiladi. Zaxira audio repo ichidagi CC BY 4.0 litsenziyali Google FLEURS yozuvidir. Manba va yozuv haqida ma’lumot `frontend/vanilla/js/vendor/riwi-speech/qa/README.md` faylida.

`0081_monthly_study_plan.sql` shaxsiy test va kalendar holati uchun alohida jadval yaratadi. Javob kalitlari brauzerga uzatilmaydi. Erkin Writing javobining matni bazada saqlanmaydi.
