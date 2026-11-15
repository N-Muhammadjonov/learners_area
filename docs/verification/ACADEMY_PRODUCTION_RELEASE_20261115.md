# Production migration receipt — 2026-11-15

Academy va Tuition 1115–1131 production bazaga qo‘llandi va faollashtirildi.
Bu hujjat avvalgi auditdagi production migratsiyasi ochiq degan holatni almashtiradi.
Foydalanuvchi migratsiyalar va zarur production ishlariga aniq ruxsat berdi.

| Tekshiruv | Natija |
|---|---|
| Academy migratsiyalari | 17/17; barcha SHA-256 qiymatlari repoga mos |
| Yangi boshqariladigan jadvallar | 35; barchasida RLS yoqilgan |
| To‘g‘ridan-to‘g‘ri API jadval ruxsatlari | 0 |
| Avvalgi jadvallar | 206 ta jadval yozuv soni tranzaksiya ichida saqlangan |
| Moliya hisoblari | 12 |
| Moliya jurnalidagi yozuv/qator | 0/0; haqiqiy to‘lov sinovi o‘tkazilmagan |
| Shifrlangan zaxira | 66 805 993 bayt; private R2 |
| Zaxirani qayta yuklab SHA-256 tekshiruvi | O‘tdi |
| Ajratilgan PostgreSQL 17’da tiklash va migratsiya | O‘tdi |
| Supabase security advisor | 0 WARN, 0 ERROR |
| Ichki funksiyalarga API execute ruxsati | 0 |
| RLS event trigger | `ensure_rls`, yoqilgan |

Mashina o‘qiydigan dalil va barcha xeshlar:
[ACADEMY_PRODUCTION_RELEASE_20261115.json](ACADEMY_PRODUCTION_RELEASE_20261115.json).

## Zaxira va qo‘llash

`dd6fe49b` relizi `77009910-6fbd-4d95-b17d-c32db56c5a15` deploymentida SUCCESS
bo‘ldi. Migratsiya 20:28:07 Toshkent vaqtida bitta tranzaksiyada bajarildi.
Read-only snapshotdan olingan PostgreSQL custom dump AES-256-GCM bilan shifrlanib,
R2’ga yuklandi, qayta yuklab xeshi tekshirildi va yangi lokal bazada tiklandi.
Tiklangan nusxaning jadval sonlari, constraint soni va RLS bayroqlari snapshotga
mos tushdi. Xuddi shu 17 SQL fayli avval o‘sha nusxada tekshirildi.

Zaxira SHA-256:
`abff5aefb2a7ee9e96fef8a079373e5af28eca9b47c601ebbd97a34549ccea13`.
Kalit R2’dan alohida `ACADEMY_BACKUP_KEY` muhit qiymatida saqlanadi. Kalit,
ulanish paroli va o‘quvchi yozuvlari log yoki ushbu hujjatga chiqarilmagan.

Dastlabki pre-deploy urinishlari shu bosqichda to‘xtadi; production migratsiya
jurnali va yangi jadvallar yaratilmagani SQL bilan tekshirildi. Loglari ko‘rinadigan
startup gate yangi relizda ishga tushdi. Server faqat zaxira, tiklash va migratsiya
tekshiruvlari o‘tgach ochildi. Railway `/readyz` tekshiruvi bilan deploymentni qabul qildi.

Keyingi `059a3712` relizi `665fa268-f8d4-45a5-8558-34cecaedafd9` deploymentida
SUCCESS bo‘ldi. Gate `already_applied` qaytardi. Bu qayta ishga tushirishda
migratsiyalar takror yozilmasligini production’da ham tasdiqlaydi.

## Funksiya chegaralari

Supabase auditidagi oltita mutable `search_path` va `rls_auto_enable()` uchun
ikkita ortiqcha API execute ogohlantirishi tuzatildi. Yangi platform migratsiyasi:
`supabase/migrations/20261115183948_private_trigger_function_boundaries.sql`.

Oltita trigger funksiyasining yo‘li `pg_catalog, public, pg_temp` bilan qotirildi.
`pg_temp` oxirda aniq berilgani vaqtinchalik jadval asl moliya jadvalini yashirishiga
yo‘l qo‘ymaydi. Yetti ichki funksiyadan PUBLIC va API rollarining execute ruxsati
olib tashlandi. Serverning owner vakolati va RLS event trigger saqlandi.

24 ta native sinov o‘tdi. Sinovlar buzilgan yuklama va oxirgi migratsiya xatosida
asl baza o‘zgarmasligini, migratsiyaning idempotentligini, soxta vaqtinchalik jadval
bilan balans nazoratini chetlab o‘tish rad etilishini va execute ruxsati yopilgandan
keyin ham RLS avtomatik yoqilishini tekshiradi.

Yakuniy lokal backend to‘plami PostgreSQL 17’da 7 516 ta test va 287 ta subtestdan
o‘tdi: 0 fail, 0 skip, 0 xfail; 115.98 soniya. Joriy ilova kodining avvalgi
[Full Stability CI](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43745334599)
sinovida backend 7 516 va frontend 1 816 testdan o‘tgan. Frontenddagi 11 ta mavjud
tashqi legacy fixture skip alohida qayd etilgan.

240 ta `RLS Enabled No Policy` INFO qaydi qolgan. Bu server orqali ishlaydigan
xususiy jadvallarning to‘g‘ridan-to‘g‘ri Supabase API uchun yopiq siyosatiga mos.

## Dalil chegarasi

Ushbu zaxira `public` va `drizzle` ilova sxemalarini qamrab oladi. Supabase’ning
Auth/Storage/Vault sxemalari, rol parollari, R2 media baytlari, to‘liq avariya
tiklash va kelishilgan RPO/RTO bundan kelib chiqmaydi. Ochiq avtomatik HTTP
so‘rovlarini Cloudflare 1010 blokladi. Jonli audio, Telegram, WebRTC va owner
brauzer qabuli tekshirildi deb belgilanmagan. Haqiqiy merchant adapter va boshqa
ochiq tijorat mezonlari sabab barcha meta-prompt talablari tugagan deb aytilmaydi.

Egaga qolgan ishlar yagona [ro‘yxatda](../SALE_READY_MANUAL_ACTIONS.md).
