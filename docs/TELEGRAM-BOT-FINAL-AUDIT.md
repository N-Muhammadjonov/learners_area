# Telegram bot — yakuniy kod auditi

Sana: 2026-09-27. Asos: `feature/telegram-access-bot` @ `7dfb36b`. Ish shu sessiyaning `arena/01a0e071-learners-area` tarmog'ida.

Bu hujjat kod tomonidagi qattiqlashtirishni yozadi. U REAL TELEGRAM VERIFIED yoki umumiy 100% emas. Production E2E ni foydalanuvchi o'zi yakunlaydi.

## Qolgan risklar

- `0021_telegram_intent_purpose.sql` productionga qo'llanmagan. U qo'llanmaguncha yangi intent va draft yo'llari ishlamaydi. 0019 va 0020 ga tegilmagan.
- Haqiqiy Telegram, BotFather profil rasmi va production broadcast bu yerda bajarilmagan.
- Railway qayta ishga tushganda chat yozish holati xotirada. Yuborish tasdig'i serverdagi draftga bog'langan.
- Sessiya yaratilgandan keyin jarayon yiqilsa, intent tasdiqlangan holatda qoladi va qayta urinish mumkin. Bu erta yutishdan xavfsizroq.

## Nuqsonlar

| ID | Daraja | Nuqson | Tuzatish |
| --- | --- | --- | --- |
| P0-1 | P0 | Login va ro'yxat bir xil yo'l edi. Noma'lum Telegram login paytida hisob ochishi mumkin edi. | `purpose` serverda saqlanadi. Login hech qachon `users` ga yozmaydi. Ro'yxat faqat PENDING, email null. Link boshqa hisobni egallay olmaydi. |
| P0-2 | P0 | Intent almashuvdan oldin yutilardi. Havola yoki sessiya yiqilsa, tasdiq yo'qolardi. | Avval maqsad bajariladi, sessiya yaratiladi, keyin shartli yutiladi. Ikkinchi chaqiruv sessiya olmaydi. |
| P0-3 | P0 | Bekor qilish faqat brauzerda edi. | `/api/auth/telegram/intent/cancel` pending va confirmed ni bekor qiladi. Keyin tasdiq va almashuv ishlamaydi. |
| P0-4 | P0 | DM va broadcast tasdig'i MemoryStorage da edi. | Callback faqat draft id. Draft actor, target va muddatga bog'langan. Eski `dmok`/`bcok` hech narsa yubormaydi. |
| P0-5 | P0 | Dedup xatosi sezgir amalni qayta ishlashi mumkin edi. | Sezgir callback yoki `/start <token>` dedup javobi noma'lum bo'lsa, to'xtaydi. |
| P0-6 | P0 | Backend xatosi ruxsatsiz foydalanuvchidek ko'rinardi. | `backend_error` vaqtincha xato matnini beradi, ruxsat yo'q emas. |
| P1-1 | P1 | Delivery worker webhookdan oldin ishga tushardi. | Avval config, keyin `setWebhook`, keyin worker. To'xtash worker ni bekor qiladi va sessiyalarni yopadi. |
| P1-2 | P1 | Webhook secret formati tekshirilmasdi. | 1–256, `A-Z a-z 0-9 _ -`. Qiymat logga yozilmaydi. |
| P1-3 | P1 | Ariza holatlari umumiy muvaffaqiyatdek ko'rinardi. | pending, already_pending, reopened, already_active, suspended alohida matn. |
| P1-4 | P1 | Ro'yxat sahifasi login bilan bir xil edi. | Alohida tugma va kutilayotgan ariza matni. |
| P1-5 | P1 | Yordam javobi matn va faylni ikki marta yuborardi. | Bitta yuborish. Yetkazish holati yoziladi. Yuborilgan deb faqat Telegram qabul qilgandan keyin aytiladi. |
| P1-6 | P1 | Eski widget callback sessiya berishi mumkin edi. | Yo'l qoladi, lekin hisob ochmaydi va sessiya bermaydi. |
| P2-1 | P2 | Buyruqlar va aralash tilli tugmalar. | `/start /menu /help /support /status /settings /cancel`, UZ/EN. `/start` ichki menyu ochadi. |
| P2-2 | P2 | Statistika va audit xom JSON edi. | O'qiladigan matn va sahifalash. |
| P2-3 | P2 | Admin ruxsati matn satrida edi. | Raqamli ID va ruxsat tugmalari. Username qabul qilinmaydi. |
| P2-4 | P2 | `/health` dan boshqa tayyorgarlik yo'q edi. | `/health` liveness. `/ready` ichki API. Railway healthcheck o'zgarmaydi. |

## Saqlangan invariantlar

- Email/parol login o'zgarmagan.
- `TelegramButton` o'chirilmagan, lekin sahifaga ulanmagan.
- PENDING hech qachon shu yo'lda ACTIVE bo'lmaydi.
- Username ruxsat emas. `BOT_SERVICE_SECRET` owner emas. Sayt ADMIN i bot admin emas.
- Asosiy owner oddiy bot oqimida olib tashlanmaydi. Bu serverdagi mavjud tekshiruvda qoladi.
- Parol Telegramda so'ralmaydi. Soxta email yaratilmaydi.
- Production broadcast, foydalanuvchi o'chirish va config o'zgarishi bajarilmagan.

## Tekshiruvlar

Shu kod ustida, productionga tegmasdan:

- `npm test`: 279 o'tdi, 0 yiqildi, 3 o'tkazib yuborildi (282 test).
- `services/telegram-bot` pytest: 28 o'tdi.
- `npm run typecheck`: toza.
- `npm run lint`: toza.
- `npm run build`: muvaffaqiyatli.

Bu real Telegram E2E emas.

## Qo'llash

1. Tasdiqdan keyin faqat `drizzle/0021_telegram_intent_purpose.sql` ni qo'llang.
2. Vercel va Railway ni yangi kod bilan deploy qiling. Secretlarni aylantirmang.
3. BotFather qadamlari: `docs/TELEGRAM-BOT-BOTFATHER.md`.
4. Keyin production E2E matritsasini bajaring. Undan oldin umumiy 100% deyilmaydi.
