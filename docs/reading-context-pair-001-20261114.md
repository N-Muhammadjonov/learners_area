# General Reading: birinchi ikki passage

Foydalanuvchi ko‘radigan sayt tartibidagi birinchi juftlik tekshirildi. Keyingi
juftlik bu bosqich main’ga qo‘shilib, saytga chiqqandan keyin boshlanadi.
Production matni, DOCX tarjimalari, batafsil ma’nolar va SQL payload mahalliy
saqlanadi; ushbu checkpoint faqat jamlangan natijalarni beradi.

| O‘lchov | Oldin | Keyin |
| --- | ---: | ---: |
| Missing word occurrences | 1168 | 0 |
| Empty meanings in existing bindings | 0 | 0 |
| Invalid offsets | 0 | 0 |
| Stored source spans | 635 | 1655 |
| Projected visible source spans | 632 | 1580 |
| Raw nested overlap pairs | 0 | 57 |
| Projected overlap pairs | 0 | 0 |

Uzbek DOCX va har bir inglizcha gap konteksti asosida ma’nolar ko‘rib chiqildi.
Olmoshlar, jumladan aynan shu gapdagi nisbiy olmoshlar POS orqali chiqariladi;
mamlakat qisqartmasi shaxs olmoshi bilan aralashmaydi. Bir iboraning ichidagi
oldingi qisqa occurrence’lar saqlanadi, reader esa eng uzun butun iborani oladi.
Yangi iboralar tufayli 57 ta xom nested juftlik bor; reader’da overlap yo‘q.

1116 ta source-local entry tayyorlandi: 1020 yangi occurrence va 96 ta mavjud
intervalning ma’nosi/POS’i aniqlashtirildi. Barcha 635 eski occurrence ID,
barcha eski lexeme’lar, boshqa passage/Listening occurrence’lari va 179 ta
learner Vocabulary/SRS satri o‘zgarmaganligi production fingerprint bilan
tasdiqlandi. Matn checksum’lari o‘zgarmagan. Yangi source lexeme ishlatiladi,
umumiy yoki foydalanuvchi saqlagan ma’nolar tahrir qilinmaydi.

Tekshiruvlar:

- 29 backend va 13 tegishli frontend test o‘tdi.
- Listening/Reading uchun yana 21 regression test o‘tdi.
- Native build o‘tdi.
- PGlite’da haqiqiy schema/unique index bilan rollback, idempotence,
  ikkinchi passage checksum’i o‘zgarganda juftlikni atomar bekor qilish,
  occurrence ID va learner/shared lexeme saqlanishi o‘tdi.
- Chromium va WebKit: haqiqiy mahalliy ASGI → izolyatsiyalangan PostgreSQL;
  har birida barcha 1580 span ko‘rindi, 14 popup tekshirildi, har bir passage
  nomidagi folder’ga saqlash o‘tdi. Save-flow failures: 0. Bu production
  foydalanuvchi akkauntida bajarilgan browser sinovi emas.
- Production’da rollback sinovi, qo‘llash, takror qo‘llash va to‘liq ikki
  passage’ni qayta o‘qib local audit bilan solishtirish o‘tdi.

Oldingi #192 checkpoint’dagi keng test run’larida main’da ham mavjud bo‘lgan
3 backend va 18 frontend failure qayd etilgan. Ushbu juftlik uchun yuqoridagi
tegishli tekshiruvlar o‘tdi; butun repository testlari yashil degan da’vo yo‘q.
172 passage’ning qolgan qismi hali yakunlanmagan.
