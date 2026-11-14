# General Reading kontekst lug‘ati bo‘yicha tekshirilgan bosqich

Bu bosqich matndagi noto‘g‘ri bog‘lanishlar va renderer muammolarini tuzatadi. Barcha 172 passage’dagi barcha so‘zlarning kontekstual tarjimasi hali tugallanmagan. Foydalanuvchi tayyor bosqichni main’ga chiqarib, qolgan ishni davom ettirishni alohida so‘radi.

## Aniq qamrov

Audit `reading_passages`dagi faol, test/passage raqamli 172 matnni oldi. Hisob birligi — inglizcha so‘zning matndagi o‘rni. Olmoshlar istisno qilindi; uzun ibora ichidagi so‘zlar shu ibora bilan qamralgan hisoblanadi.

| Ko‘rsatkich | Oldin | Tuzatishdan keyin |
|---|---:|---:|
| Raqamlangan faol passage | 172 | 172 |
| Ulanmagan so‘z o‘rinlari | 115312 | 115213 |
| Mavjud bog‘lanishdagi bo‘sh EN/UZ ma’no | 0 | 0 |
| Noto‘g‘ri offset, 172 matnda | 82 | 0 |
| Noto‘g‘ri offset, barcha 179 matnda | 85 | 0 |
| Xom ustma-ust juftliklar, barcha matnda | 55 | 37 |
| General Reading DTO’dagi ustma-ust span | — | 0 |
| Saqlash xatosi, ajratilgan HTTP/browser testi | Tekshirilmagan | 0 |

Bo‘sh ma’no 0 ta degani barcha so‘zlar tarjima qilingan degani emas. 115213 o‘rinda hali passage’ga biriktirilgan ma’no yetishmaydi. Mavjud lexeme’larning eski verification_status qiymati ham mustaqil lingvistik tekshiruv o‘rnini bosmaydi.

105 ta o‘zbekcha tarjimali DOCX topildi; undagi barcha 105 inglizcha sarlavha production passage’lariga mos tushdi. Hujjat SHA256’i va har bir passage’ning boshlang‘ich qamrovi foydalanuvchining mahalliy audit hisobotida saqlandi. Bu moslashtirish barcha tarjimalar so‘zma-so‘z qayta tekshirildi degani emas. Qolgan 67 passage va yetishmayotgan ma’nolar alohida kontekst tekshiruvini talab qiladi.

## Asl sabab va tuzatish

85 noto‘g‘ri offset’da paragraf ichidagi o‘rin butun passage o‘rni sifatida yozilgan yoki olib tashlangan `A ` kabi yorliq ikki belgi siljish keltirib chiqargan. Tuzatishlar asl matn, source sentence va paragrafdagi aniq o‘rin bilan dalillandi. `non-identical` ichidagi `identical twins` noto‘g‘ri bog‘lanishi manfiy sifatning kontekstga mos yangi ma’nosiga yo‘naltirildi; mavjud to‘liq `non-identical twins` iborasi saqlandi.

Source body SHA256’i va occurrence’ning eski ID/offset/surface/lexeme qiymatlari tekshiriladi. Eski qiymat kutilganidan farq qilsa tranzaksiya to‘xtaydi. Takroriy qo‘llash o‘zgarish keltirmaydi. Mavjud occurrence ID’lari, lexeme’lar, barcha learner Vocabulary/SRS satrlari saqlandi; bir dona yangi source meaning qo‘shildi. Production’da 26103 ta Reading occurrence va avvalgidek 179 ta saqlangan Vocabulary yozuvi qoldi.

37 xom overlap o‘chirilmadi: ular ichida uzun ibora va ichki so‘zlar ham bor. General Reading proyeksiyasi eng uzun to‘liq source span’ni tanlaydi; bir xil oraliqdagi qarama-qarshi ma’nolarni tasodifan tanlamaydi. Saqlangan eski ID’lar yo‘qotilmaydi. Academic proyeksiyasi va Listening ma’lumotlari o‘zgartirilmagan.

HTML’dagi `fi<strong>nd <em>out</em></strong>` bir source identity bilan ishlaydi. Matn formatlashini saqlaydi, selection format chegaralaridan o‘tadi, popup umumiy dictionary alternativalariga almashmaydi. Blue/yellow/grey nomlarsiz dumaloq ranglar, I-beam va olib tashlash tugmasi saqlandi. Takrorlanuvchi paragraf matni server bergan aniq offset bilan ajratiladi.

## Tekshiruv dalillari

- 172 matn, jumladan 73 HTML passage: server proyeksiya qilgan 25173 span’ning 25173 tasi DOM’da ko‘rindi. Bu ulanmagan so‘zlar tarjimasi tekshiruvi emas.
- 26103 haqiqiy source occurrence nusxasi bilan ajratilgan PGlite tekshiruvi: 85 tuzatish, 0 invalid offset, takroriy bajarish o‘zgarishsiz, source checksum himoyasi ishladi, learner satrlari va mavjud lexeme’lar o‘zgarmadi. Production unique offset indeksi ham tekshirildi.
- Production’da rollback sinovi, qo‘llash, qayta rollback/idempotence va qayta SQL tekshiruv bajarildi: 0 invalid offset.
- Haqiqiy ASGI lookup/save handler’lari bilan ajratilgan PostgreSQL engine’da 4 HTTP tekshiruvi o‘tdi: aynan source ma’nosi, client yuborgan ma’noni almashtirmaslik, passage nomidagi default folder, qayta saqlashda butun SRS satrining o‘zgarmasligi, begona source’ni rad etish.
- Haqiqiy Chromium → mahalliy ASGI → ajratilgan PGlite browser testi o‘tdi. Production login/save acceptance deb ko‘rsatilmaydi; test identity faqat mahalliy fixture’ga tegishli.
- Native build o‘tdi. Reading’ga tegishli 39 backend va 18 frontend testi o‘tdi; keyin SQL-generator testlari ham qo‘shildi.
- Keng backend run: 7217 passed, 3 failed, 23 xfailed. Uch xato o‘zgarmagan main’da ham qayta chiqdi: Listening runtime 8/10 asset tekshiruvi va study-plan diagnostic-bank tengligi.
- Keng frontend run: 1755 passed, 19 failed, 12 skipped. O‘zgarmagan main: 1749 passed, 20 failed, 12 skipped. Eski ikki Reading testi joriy source-only talabiga moslandi va o‘tdi. Bitta qo‘shimcha ZIP transport timeout’i alohida qayta ishga tushirilganda o‘tdi; qolgan 18 xato main bilan bir xil. Butun suite yashil deb da’vo qilinmaydi.
- Native PostgreSQL serverida alohida run bajarilmadi; PGlite va production Supabase natijalari alohida dalildir.

## Qayta tekshirish

`scripts/audit_reading_context.py` JSON eksportni bazaga ulanmasdan tekshiradi. `scripts/reading_context_repair.py` foydalanuvchining mahalliy tekshirilgan manifestidan checksum bilan himoyalangan SQL hosil qiladi; o‘zi bazaga ulanmaydi. Production matnlari va batafsil audit payload’i bu commit’ga qo‘shilmagan. `scripts/verify-reading-context.mjs` haqiqiy HTTP handler’larni ajratilgan bazada tekshiradi. `scripts/verify-general-reading-context-browser.mjs` mahalliy test learner bilan browser oqimini tekshiradi. Production Listening content backfill’lari bo‘sh test bazasiga ishlatilmaydi: ular asl transcript korpusini talab qiladi.

Keyingi ish: source’ga biriktirilmagan so‘z va iboralarni passage bo‘yicha tahririy tekshirish, 105 DOCX tarjimasini tayanch qilish, qolgan 67 matn kontekstini alohida ko‘rish. Coverage’ni ko‘paytirish uchun umumiy dictionary’dan taxminiy ma’no avtomatik ko‘chirilmaydi.
