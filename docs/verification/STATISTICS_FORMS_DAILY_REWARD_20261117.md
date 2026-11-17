# Statistika, formalar va kunlik mukofot auditi — 2026-11-17

## Topilgan sabablar va tuzatishlar

| Muammo | Sabab | Tuzatish |
| --- | --- | --- |
| Statistika kartasidan bo‘lim ochilmaydi | Kartalar mavjud bo‘lmagan `result-history` yakoriga olib borgan. Tanlangan modulning alohida natijalar jadvali bo‘lmagan. | Owner uchun faqat o‘quvchilarning haqiqiy yozuvlari, 25 tadan sahifalash, o‘quvchi profiliga modulni saqlaydigan havola. |
| Profil ichidagi o‘quv natijalari yuklanmay qoladi | `queueMicrotask` sahifa hali router staging daraxtida turganda `isConnected` sabab yuklashni to‘xtatgan. | Yuklash va kech kelgan javob himoyasi route AbortSignal va so‘rov raqamiga bog‘landi. |
| Statistika havolasidan keyin bo‘lim ko‘rinmaydi | `pushState`dan keyin yangi yoki kech yuklangan DOM yakoriga o‘tish bajarilmagan. | Router joriy sahifadagi yakorni ko‘rsatadi va unga fokus beradi. Kuzatuvchi marshrut tugashi bilan tozalanadi. |
| Moliya va boshqaruv maydonlari sezilmaydi yoki siqiladi | `campus.css` barcha search input chegarasini `!important` bilan olib tashlagan va sirtni karta foniga tenglashtirgan. Flex ichidagi label uchun kenglik bazasi ham yo‘q. | Staff maydonlari uchun kuchliroq, tor doiradagi fon/chegara/fokus qoidalari, 44px balandlik, 14rem flex bazasi, tor ekranda qator ko‘chishi. |
| Kunlik coin oynasi chiqmaydi | Workspace claim POST yuborgan, ammo javobni ko‘rsatmagan. | Server tasdiqlagan 7 kunlik oyna, balans, ertangi mukofot va tegishli sahifa havolalari. Hisob + server sanasi bo‘yicha bir marta ko‘rsatiladi. |
| Landing natijasidan so‘ng profil darajasi vaqtincha bo‘sh | Fon importi va profil GET so‘rovi parallel bajarilgan. Davom etayotgan in-app test javobida `currentLevel` bo‘lmagan. | Profil mavjud importni kutadi. Davom etayotgan test DTOsi saqlangan darajani ham qaytaradi. |

## Daraja testining mavjud ulanishi

Landing `raw_answers`ni qurilmada saqlaydi. Hisobga kirilgach `/api/study-plan/monthly/sequence/level/landing/import` serverdagi savollar bazasi bilan qayta baholaydi. Natija `onboarding_profiles.current_level`ga yoziladi. Mijoz yuborgan `level` ishonchli baho sifatida ishlatilmaydi. Avval qo‘lda tanlangan yoki ichki test bilan tasdiqlangan daraja avtomatik almashtirilmaydi. Import bir hisobga bir marta qabul qilinadi va 24 soatlik muddatga ega.

To‘g‘ridan-to‘g‘ri “Tanga yig‘ish” sahifasida kunlik mukofot va balans ham claim javobining yagona server holatidan olinadi. Oldingi balans bilan yangi mukofot aralashib ko‘rsatilmaydi.

## Kunlik oyna chegaralari

Coin berishning mavjud tranzaksiyali server qoidalari saqlanadi. Oyna yangi coin yozuvini mijozda yaratmaydi. Tashkent yarim tunidan o‘tib ochiq qolgan tab ham keyingi kunni tekshiradi. Fokus imtihoni yoki boshqa dialog paytida oyna keyingi oddiy sahifagacha kutadi. Hisob almashishi va sessiya tugashi kechikkan javobning oynasini bekor qiladi. Storage ishlamasa, shu sessiyaning xotirasi takroriy ko‘rsatishni to‘xtatadi. Tarmoq xatosidan keyin qayta tekshirish mumkin.

## Bajarilgan tekshiruvlar

- Frontend: 1 847 passed, 11 mavjud tashqi fixture skip, 0 fail.
- PostgreSQL bilan yo‘naltirilgan backend tekshiruvlari: 82 passed, 0 fail. Haqiqiy migratsiyalar qo‘llangan vaqtinchalik bazada guruh/teacher/student, admissions, learning, self-service payment va yangi statistika/daraja oqimlari.
- Yangi regressiyalar: stagingdagi natijalar, modul kartalari, kech DOM yakori, import/GET ketma-ketligi, yetti kunlik oyna, hisob/sana izolyatsiyasi, boshqa dialog va fokus imtihoni, transport/abort, Tashkent yarim tuni va 7→1 davr.
- TypeScript tekshiruvi va Python native asset build muvaffaqiyatli.
- Migratsiya kontraktlari o‘tdi. Ushbu tuzatish DB sxemasini o‘zgartirmaydi.
- CI browser dalillari 390/1440 px, kunduz/tun, besh rol uchun olinadi. Oyna ko‘rinishi, shu kuni reload bilan qayta chiqmasligi, maydon o‘lchamlari, mavjud chegara, karta sirtidan farqli fon va statistika kartasidan o‘tish tekshiriladi. Birinchi CI ekranlari eski `!important` ustunligini aniqlash uchun ko‘rib chiqildi, yakuniy tekshiruv shu holatni alohida rad etadi. Natijalar CI artefaktida saqlanadi.

## Haqiqiy sayt bo‘yicha bajarilmagan qism

Ushbu sessiya brauzer inventarida Safari va oldindan kirilgan owner oynasi yo‘q. Faqat bo‘sh Chrome mavjud. Shuning uchun Safari owner sessiyasida haqiqiy saytda guruh yaratish, o‘quvchi berish va test foydalanuvchilarini import qilish bajarilgan deb ko‘rsatilmaydi. Productionga sun’iy moliyaviy yozuv yoki yangi owner sessiyasi kiritilmadi. Avtomatlashtirilgan izolyatsiyalangan sinov production browser QA bilan tenglashtirilmaydi.

PRning CI va production release holati PR tavsifida yakuniy commit bo‘yicha qayd etiladi.
