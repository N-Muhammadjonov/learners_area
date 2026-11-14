# Dictionary auditini tezlashtirish — amalda qo‘llangan usul

Keyingi kengaytirish: read-only xizmatlar tiklangach, barcha **256 shard / 65 277 leksema / 110 409 ma’no** mahalliy indeksga **34,961 soniyada** yig‘ildi. To‘liq R2 compressed/raw SHA, hajm, entry schema va release tekshiruvi o‘tdi. Yangi Supabase SELECT bilan content hashlar, barcha sense/example IDlar hamda packed storage offset/length/raw-size inventari **30,991 soniyada PASS** bo‘ldi. 82 021 example ID faqat yaxlitlik uchun solishtirildi; example matnlari auditi boshlanmadi. Remote manifestning canonical SHA qiymati ham Supabase manifest SHAga teng.

Endi oldingi birinchi 200 leksemadagi **138 leksema / 273 hali yakunlanmagan ma’no / 458 target leksema** to‘liq konteksti 1,391 soniyada tayyorlanadi; source nusxasi yetishmasligi 0. Oldin candidate’dan chiqarilgan ikki `apprise` ma’nosi alohida `candidate_present: false` bilan saqlanadi; ularga boshqa ma’no qo‘yilmaydi. Dalillar: `audit-20261113-global-source-offset-verification.json`, `audit-20261113-acceleration-full-index.json` va `audit-20261113-source-shard-descriptors-readonly.json`.

Bu natija barcha manbalar bilan ishlashni tezlashtiradi. To‘liq yetti maydonli editorial hisob **92 leksema / 128 ma’no / 896 qaror**, bosqichlar esa **0/20** bo‘lib qoladi. Quyidagi 95-shard o‘lchovi dastlabki tajriba sifatida saqlangan.

Avval har bir kichik guruh uchun source va target qayta ochilgan. Endi mavjud immutable R2 nusxalar bir marta autentifikatsiya qilinib, mahalliy SQLite indeksiga joylandi. Backendning mavjud strict decoder, ICU canonicalizer, meaning hash va candidate curation kodi qayta ishlatiladi. Ilova oqimi qayta yozilmadi; yangi kod faqat audit vositasiga qo‘shildi.

Haqiqiy o‘lchov: **95 shard / 24 150 leksema / 41 151 ma’no 7,813 soniyada** indekslandi. Oldin tugallangan ma’nolar chiqarib tashlangach, bir paketda **94 leksema / 197 ma’no va 111 target leksema** konteksti 0,467 soniyada tayyorlandi. Keyingi ixcham eksport 0,556 soniya oldi. Paket 2 367 336 baytdan 407 147 baytga qisqardi — **82,8% kam**. Bu tayyorlash va ma’lumot uzatish o‘lchovi; butun lingvistik audit shuncha tezlashdi degan o‘lchov emas.

Shu paketdan **48 source leksema / 73 source ma’nodagi 115 mavjud synonym** bog‘lanishi aniq source sense ID bilan belgilandi. Har birida to‘liq authenticated source/target, target UUID, POS, lemma, lexical type va yagona aynan mos English gloss tekshirildi. Noaniq yoki yo‘q target ma’nosi o‘rniga birinchi ma’no olinmaydi. Bu qisman relation tuzatishi; **115 yoki 73 ta yangi to‘liq yetti maydonli signoff deb hisoblanmaydi**.

Indekslash va paket tayyorlash hech bir ma’noni avtomatik editorial tasdiqlamaydi. Har ma’nodagi English/Uzbek ta’rif, tarjima, sense-specific CEFR, synonym/antonym/collocation bo‘yicha dalilli qaror alohida saqlanadi. Examples global lexical auditdan keyin tekshiriladi. Bir xil glossli so‘zlar bir ma’noga birlashtirilmaydi; UUIDlar saqlanadi.

| Vosita | Qaror va chegarasi |
| --- | --- |
| Python `sqlite3` | Amalda qo‘llandi: source/targetni ID bilan mahalliy qidirish; yangi paket o‘rnatish talab qilmaydi. [Rasmiy qo‘llanma](https://docs.python.org/3/library/sqlite3.html). |
| HTTPX | Mavjud kutubxona. Rasmiy hujjat bitta scoped AsyncClient va connection poolingni tavsiya qiladi. Kelgusi ruxsat etilgan read-only yuklashlar uchun mos; bu ishda qo‘shimcha remote fetch ishga tushirilmadi. [Async hujjati](https://www.python-httpx.org/async/). |
| Wn | Lexicon, sense va relationlarni aniq versiya bilan o‘qiy oladi. Ushbu lug‘atning WordNet manbasini o‘zi bilan solishtirish mustaqil til tekshiruvini isbotlamaydi; Uzbek/CEFR sertifikati sifatida ishlatilmadi. [Lexicon hujjati](https://wn.readthedocs.io/en/stable/guides/lexicons.html). |
| UZWORDNET | 2021-yilgi mualliflar maqolasida 28 140 synset / 64 389 sense va 75,98% estimated accuracy ko‘rsatilgan. Qo‘shimcha semantik solishtirish manbasi bo‘lishi mumkin; ushbu baho barcha tarjimalarni avtomatik to‘g‘ri deb qabul qilishga yetmaydi. Data import yoki umumiy overwrite bajarilmadi. [Mualliflar maqolasi](https://aclanthology.org/2021.gwc-1.2/). |
| RapidFuzz | Tez string matching beradi; o‘xshash yozilish ma’nolar tengligini isbotlamaydi. Target sense ulashda ishlatilmadi. [Rasmiy hujjat](https://rapidfuzz.github.io/RapidFuzz/). |
| OpenAI Batch API | Rasmiy hujjat yuqoriroq alohida limitlar, 24 soatlik completion window va odatiy synchronous APIga nisbatan 50% narx chegirmasini ko‘rsatadi. Juda katta model tekshiruvlarini guruhlab bajarish uchun mumkin, lekin joriy jarayon muhitida API kaliti topilmadi. Model, narx/budjet yoki yakunlash vaqti taxmin qilinmadi; tashqi API job yuborilmadi. [Rasmiy Batch hujjati](https://developers.openai.com/api/docs/guides/batch). |

Misol gaplar, attribution va takroriy o‘zgarmagan maydonlar lexical kontekstni ortiqcha kattalashtirmaydi. To‘liq asl yozuvlar checksum-bound audit indeksida qoladi. Audit provenance lug‘at kontentiga qo‘shilmaydi.

## Qayta ishlatish

Repo ichida mavjud backend Python muhiti bilan:

```bash
python tools/dictionary-optimization/scripts/dictionary_optimization.py offline-index \
  --repo . --cache-dir ../r2 --database ../dictionary-audit-index.sqlite \
  --release rel-v1-1fa06d8d41d8ff701632573e --out ../audit-offline-index-receipt.json

python tools/dictionary-optimization/scripts/dictionary_optimization.py sense-pack \
  --repo . --database ../dictionary-audit-index.sqlite \
  --index-receipt ../audit-offline-index-receipt.json \
  --source-receipt content/dictionary/audit-20261113-phase09-first-200-lexemes.json \
  --limit 250 --compact --out ../phase09-compact-context.json
```

Paket har safar joriy candidate va ledgerlardan tayyorlanadi. Oldin to‘liq tekshirilgan sense ID qayta hisoblanmaydi. Muvaffaqiyatsiz hash, boshqa release, qarama-qarshi descriptor yoki noaniq source/target mosligi tasdiqlanmaydi. Xato shard yaxshi indeksni almashtira olmaydi; eksportdan oldin indeksning SHA tekshiriladi.

Dastlabki 95-shard bosqichida fresh Supabase content_sha solishtiruvi connector unavailable bo‘lgani uchun bajarilmagan; tarixiy receipt shu holatda saqlangan. Keyingi to‘liq global content/offset solishtiruvi yangi read-only Supabase snapshot bilan PASS bo‘ldi. **0/20 bosqich to‘liq tugallangan.** `main`, production DB/R2, immutable source va release/deployga yozilmadi.
