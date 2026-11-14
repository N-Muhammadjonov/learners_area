# Rate-limit va proxy chegarasi

`client_key()` faqat `OriginBoundary` tekshirgan `cf-connecting-ip` qiymatini
foydalanuvchi IP manzili sifatida qabul qiladi. Boshqa holatda TCP peer IP
ishlatiladi. `uvicorn proxy_headers=False` saqlanadi. `TRUST_PROXY_HEADERS=true`
origin hisoblashga ta'sir qiladi, rate-limit identifikatsiyasini tasdiqlamaydi.

Cloudflare origin chegarasi yoqilmagan proxy ortida barcha foydalanuvchilar bitta
`login_ip` bucketiga tushishi mumkin. Standart limit 900 soniyada 40 ta rezerv.
Rezerv bajarilayotgan so'rovni ham hisoblaydi. Muvaffaqiyatli login yoki `WorkBusy`
holatida mavjud release mantiqi ishlaydi. Bu faqat muvaffaqiyatsiz urinishlar
hisoblagichi emas.

`rate_limit.py::_limits()` va `counter()` aniq `RATE_LIMIT_LOGIN_IP` o'zgaruvchisini
o'qiydi. Masalan, operator tasdiqlagan qisqa muddatli sinov uchun
`RATE_LIMIT_LOGIN_IP=120` qo'yish mumkin. 900 soniyalik oyna o'zgarmaydi.
Qiymatni kuzatilgan yuklamaga mos cheklang; `RATE_LIMIT_LOGIN_ACCOUNT=8` himoyasini
saqlang. Ilova uchun cheksiz yoki avtomatik ko'tariladigan override yo'q.
Standart qiymatlar bu o'zgarishda o'zgartirilmagan.

Barqaror yechim — faqat oldindan vakolat berilgan deploy ishida Cloudflare va
Railway tomonlarida bir xil origin tekshiruvini sozlash. Oddiy forwarding
headerlarini ishonchli deb belgilash rate-limit muammosini xavfsiz hal qilmaydi.
Bu branch production sozlamalari yoki secretlarini o'qimaydi va o'zgartirmaydi.

Telegram redirect va video `embedOrigin` endi `security.request_origin()`dan
foydalanadi. U `TRUST_PROXY_HEADERS=true` bo'lsa tekshirilgan formatdagi forwarded
host/protoni oladi; aks holda so'rov originini saqlaydi. `PUBLIC_BASE_URL`
`check_origin()`dagi ruxsat etilgan originlar ro'yxatiga kiradi, lekin amaldagi
`request_origin()` uning qiymatini qaytarish uchun ishlatmaydi. Bu trust mantiqi
ushbu tuzatishda o'zgartirilmagan.

AUTH_SECRET kamida 16 belgilik avvalgi minimumni saqlaydi. Yangi sozlashda kamida
32 tasodifiy belgi yarating: `openssl rand -base64 48`. 16–31 belgilik qiymat
production/preview startupida faqat ogohlantirish beradi. Secret rotatsiyasi
mavjud sessiyalarni bekor qiladi; bu branch rotatsiya qilmaydi.

`is_https()` o'zgartirilmagan. Hozirgi kod forwarded HTTPS belgisi orqali Secure
cookie qo'yadi. Jonli Railway sozlamalari tekshirilmagani va ularni o'qish scope
tashqarisida bo'lgani uchun bu himoyani toraytirish tasdiqlanmadi.
Srcdoc `postMessage('*')` ham saqlangan: bu muhitda haqiqiy brauzer tekshiruvi
bloklandi. Parent tomonidagi source/origin/path tekshiruvlari saqlanadi.
