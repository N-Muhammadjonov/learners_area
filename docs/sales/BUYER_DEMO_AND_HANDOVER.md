# Xaridor uchun demo va handover

**Branch:** `arena/c9f21950-learners-area` · **Sana:** 2026-11-15

> Bu hujjat owner/xaridor uchun. Texnik tafsilotlar uchun `docs/architecture/` va
> `docs/verification/` ga qarang. Egadan talab qilinadigan barcha qo'lda bajariladigan
> harakatlar — `docs/SALE_READY_MANUAL_ACTIONS.md` da (yagona manba).

## 1. Akademiya demo ssenariysi

Ajratilgan muhitda egasi, moliya admini, o‘qituvchi, o‘quvchi va ota-ona hisoblarini tayyorlang. Sintetik fayl va ma’lumotdan foydalaning.

1. `Management → Directory files` orqali CSV yoki XLSX ustunlarini tanlang. Oldindan natijani ko‘rib, yaroqli qatorlarni saqlang. Mavjud hisobni bog‘lang va xato qatorlarini yuklab oling.
2. `Management → Admissions pipeline` orqali nomzod va sinov darsini qayd eting. Mavjud o‘quvchini `Academy groups` dagi guruhga yozing.
3. Guruh jadvalida darsni belgilang. Dars tugagach, o‘tilgan holatga o‘tkazing va biriktirilgan o‘qituvchi bilan davomatni yozing.
4. `Academy finance` da kontrakt va charge yarating. Tasdiqdan so‘ng qisman to‘lovni yozing. Ichki kvitansiya, qoldiq, qarz yoshi va jurnalni ko‘ring.
5. O‘qituvchi Writing topshirig‘ini tayinlaydi. O‘quvchi javobni saqlaydi va topshiradi. O‘qituvchi fikrini yozadi. `Progress → Learner journey` da dars va natijalar paydo bo‘ladi.
6. O‘quvchi ota-ona bog‘lanishini tasdiqlaydi. Ota-ona o‘z farzandining natijasini ko‘radi. Boshqa farzandga ruxsat berilmaydi. Telegram javobini yuboruvchi o‘qituvchiga qaytarish lokal ishchi sinovida tasdiqlangan.
7. `Academy finance → Teacher payroll` da tasdiqlangan davr ish haqini hisoblang. Qoldiq, tuzatish va tasdiqlangan bank chiqimini tekshiring.

8. `Management → Learner support` da davomat dalilini oching, ishni qabul qiling, hal qiling va audit tarixini tekshiring.
9. `Management → Capacity and revenue explorer` da bitta dars va bitta to‘lov davriga uchta ssenariy hisoblang. Akademiya moliyasi va taxminiy tushumni solishtiring.
10. PostgreSQL arxivi va sintetik media zaxirasini yangi ajratilgan muhitga tiklang. Jurnal, rollar va media manzillarini tekshiring.

Bitta sintetik PostgreSQL/ASGI ssenariysida nomzod → trial → guruh → davomat → 800 000 so‘m kontrakt → 200 000 chegirma → 250 000 kvitansiya → 350 000 qarz → Writing → ota-ona → o‘qituvchi inbox’i → payroll → CSV va balans tekshirildi. Ish haqi bosqichi yopilgan oy chegarasini sinov soati bilan o‘tkazadi. Rescue va Capacity uchun Chromium, tiklash va yuk uchun alohida dalillar mavjud. Jonli xaridor sessiyasi, haqiqiy audio, STT, WebRTC, Telegram va merchant tasdiqlari ochiq. [Qabul dalillari](../verification/SALE_READY_ACCEPTANCE.md) · [Yuk va tiklash](../verification/CAPACITY_AND_RECOVERY.md)

## 2. Tashqi tasdiq va qolgan ishlar

| Yo‘nalish | Holat |
|---|---|
| Filial vakolati | Xaridor doirasi belgilanganidan keyin tekshiriladi. |
| Click/Payme | Imzolangan sandbox ishlaydi. Jonli merchant tasdig‘i kutilmoqda. |
| Telegram, audio, STT va WebRTC | Jonli mijoz va qurilma sinovlari alohida bajariladi. |
| Xaridor ma’lumotlari | Hisoblar katalogi import qilinadi. Guruh tarixi va ochilish qoldiqlari uchun manba xaritasi hamda hisob siyosati tasdiqlanadi. |
| Production va tiklash | Lokal PostgreSQL va S3 emulyatori tiklandi. Staging kontentli upgrade, jonli R2, monitoring va aralash yuk ochiq. |

## 3. Uch paket (tadqiqot diapazonlari — **va'da emas**)

| Paket | Nima kiradi | Tadqiqot diapazoni | Shart |
|---|---|---|---|
| **IELTS Edition** | IELTS LMS, CMS, o'qituvchi/talaba portali, RIWI, private media, audit, deploy, zaxira, brending, ma'lumot importi | $9,500–$12,000 | Acceptance dalillari mavjud bo'lsa |
| **Academy Operations Edition** | + moliya subledger, qarzdorlar, naqd/kvitansiya, guruhlar, davomat, payroll, lead pipeline | $14,000–$18,000 | Operatsion asos lokal sinovdan o‘tgan, xaridor piloti kutilmoqda |
| **Exclusive Multi-Branch** | + filial izolatsiyasi, konsolidatsiya, migratsiya xizmati, production monitoring | $20,000–$25,000+ | Faqat haqiqiy branch izolatsiyasidan **keyin** |

Bu raqamlar 2026-11-14 tadqiqot ssenariylari. Ular **savdo majburiyati emas** va har bir
funksiya uchun qo'shiladigan qiymat ham emas. Narx "vebsayt nechpul?" kategoriyasidan
chiqishi uchun xaridor quyidagini sotib olayotganini ko'rishi kerak:
`brend + LMS + operatsion CRM + ma'lumot migratsiyasi + production deploy + xavfsizlik + o'qitish + handover + qo'llab-quvvatlash oynasi`.

**Muhim farq:** cheklangan deploy litsenziyasi ≠ eksklyuziv source-code transferi. Ekin
huquqini tasodifan deploy narxida berib yubormang.

## 4. ROI modellari (misol, kafolat emas)

**Misol A — 400 talabalik markaz, $10,000 ≈ 120.1 mln so'm.**
Bir martalik xarajat ≈ 300 ming so'm/talaba. Agar platforma 12 oyda atigi 25 talabani
churn'dan saqlasa va har biri oyiga 500,000 so'm to'lasa: 25 × 500,000 × 12 = **150 mln so'm**.
Bu — sezgirlik modeli, bozor fakti emas.

**Misol B — 1,000 talabalik akademiya, $15,000 ≈ 180.2 mln so'm.**
≈ 180 ming so'm/faol talaba. Agar qarzdorlik sizib chiqishi, o'tkazib yuborilgan uzaytirishlar
va admin mehnatidan oyiga 15 mln so'm tejalsa/undirilsa, payback ≈ **12 oy**.

## 5. 30 kunlik pilot rejasi

| Hafta | Nima | O'lchov |
|---|---|---|
| 1 | Ma'lumot importi (dry-run), rollar, moliya ochilish balanslari | import xato fayli = 0 kritik |
| 2 | Guruhlar + davomat kunlik ishlatilishi | kunlik davomat yozuvlari soni |
| 3 | To'lovlar va qarzdorlar haftalik reconcilation | `balanced: true`, farq = 0 |
| 4 | Ota-ona xabarlari + hisobotlar; yakuniy qabul | xodim vaqt tejamkorligi, xato darajasi |

**Pilot shartlari:** sintetik/maskalangan ma'lumot, alohida muhit, kunlik metrika
(faol foydalanuvchi, topshiriq bajarilishi, davomat, to'lov reconcilation, xatolar, javob
kechikishi), va oxirida imzolangan qabul hujjati.

## 6. Handover checklist

- [ ] Owner hisoblari o'tkazildi (Cloudflare, Railway, Supabase, Telegram, domen)
- [ ] Barcha secret'lar aylantirildi (`AUTH_SECRET` ham — eski sessiyalar bekor bo'ladi)
- [ ] Eski operator kirishi olib tashlandi
- [ ] Ma'lumotlar lug'ati (data dictionary) topshirildi
- [ ] Migratsiya dry-run va imzolangan reconcilation
- [ ] Zaxira tiklash retsepti sinovdan o'tdi (MA-07)
- [ ] Owner treningi va 30 kunlik qo'llab-quvvatlash chegarasi yozma belgilandi
- [ ] IP/litsenziya shartnomasi imzolandi (MA-12)
- [ ] Hech qanday yetkazib beruvchi secret'i qolmadi

## 7. Joriy qabul holati

Ajratilgan PostgreSQL’dagi moliya va o‘quv jarayoni isbotlari hamda lokal tiklash tayyor. 10 000 o‘quvchili baza bilan 50 parallel so‘rov darajasida p95 295,36 ms chiqdi. Keyingi darajalarda 503 davom etdi. Xaridor sessiyasi, staging yuklamasi va jonli integratsiyalar uchun tasdiq dalillari kerak.
