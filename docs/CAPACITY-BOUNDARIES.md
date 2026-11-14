# Mahalliy yuklama va ish chegaralari

Standart request budjeti 64. `REQUEST_BUDGET_ORDINARY` uni 1..1024 oralig'ida
sozlaydi; noto'g'ri yoki cheksiz qiymat 64 ga qaytadi. Budjetni ko'tarishning o'zi
DB o'tkazuvchanligini oshirmaydi. Bulk, stream, media va probe rezervlari saqlanadi.

Oddiy blocking ishlar avvalgidek ikkita slot va bir soniyalik kutishga ega.
`bcrypt.hashpw` va `bcrypt.checkpw` alohida limiterga o'tdi:

| O'zgaruvchi | Standart | Chegara |
|---|---:|---:|
| AUTH_HASH_CONCURRENCY | max(2, CPU soni), so'ng 8 gacha | 1..8 |
| AUTH_HASH_WAIT_SECONDS | 3 soniya | 0.5..10 soniya |
| REQUEST_BUDGET_ORDINARY | 64 | 1..1024 |

Bcrypt cost 12, decoy hash, WorkBusy paytida rate-limit rezervlarini qaytarish,
503 va Retry-After saqlanadi. Login POST explicit 503 + Retry-After olsa ikki
martagacha jim qayta urinadi. Kutish Retry-Afterdan kam bo'lmaydi, jitter 0..150ms.
10 soniyadan uzun header avtomatik retry qilinmaydi; umumiy request timeout va
abort saqlanadi. Boshqa POST so'rovlari qayta yuborilmaydi.

Takroriy busy 503 va DB pool acquire kutishi 250msdan oshishi haqida har bir
sabab/pool uchun ko'pi bilan daqiqada bir WARNING yoziladi. Loglarda foydalanuvchi
credentiallari, SQL argumentlari yoki DSN yozilmaydi.

Taxminiy throughput:

`pool_size / (har requestdagi DB round triplar soni × DB latency)`.

Ilova va DBni bir mintaqaga joylashtirish tavsiya etiladi. Dashboard uchun
5.3 transaction soni promptdagi o'lchov, ushbu muhitda qayta o'lchanmagan.
Production pool hajmi yoki DB mintaqasi bu branchda o'zgartirilmaydi.

Mahalliy testni oldin va keyin ishga tushirish:

```sh
python3 scripts/loadtest/capacity.py --phase before --users 30 --cookies /tmp/capacity-cookies.json --reset-rates
python3 scripts/loadtest/capacity.py --phase after --users 30 --cookies /tmp/capacity-cookies.json --reset-rates
```

`CAPACITY_DATABASE_URL` faqat localhostdagi `coin_qa` yoki `capacity_*` disposable
bazasiga tegishli bo'lishi shart. `--reset-rates` har bosqich oldidan faqat
`api_rate_buckets`ni TRUNCATE qiladi. Real baza yoki remote origin qabul qilinmaydi.
Cookies fayli mahalliy test akkauntlarining `la_session` qiymatlari massividir;
chiqishga ular yozilmaydi. `CookieJar(unsafe=True)` IP host uchun ishlatiladi,
POST Origin esa Host originiga teng. Session/dashboard bosqichlari cookie
berilmasa ochiq sabab bilan o'tkaziladi. View so'rovida `region=dashboard` bor.

Ushbu sandbox TCP listener va ulanishlarni taqiqladi. Before/after ishga tushirildi,
lekin ulanish xatolari haqiqiy throughput yoki login muvaffaqiyatini o'lchamaydi.
