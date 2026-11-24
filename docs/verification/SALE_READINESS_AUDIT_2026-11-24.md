# Learners Area sotuvga tayyorgarlik auditi

2026-yil 24-noyabr. Audit bazasi PR #221 dagi `252e119` commit.

Repo inventarida 5 838 fayl qayd etildi. Sintaksis tekshiruvi 678 Python, 1 134 JavaScript va 24 CSS faylini qamradi. Reading, Listening va sessiya yo‘llari frontend, HTTP handler va PostgreSQL so‘rovlarigacha kuzatildi.

## Topilmalar

| Raqam | Ildiz sabab | Qo‘llangan tuzatish |
| --- | --- | --- |
| #1 | Reading qoralama va topshirish tranzaksiyasi har savol uchun alohida INSERT bajarardi. Bu baza ulanishi va urinish qulfining vaqtini oshirardi. | Javoblar bitta INSERT orqali yoziladi. Baholash tartibi, avvalgi qoralamani almashtirish va mavjud urinish qulfi saqlanadi. |
| #2 | Listening topshirish so‘rov tanasini baza ulanishi olingandan keyin o‘qirdi. Ball yozilgandan so‘ng faollik uchun ikkinchi ulanish olardi. | JSON avval o‘qiladi. Savollar bitta INSERT orqali yoziladi. Ball, hodisa va faollik bir tranzaksiyada tasdiqlanadi. |
| #3 | Reading topshirishida va Listening qoralamasida javoblar soni cheklanmagan edi. Juda katta audio pozitsiyasi sonni tekshirishda istisno chiqarishi mumkin edi. | Reading uchun 60, Listening uchun 200 javob bilan cheklangan. Audio pozitsiyasi 0 dan 7 200 soniyagacha bo‘lgan son sifatida tekshiriladi. |
| #4 | Mavjud yuklama sinovlari Academy va umumiy HTTP yukini tekshirar edi. O‘quvchining sessiya va imtihon amallarini 10 000 profil bilan birga sinaydigan yo‘l yo‘q edi. | `tests/load_simulation.py` vaqtinchalik PostgreSQL bazasini yaratadi. 10 000 profil, 1 000 o‘quvchi yo‘li va 128 virtual o‘quvchi standart sozlamalar hisoblanadi. |
| #5 | General Reading saqlash va tekshirish xatolarini umumiy matn bilan chiqarardi. Qayta urinish amali ko‘rinmas edi. | Xabar javoblar oynada turganini aytadi. Qayta urinish tugmasi oxirgi amalni takrorlaydi. |
| #6 | Mijoz JSON tanasini yuborish paytida uzilsa, Starlette istisnosi umumiy server xatosi sifatida qaytishi mumkin edi. | Tana o‘qilmagan so‘rov yozuv boshlanishidan oldin bekor qilinadi. Sinov uzilishdan keyin qoralamani saqlashni tekshiradi. |
| #7 | 70–300 ms oralig‘idagi jadallashtirilgan yukda amallar 64 ta oddiy so‘rov chegarasiga yetdi. 4 752 so‘rovdan 449 tasi dastlab `503` oldi. | `steady` ssenariysi 600–1 600 ms oralig‘ida 128 o‘quvchi bilan ishlaydi. CI unda qayta urinish kuzatilsa xato qaytaradi. `burst` rejimi tiqilishni alohida o‘lchaydi. |
| #8 | Safari’da 32 px avatar uchun 106 KB PNG yuklandi. Guruhlar sahifasining kuzatilgan qayta yuklanishida eng katta uzatilgan resurs shu rasm edi. | Yuqori panel 96 px WebP variantini so‘raydi. Profil sahifasidagi asl fayl saqlanadi. |

## Sinov

```bash
python3 tests/load_simulation.py --students 10000 --learners 1000 --concurrency 128 --pace steady
python3 tests/load_simulation.py --students 10000 --learners 1000 --concurrency 128 --pace burst
```

Baza manzili `LOAD_SIMULATION_DATABASE_URL` orqali beriladi. Skript faqat loopback manzilidagi `coin_qa` xizmatini qabul qiladi va har ishga tushganda alohida nomli baza yaratadi. Hisobotda HTTP javoblari, har endpoint uchun p95 va qayta urinishlar, eng katta parallel yuk, baza ulanishlari va jarayon xotirasi ko‘rinadi. Test oxirida saqlangan ball va javoblar bazadan tekshiriladi.

Login, logout va yangi sessiya haqiqiy autentifikatsiya handlerlaridan o‘tadi. Reading taymeridan keyin yuborilganda saqlangan qoralama baholanishi tekshiriladi. Takroriy topshirishda bitta so‘rov muvaffaqiyatli yakunlanishi va ikkinchisi 409 qaytarishi kutiladi. Tarmoq uzilishi ASGI transportida qayta yaratiladi.

70–300 ms oralig‘idagi dastlabki o‘lchovda 128 parallel o‘quvchi va 1 000 yakunlangan yo‘l qayd etildi. Bir vaqtning o‘zida 65 ta HTTP so‘rovi va beshta band baza ulanishi kuzatildi. 449 ta `503` javobidan keyin barcha amallar yakunlandi. [CI jurnali](https://github.com/N-Muhammadjonov/learners_area/actions/runs/45370740122/job/138364050331)

## Safari va production kuzatuvi

Owner sessiyasida Finance, People va Groups ochildi. Safari Network jadvalida `/api/presence` javoblari `204` bo‘ldi. Faollikdan keyin Online oynasida hisob 1 ga ko‘tarildi. Production `eee92df` commitida ishlayotgani Safari va Railway deployment orqali tasdiqlandi.

Safari’ning 390 px rejimida Groups sahifasini qayta yuklashda hujjat 375 ms, sessiya 363 ms, guruhlar so‘rovi 562 ms va profil rasmi 539 ms oldi. Shu yuklanishda Network jadvali 918 ms ko‘rsatdi. Bu MacBook’dagi bitta kuzatuv. Telefon haqiqiy qurilma o‘lchovi hali ochiq.

256 × 256 test PNG fayli 197 107 bayt edi. Panel uchun 96 × 96 WebP varianti 3 750 baytga tushdi. Mahalliy o‘lchovda kodlash mediani 2,36 ms bo‘ldi. Rasm tasdiqlangan sessiyadagina yuklanadi, `private, no-store` siyosati saqlanadi.

Railway’ning so‘nggi 24 soatidagi 289 o‘lchovda xotira 0,096–0,700 GB, protsessorning eng yuqori bandligi 0,055 yadro bo‘ldi. Bu odatiy production trafik kuzatuvi. [Railway deployment](https://railway.com/project/7d1f50bb-3847-4d7c-b2c2-ef63f08a98dd/service/c4cb2c24-6777-4b90-a04e-43bc88d69e1c?environmentId=5255a4eb-401d-4fed-aec7-cd1433edc24f)

Avvalgi 2 soatlik Academy sinovi 10 000 profilda 1 034 705 muvaffaqiyatli o‘qish so‘rovi va 238 aralash yozuv bosqichini qayd etgan. Ushbu dalil `fada41c` commitiga tegishli. Academy ish oynasi va moliya jurnali manbalari keyin o‘zgargan. [Ikki soatlik Academy jurnali](academy-ux/soak-two-hours.json)

## Sotuvga tayyorgarlik chegarasi

Sotuvga chiqarish qarori uchun production quvvatining yuqori chegarasi, haqiqiy mobil qurilma, jonli to‘lov provayderi va joriy commitning uzoq yuklamadagi xotirasi bo‘yicha dalillar qolgan.

Matn va interfeys tahririda qisqa holat xabarlari, mavjud dizayn tokenlari va brauzerda ko‘rinadigan boshqaruvlar asos qilib olindi. [Humanizer](https://github.com/blader/humanizer) · [Taste-Skill](https://github.com/Leonxlnx/taste-skill)
