# Xaridor uchun demo va handover

**Branch:** `arena/c9f21950-learners-area` · **Sana:** 2026-11-14

> Bu hujjat owner/xaridor uchun. Texnik tafsilotlar uchun `docs/architecture/` va
> `docs/verification/` ga qarang. Egadan talab qilinadigan barcha qo'lda bajariladigan
> harakatlar — `docs/SALE_READY_MANUAL_ACTIONS.md` da (yagona manba).

## 1. 5 daqiqalik demo (hozirgi holatda **haqiqatan** ko'rsatish mumkin bo'lgani)

Demo **API darajasida** ko'rsatiladi: moliya modulining staff UI'si hali qurilmagan.
Buni yashirmang — aksincha, bu halollik xaridorga ishonch beradi.

| # | Qadam | Buyruq / natija | Vaqt |
|---|---|---|---|
| 1 | Shartnoma: oyiga 800,000 so'm, 12 oy | `POST /api/staff/finance/contracts` → `draft` | 20 s |
| 2 | Tasdiqlash va faollashtirish | `POST …/approve`, `POST …/activate` | 15 s |
| 3 | Tasdiqlangan chegirma hujjati: 200,000 | `POST …/discounts` → alohida hujjat, ikkinchi marta qo'shib bo'lmaydi | 20 s |
| 4 | Hisob (charge) yaratish va o'tkazish | `POST /api/staff/finance/charges` → net **600,000**; jurnal: DR A/R 600,000 / CR deferred 600,000 | 30 s |
| 5 | Qisman to'lov 250,000 | `POST /api/staff/finance/payments` → kvitansiya `RC-202611-000001`, qarzdorlik **350,000** | 30 s |
| 6 | Daromad **avtomatik** tan olinmaganini ko'rsatish | summary: `recognizedRevenueMinor = 0` | 15 s |
| 7 | 100 marta bir xil provider callback | faqat **bitta** to'lov, bitta jurnal yozuvi | 30 s |
| 8 | Ortiqcha to'lov 100,000 | `customerAdvanceMinor = 100000`, qarzdorlik 0 (manfiy emas) | 20 s |
| 9 | Egasi dashboard'i | 5 xil raqam alohida: yig'ilgan naqd / hisoblangan / tan olingan / qarzdorlik / muddati o'tgan | 30 s |
| 10 | Buxgalteriya tekshiruvi | `GET /api/staff/finance/reconciliation` → `{"balanced": true}` | 15 s |
| 11 | O'qituvchi boshqa talabaning hisobini so'rasa | 404 — mavjud emasdek javob (ma'lumot sizmaydi) | 20 s |
| 12 | Ota-ona moliya route'iga urinsa | markaziy 403 | 15 s |

**Demo uchun zarur:** local PostgreSQL va `1115` migratsiyasi qo'llangan baza. Retsept:
`docs/verification/SALE_READY_ACCEPTANCE.md` §1 va §7.

## 2. Nima **yo'q** — demo paytida ochiq aytilishi kerak

| Yo'q | Holat | Keyingi qadam |
|---|---|---|
| Moliya moduli staff UI | API bor, interfeys yo'q | Keyingi sprint |
| Guruhlar / jadval / dars davomati | Yo'q (live-class join boshqa narsa) | Eng katta operatsion bo'shliq |
| Talabalarni Excel'dan import | Yo'q | Import pipeline |
| O'qituvchi ish haqi (payroll) | Yo'q | P1 |
| Lead CRM | Yo'q | P1 |
| Filial (branch) izolatsiyasi | Yo'q | Faqat xaridorda filial bo'lsa |
| Click/Payme integratsiyasi | Yo'q (ataylab) | Merchant hisob kerak (MA-01) |
| Production isboti | Yo'q | MA-03…MA-05, MA-07 |

## 3. Uch paket (tadqiqot diapazonlari — **va'da emas**)

| Paket | Nima kiradi | Tadqiqot diapazoni | Shart |
|---|---|---|---|
| **IELTS Edition** | IELTS LMS, CMS, o'qituvchi/talaba portali, RIWI, private media, audit, deploy, zaxira, brending, ma'lumot importi | $9,500–$12,000 | Acceptance dalillari mavjud bo'lsa |
| **Academy Operations Edition** | + moliya subledger, qarzdorlar, naqd/kvitansiya, guruhlar, davomat, payroll, lead pipeline | $14,000–$18,000 | Moliya qismi qurilgan va testlangan; operatsion qatlam hali yo'q |
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

## 7. Halol yakuniy gap

Hozirgi holat: **o'quv platformasi kuchli, moliya umurtqasi qurildi va testlandi, operatsion
qatlam (guruhlar/davomat/import) hali yo'q va production isboti yo'q.**

Shuning uchun "hammasi tayyor" deyish **mumkin emas**. To'g'ri gap:
> "IELTS o'quv qismi ishlaydi; to'lov/qarzdorlik/jurnal qismi haqiqiy PostgreSQL'da
> invariant testlar bilan isbotlandi; production deploy, live provayderlar va zaxira
> tiklash owner harakatlarini kutmoqda; guruhlar va davomat — keyingi bosqich."
