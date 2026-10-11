# RIWI 20–25 natijalari tekshiruvi

Joriy kod: `1a6f751f17f59caf54074c7ba9932b7e1a2893157ec3b4170a495626d2dc01ac` (1256 kanonik fayl). GitHubdagi oxirgi tekshirilgan commit: `c538704f92937d142feb056d22542d9a905f0852`. Bu yangi tuzatishlar hali push qilinmagan.

ZIPdagi 51 faylning hajmi va SHA256 tekshirildi. Eski 5203241 bazasining 1248 fayli Git obyektlari bilan solishtirildi; 1251 faylli tashqi yakuniy manifest va ikkala sinov jurnali tekshirildi. Tashqi natija har bosqichda 1480 backend va 261 UI muvaffaqiyatini bildiradi, ammo boshqa kod holatiga tegishli. U joriy kod sinovi deb yozilmadi.

Qo‘lda yozilgan va manbasi noma’lum transkriptlar uchun soxta nutq tezligi hamda vaqtga asoslangan ishonch qo‘shimchasi olib tashlandi. Tahrirlangan STT matni uchun audio vaqti baholashga berilmaydi; tahrirlanganlik serverda raw/reviewed matndan aniqlanadi. Asl matn, audio davomiyligi, SHA va baholash metama’lumotlari saqlanadi.

Yangi parallel retention-planner o‘rnida oldingi qat’iy, bitta read-only/repeatable-read snapshot yechimi ishlatiladi. Unda faol recording va bevosita yoki session-item orqali bog‘langan faol sessiyalar audio, ikkala transkript va baholashni himoyalaydi. Boshqa egaga tegishli session aloqasi rad etiladi. Muddatlar taklif bo‘lib qoladi; avtomatik o‘chirish yoqilmagan.

Chatda localStorage o‘qish/yozish rad etilishi qabul qilingan javobni yo‘qotmaydi. Komponentdan chiqish so‘rovni bekor qiladi va kech kelgan eski javob suhbat kalitini qayta yozolmaydi. Uchta xato avval sinovda takrorlandi. Dastlabki 14/14 chat va 39/39 tegishli backend sinovlari tarixiy fokus sinovi; C08 audio hajmi qo‘shilgandan keyingi yakuniy kod ikki to‘liq native bosqichda qayta tekshirildi.

| Guruh | Holat | To‘liq yopish uchun qolgan dalil |
| --- | --- | --- |
| 20 / C05 | PARTIAL | Haqiqiy mikrofon/STT, timeout/retry va tozalashning browser yo‘llari |
| 21 / C06 | PARTIAL | Haqiqiy R2 URL muddati tugashi va yopiq audio baytlarini qayta o‘qish |
| 22 / C07 | PARTIAL | Browser yo‘llari va learning-signal uchun qayd etilgan rozilik siyosati |
| 23 / C08 | PARTIAL | Aniq owner saqlash siyosati va unga mos tashqi o‘chirish dalili |
| 24 / C09 | PARTIAL | Ko‘rinib turgan to‘liq UI holatlari, denial/failure yo‘llari va qurilma tekshiruvi |
| 25 / D01 | CLOSED (avvaldan) | Yangi kredit berilmaydi; regressiya tekshiruvi saqlanadi |

12 ta tashqi gate skrinshotidan tekshirilganlari faqat Speaking/loading qobig‘ini ko‘rsatadi. Yashirin DOM elementining mavjudligi va bo‘sh sahifada overflow yo‘qligi tayyor mikrofon UI dalili emas. Denial sinovi muvaffaqiyatsiz; recording SHA faqat regex bilan tekshirilgan, haqiqiy baytlarni qayta o‘qish isboti emas. Cluster shutdown/identity papkasi ZIPda bo‘sh.

Yopilgan guruhlar soni: 20/34 = 58.823529%. RIWI va butun sayt uchun to‘liq hisoblangan denominator yo‘q; umumiy foiz noma’lum. Learners Area qayta qurilmadi. Ishlab turgan baza, tashqi storage, Git tarixi va asl inputlar o‘zgartirilmadi. Production build bajarilmadi.

Joriy kodning bitta QA kampaniyasi ikki mustaqil yangi shaxsiy native PostgreSQL clusterida yakunlandi: har bosqichda 1491/1491 backend va 265/265 UI, 0 fail/skip/cancel/todo, typecheck/lint exit0, 53 R06 hamda 13 R04 HTTP tekshiruvi. 30 raw jurnal SHA256 orqali mustaqil qayta tekshirildi; ikkala cluster yopildi, vaqtinchalik parollar olib tashlandi. Asl ikki input va 1256 kanonik faylning hash qiymati o‘zgarmadi. Dalil: `docs/evidence/riwi-groups-20-25-review/final-native/verification.json`. Oldingi 06515940 kampaniyasi tarixiy dalil sifatida saqlanadi.

Chrome’da yangi shaxsiy bazada teacher → admin → owner → student odatiy login/logout, tegishli RIWI doiralari va owner boshqaruv paneli tekshirildi. Owner Back/Forward ishladi; student boshqa rol vakolatini ko‘rsatmadi. Birinchi browser bazasida RIWI mahalliy unknown-term javobi, suhbatning navigatsiyadan keyin tiklanishi va UZ mikrofon gate’ining haqiqiy ko‘rinishi tekshirildi. Bu tekshiruv haqiqiy mikrofon yoki tashqi AI/R2 qabul sinovi emas. Birinchi 20 daqiqali hold muddati tugashi alohida incomplete dalil sifatida saqlandi; ikkinchi sessiya ongli yakunlandi, 53 HTTP tekshiruvi va private app/DB/cluster tozalash dalili qayta tekshirildi. `chrome-observations.json` to‘liq operational acceptance false deb qayd etadi.

Til triage: QA profil EN, request cookie UZ bo‘lganda RIWI profil tilini, umumiy shell request tilini ko‘rsatmoqda. Mavjud kodning ushbu precedence siyosati saqlangan; to‘liq language-switch matrix o‘tgan deb yozilmadi.

Keyingi davomda R07 mahalliy native fizik PITR ham yakunlandi:115jadval/181FK,5oldingi–3keyingi canary boundary,tiklanganapp200/200/401,shutdown va mustaqil backup/WALhash tekshiruvi. `RIWI-R07-CURRENT-LOCAL-PITR-UZ.md` va `r07-native-physical-pitr/verification.json` ga qarang. Actual provider restore va ownerRPO/RTO tanlovi qolgan; yangi fullgroupclosure berilmadi.
