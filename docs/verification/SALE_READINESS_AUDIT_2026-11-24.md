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

## Sinov

```bash
python3 tests/load_simulation.py --students 10000 --learners 1000 --concurrency 128
```

Baza manzili `LOAD_SIMULATION_DATABASE_URL` orqali beriladi. Skript faqat loopback manzilidagi `coin_qa` xizmatini qabul qiladi va har ishga tushganda alohida nomli baza yaratadi. Hisobotda HTTP javoblari, har endpoint uchun p95, eng katta parallel yuk, baza ulanishlari va jarayon xotirasi ko‘rinadi. Test oxirida saqlangan ball va javoblar bazadan tekshiriladi.

Login, logout va yangi sessiya haqiqiy autentifikatsiya handlerlaridan o‘tadi. Reading taymeridan keyin yuborilganda saqlangan qoralama baholanishi tekshiriladi. Takroriy topshirishda bitta so‘rov muvaffaqiyatli yakunlanishi va ikkinchisi 409 qaytarishi kutiladi. Tarmoq uzilishi ASGI transportida qayta yaratiladi.

## Sotuvga tayyorgarlik chegarasi

Ushbu natijalar repodagi oqimlar va alohida yuklama bazasiga tegishli. Production hosting, CDN, real to‘lov provayderi, real mobil qurilmadagi tezlik, uzoq muddatli xotira o‘lchovi va har bir tugmaning qo‘lda tekshiruvi alohida dalil talab qiladi. Sotuvga tayyorgarlik hukmi shularning natijasiga bog‘liq.

Matn va interfeys tahririda qisqa holat xabarlari, mavjud dizayn tokenlari va brauzerda ko‘rinadigan boshqaruvlar asos qilib olindi. [Humanizer](https://github.com/blader/humanizer) · [Taste-Skill](https://github.com/Leonxlnx/taste-skill)
