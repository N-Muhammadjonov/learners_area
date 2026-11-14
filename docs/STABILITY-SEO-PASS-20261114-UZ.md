# Stability va SEO tekshiruvi — 2026-11-14

Holat: to‘liq Definition of Done bajarilmagan. Mahalliy kod tayyor, lekin 1 backend va 5 frontend testi qizil. Ularning sabablari quyida ochiq ko‘rsatilgan. Productionga deploy qilinmadi, main’ga push/merge qilinmadi, real bazalar va production secretlari o‘qilmadi yoki o‘zgartirilmadi.

Repo: `N-Muhammadjonov/learners_area`
Mahalliy branch: `fix/stability-seo-pass-20261114`
Boshlang‘ich commit: `f57647f9e939336fe83ae1d379af0beff3ad47b6`

## Muhit va nashr holati

- Backend va build: Python 3.14.5. Repo targeti Python 3.14 bilan mos.
- Frontend: Node 22.23.4.
- Dev yuklama skripti: aiohttp 3.14.5. Alohida `scripts/loadtest/requirements.txt`da belgilangan.
- Frontend dependency o‘rnatish: `npm ci --offline`; root build dependencylari: `npm ci --offline --ignore-scripts`. Yangi runtime dependency qo‘shilmadi.
- GitHub va Google Fonts’ga shell orqali DNS ishlamadi. Boshlang‘ich kod mavjud mahalliy Git obyektlaridan olindi va aniq base commitga checkout qilindi.
- Chrome executable mavjud, ammo sandbox uni ishga tushirishni va localhost TCP listener/ulanishlarni blokladi. Browser orqali vizual tenglik tekshirilmagan.
- GitHub repo public ekanligi, aniq repo nomi, push huquqi va branch manzili qayta tekshirildi. Dastlabki scope/visual-harness commiti remote branchga saqlandi. Qolgan kodni ochiq repoga nashr qilish avtomatik tasdiqlash tekshiruvida rad etildi: aniq payload va destination uchun alohida foydalanuvchi tasdig‘i talab qilindi. Qolgan ishlar mahalliy Git commitlarida saqlangan. Force-push ishlatilmadi.

## A–I natijalari

| Vazifa | Holat | O‘zgarish va dalil | Qolgan cheklov |
|---|---|---|---|
| 0. Scope va baseline | fixed / fixed-untested | `scripts/scope_check.sh` commit, staged, unstaged va untracked yo‘llarni tekshiradi; rename ham yashirilmaydi. `scripts/visual_check.mjs` 3 route × 3 width × 2 motion rejimini capture qiladi va no-preference baseline bilan pixel diff chiqaradi. Bazaviy HTML kod o‘zgartirilishidan oldin repo tashqarisida saqlandi. | Chrome launch va local TCP rad etildi. Screenshot baseline va browser pixel tengligi tasdiqlanmagan. |
| A. Motion | fixed, faqat landing; qolgan qism skipped | Landing ichidagi aynan uchta media bloki A commitida olib tashlandi. CSS va boshlang‘ich body DOM solishtiruvi, mavjud/mavjud bo‘lmagan IntersectionObserver reveal yo‘li testlari o‘tdi. | `modules/study-plan/sequence.css` va generated build nusxasida yana bitta reduced-motion bloki bor. CSS fayllari qat’iy taqiqlangani uchun tegilmadi. Unmodified hover-system testi real fail holatida qoldi. |
| B. Shrift | skipped | Rasmiy Google Fonts katalogida `BricolageGrotesque[opsz,wdth,wght].ttf` va OFL fayli borligi topildi. | WOFF2 bytes olinmadi: shell DNS bloklangan, mavjud read vositasi binary shriftni qabul qilmadi. Font konvertatsiya kutubxonasi ham bu muhitda yo‘q. Latin/latin-ext WOFF2 va unga mos license fayllari qo‘shilmagan. Google font linklari saqlangan, B acceptance bajarilmagan. |
| C. Landing hajmi | fixed-untested, browser tarmog‘i bo‘yicha | `auth/public.js` faqat `/` va `/landing` ichida dynamic import qiladi; abort/nonce/source/origin/path tekshiruvlari saqlandi. 10 WebP asl bytes bilan `/brand/landing/`ga chiqarildi. Byte tengligi testi o‘tdi. Import xatosi static fallbackni saqlaydi. | `/login`dagi haqiqiy HTTP JS bytes va browser request count o‘lchanmagan; pastdagi gzip sonlari fayl bytes hisobidir. |
| D. SEO | fixed | Python build fallbackni LANDING_HTML’ning ayni matni va dinamik feature/step/FAQ massivlaridan generatsiya qiladi. Bir h1, sectionlar, 17-savol tavsifi, 3 FAQ, login/register havolalari va mos FAQPage bor. WebSite/meta/canonical/robots siyosati o‘zgarmagan. `test_public_seo.py`: 22 pass. JSDOM iframe loadgacha fallback saqlanishini isbotladi. | Real browserda swap vizual tengligi tekshirilmagan. HTTP socket o‘rniga ASGI TestClient ishlatildi; curl muvaffaqiyati da’vo qilinmaydi. |
| E. Landing natijasini ishlatish | fixed-untested, real Postgres bo‘yicha | Raw canonical answer indekslari saqlanadi. `score_public_hint()` client score/levelni authority deb olmaydi. Version/schema/4096-byte limit/24h TTL va 17 ta javob tarkibi tekshiriladi. Existing activity_events bilan idempotent consume, current_level va in-app natijaga ustuvorlik saqlandi. Hint transporti 401 holatida auth-failure event chiqarmaydi va login navigationini to‘xtatmaydi. | Haqiqiy DB tranzaksiya/integration tekshiruvi ishlamadi. Public bank 45, in-app bank 150: to‘liq tenglik hal qilinmagan. |
| F. Test va CI | qisman fixed, qolganlari skipped emas — real fail | Eskirgan route sonlari o‘rniga method/path/name snapshoti va historic route preservation tekshiruvi qo‘shildi. Fixture va realm xatolari tuzatildi. Python 3.14 + Postgres 17:55439 + pytest-timeout + npm ci/test/build CI qo‘shildi. Deleted premium-landing workflow reference yangilandi. | Yakuniy 1 backend va 5 frontend fail quyida sanalgan. CI green deb ko‘rsatilmaydi. |
| G. Proxy va rate identity | fixed | Telegram redirect va video embedOrigin `security.request_origin()`dan foydalanadi. Trusted/untrusted forwarded host/proto testlari o‘tdi. Productionda unverified peer IP uchun bir martalik startup WARNING va bounded operator override hujjati qo‘shildi. | `client_key` va `proxy_headers=False` saqlandi. Amaldagi request_origin PUBLIC_BASE_URL’ni output uchun ishlatmaydi; bu promptdagi taxmindan farq qiladi. Bu trust mantiqi kengaytirilmadi. |
| H. Kichik security ishlari | fixed / skipped | AUTH_SECRET 16 belgilik minimumi va mavjud sessiyalar saqlandi; production/previewda 32 dan qisqa qiymat uchun bir martalik WARNING bor. HTTPS cookie Secure holati unit testda saqlandi. | Production secret uzunligi o‘qilmadi. is_https() o‘zgartirilmadi. Srcdoc postMessage target origin real browserda tekshirilmagani uchun `*` saqlandi; parent validatsiyasi saqlandi. |
| I. Capacity | fixed-untested, real yuklama bo‘yicha | Bcrypt uchun alohida 1..8 slot va 0.5..10s kutish, default 3s. Boshqa blocking ishlar 2 slot/1s. Ordinary budjet 1..1024, default 64. Busy 503 va acquire >250ms uchun rate-limited WARNING. YouTube cache 512 + TTL + oldest eviction. Login POST uchun max 2 Retry-After+jitter retry. 32 ta focused backend va 5 ta focused frontend testi o‘tdi. | Bcrypt cost 12/decoy/rate reservation release/503 saqlandi. Before/after probe ishga tushdi, ammo barcha TCP ulanishlar rad etildi; throughput oshdi deb da’vo qilinmaydi. |

## Landing bytes va requests

Quyidagi sonlar source fayl va gzip bytes hisobidir. Browser transfer o‘lchovi emas.

| O‘lchov | Oldin | Keyin |
|---|---:|---:|
| landing-inline.js source | 626,017 B | 79,102 B |
| gzip, level 9 | 439,664 B | 25,569 B |

Landing modulining gzip farqi 414,095 B. Login/register static importdan bu modul chiqarildi. Buildda kichik semantic fallback auth chunkka qo‘shiladi, shuning uchun jami transfer farqi aynan shu songa teng deb ko‘rsatilmaydi. Yangi 10 ta unique rasm resursi jami 410,236 B. Ular qayta encode/resize qilinmagan; mavjud lazy loading va alt xatti-harakati saqlangan. Haqiqiy request count o‘lchanmagan.

| Yangi rasm URL | Bytes |
|---|---:|
| `/brand/landing/26c573ccdbd9e138320c.webp` | 24,878 |
| `/brand/landing/60468a287e7ddf2b6f7c.webp` | 82,436 |
| `/brand/landing/65dcacf2c6b2bff709cd.webp` | 22,400 |
| `/brand/landing/7aadcdfe26efe89a5570.webp` | 21,408 |
| `/brand/landing/94ffa7f3e9deaa3b61f5.webp` | 29,182 |
| `/brand/landing/a3f27a5ff6d61aa95ac1.webp` | 48,492 |
| `/brand/landing/b055a4ca95e966fba45b.webp` | 20,710 |
| `/brand/landing/bf0ff9934dda5646fd61.webp` | 62,060 |
| `/brand/landing/d0ffb7c39fc10da35d30.webp` | 79,288 |
| `/brand/landing/de4c0ab4edf6a01410bb.webp` | 19,382 |

Static CSS diff faqat uchta motion blokining olib tashlanganini tasdiqladi. Boshlang‘ich landing body DOM bir xil. Observer mavjud bo‘lmasa reveal fallback elementlarni ochadi; observer callback umuman kelmay qoladigan holatda original kodda alohida timeout fallback yo‘q. Bu original xatti-harakat qayta loyihalanmadi va to‘liq browser isboti sifatida ko‘rsatilmaydi.

## To‘liq test natijalari

| To‘plam | Baseline | Yakuniy |
|---|---|---|
| Backend | 6175 pass, 22 fail, 20 error; 282 subtest pass | 6206 pass, 1 fail, 23 xfail; 282 subtest pass |
| Frontend | 1669 pass, 22 fail, 11 skip | 1696 pass, 5 fail, 12 skip |
| Public SEO | eski fallback assertioni fail | 22 pass, xfail emas |
| Scope check | yaratildi | pass |

Yakuniy backend full run: 57.59s. Yakuniy frontend full run: 43009.520333ms. Oldingi oraliq backend runidagi 6207 pass soni to‘liq bank tengligi qayta qat’iy tekshirilishidan oldingi holat edi. Yakuniy natijada ushbu nomuvofiqlik yashirilmagan.

### Qolgan real fail testlari

| Test | Tashxis va nega tegilmadi |
|---|---|
| backend `test_study_plan_level::test_in_app_bank_stays_identical_to_landing_reference` | Public Q massivi 45, canonical bank 150. Umumiy 45 savolning matn/variant/javobi mos, ammo bu butun bank tengligini anglatmaydi. Test faqat umumiy qism bilan yumshatilmadi. Savol bankini kengaytirish landing mazmuni/behavior chegarasiga zid. |
| frontend `hover-system::first-party site assets do not branch on the system motion preference` | Landing tuzatildi, lekin sequence.css media bloki CSS freeze ichida. Unmodified test fail. |
| frontend `phase1-design` — student, teacher, admin, owner navigation testlari, 4 ta | `ModuleEmoji` uchun `leaderboard` mark yo‘q, `marks[kind] is not a function`. Glyph yoki boshqa renderer qo‘shish boshqa sahifa markupini o‘zgartiradi; D2 faqat headline font va no-JS fallbackni ruxsat qiladi. |

### Baseline’dagi har bir backend xatosi tasnifi

| Baseline failure/guruh | Tur | Amal |
|---|---|---|
| article_progress completion | stale fixture | Receive channel yo‘q edi; endpoint endi answers evidence talab qiladi. Haqiqiy receive body, valid answers va coin boundary mock qo‘shildi. Production Reading kodi o‘zgarmadi. |
| coin short media | real/egasi qarori | `short=True` 5 minutdan oldin yuzaga keladi. Payout mantiqi saqlandi; strict xfail, quyida savol. |
| guardian full ID directory | stale assertion | Directory endi username/phone ko‘rsatadi; full ID authorized detailda saqlanganini tekshirish yangilandi. |
| 2 ta live_classes real TCP testi | environment | TCP bind PermissionError uchun aniq xfail; oddiy CI muhitida testlar ishlaydi. |
| migration_phase2 + step17/20/21/22/23_219/23_230/26/31/40 route inventory testlari | stale assertion | Historic 345 va amaldagi 421 aralashgan. Yangi hint route bilan current snapshot 422; exact method/path/name va historic inclusion saqlanadi. |
| public_seo | real task D + stale assertion | Generated semantic fallback va kuchli no-DB SEO assertions. |
| python_native_build docker-assets-stage | environment | Root rollup o‘rnatilmagan edi. Cached root npm ci’dan keyin real Docker-stage emulation testi o‘tdi. |
| riwi schema catalog | stale assertion | Drizzle SQL fayllari 82 emas 84. Aniq ikki yangi filename bilan inventory yangilandi. Bu test haqiqiy Postgres serverini ishlatmaydi, source catalogni tekshiradi. |
| step12 directory | stale fixture | Real SQL select qiladigan username fixtureda yo‘q edi; qo‘shildi. |
| step31_release_invariants va step40 migration hashes | stale additions + real history finding | Original auditdagi hashlar saqlangan. Yangi migration nomlari/bytes alohida snapshotda aniq belgilandi. Tarixdagi modifikatsiyalar quyida yashirilmasdan berilgan. |
| study_plan_level landing reference | stale path + real data mismatch | Deleted premium-landing reference olib tashlandi, hozirgi inline source parse qilinadi. To‘liq 45/150 nomuvofiqligi real fail. |
| 20 ta coin integration setup error | environment | Disposable Postgres:55439 ulanishi yo‘q. Faqat OSError holatida xfail; CI’da bunday xfailga o‘tilmaydi. |

### Baseline’dagi har bir frontend xatosi tasnifi

| Baseline failure/guruh | Tur | Amal |
|---|---|---|
| account onboarding 8/6 | stale | Amaldagi 6 field va locale payload kontrakti tekshiriladi. |
| dashboard streaming va owner companion, 2 ta | stale | Companion hozir dekorativ, havola emas. Mavjud DOM kontraktiga testlar moslandi. |
| grammar filtering/retry/abort, 3 ta | harness | Node AbortSignal jsdom EventTarget’iga berilgan. Fixture dom.window.AbortController’dan foydalanadi. |
| motion | real | Landing tuzatildi; qolgan CSS cheklovi yuqorida. |
| navigation, 4 role | real | Missing leaderboard mark. D2 sabab qoldi. |
| utilities focus | stale | Bir xil pathname’da query o‘zgarsa Focus saqlanadi, boshqa pathname’da reset tekshiriladi. |
| InstantLink timers, 2 ta | stale | Yangi grammar warm timeri qo‘shilgan; idle timerlar soni 2. Cancel va no-import checks saqlangan. |
| Reading intro palette | stale | Approved `3ef29c997` commit Day/Night palitrasini ataylab yoqqan. Oq rang assertioni site paper tokenini meros olish assertioniga almashtirildi; 4.5 contrast va barcha 4 theme/focus kombinatsiya tekshiruvlari saqlandi. |
| ICE restart | harness | Signalling ready handshake fixtureda yo‘q edi. Socket ready xabari berilgach restart yuborilishi tekshiriladi. |
| staff 38-route scope extras | stale | study-plans qo‘shilgan extra route ro‘yxatda aniq ko‘rsatiladi. |
| study-plans V4 table missing | real bug | Allaqachon yozilgan route dispatch va static allow-listga ulanmagan edi; ikkala jadvalga ulandi. |
| people admin detail | stale | Admin havolasi academic detail emas, allaqachon authorized plan-only entry ekanligi tasdiqlandi. Staff account havolalari yopiq qoladi. |
| staff 37/38 | stale | Actual 38 va uniqueness tekshiruvi. |
| student detail roles | stale | `6b74bbc61` ataylab admin plan-only wrapper qo‘shgan. Runtime test admin faqat bitta staff plan endpointini chaqirishi va full academic review ochmasligini isbotlaydi; owner/teacher full renderer delegation saqlandi. |
| profile currentBand | stale | Amaldagi formda bu field yo‘q; mavjud PATCH kontrakti tekshiriladi. |

Reading/admin testlari bo‘yicha tekshirilgan manbalar:

- [Day/Night palitrasini ataylab yoqqan commit](https://github.com/N-Muhammadjonov/learners_area/commit/3ef29c9974d032bea9faa229292efe80bb06f669).
- [Admin uchun plan-only entry commiti](https://github.com/N-Muhammadjonov/learners_area/commit/6b74bbc61a3d5f9cc438fb6aa621e5732e5a7ee3).
- Ushbu uchta assertion yangilangach focused run: 38 pass. Reading frontend/backend kodi va CSS fayllari o‘zgarmadi. Admin faqat plan view olishi runtime testda, academic endpointlar esa mavjud server authorization testlarida tekshirildi.

## Har bir xfail va sababi

20 ta Postgres xfaili — faqat disposable localhost baza unavailable holatiga tegishli. 2 ta test uchun TCP listener taqiqlangan. 1 ta coin testiga promptdagi maxsus ruxsat asosida strict xfail qo‘yildi. Hech qaysi Reading yoki motion real xatosi xfail qilinmadi.

- `tests/test_coin_economy_integration.py::test_private_schema_and_single_daily_claim`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_repeating_seven_day_cycle_and_reset_after_gap`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_telegram_invite_requires_new_active_student_and_pays_once`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_gift_purchases_are_atomic_idempotent_and_cannot_overdraw`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_all_active_roles_can_claim_daily_and_shop`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_owner_rejects_order_once_and_refunds_exact_coins`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_nonowner_cannot_resolve_or_view_other_orders`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_economy_integration.py::test_owner_receipt_has_buyer_telegram_link_but_other_roles_have_no_access`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_migration_is_idempotent_and_private`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_partial_complete_and_duplicate_rewards[listening]`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_partial_complete_and_duplicate_rewards[reading]`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_partial_complete_and_duplicate_rewards[articles]`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_twenty_parallel_submissions_create_one_reward`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_course_sync_never_backfills_completed_activities`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_grammar_fabricated_options_and_unverified_speech_pay_zero`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_real_media_clock_replay_and_parallel_sessions`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_short_media_never_pays_before_five_minutes`: Owner decision required: short-media milestone currently becomes payable before five minutes; payout behavior is unchanged
- `tests/test_coin_production_safety.py::test_pre_policy_completions_cannot_be_replayed_for_coins[reading]`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_pre_policy_completions_cannot_be_replayed_for_coins[listening]`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_pre_policy_completions_cannot_be_replayed_for_coins[articles]`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_coin_production_safety.py::test_wallet_and_leaderboard_minimal_api_smoke`: Disposable Postgres at 127.0.0.1:55439 unavailable: PermissionError
- `tests/test_live_classes_system.py::test_step8_100_real_tcp_websocket_clients_against_running_fastapi_server`: Sandbox denies local TCP listener creation
- `tests/test_live_classes_system.py::test_task4_two_separate_os_worker_processes_chat_recovery`: Sandbox denies local TCP listener creation

Frontenddagi 12 skipdan 11 tasi baseline’da ham bor edi. Yangi computed-animation browser testi Chrome/TCP sandbox cheklovi sabab aniq skip reason bilan berilgan. Static CSS/DOM/reveal testlari real ishladi.

## Yuklama oldin/keyin

Bu jadvallar muvaffaqiyatsiz ulanishlarning natijasidir. Ilova throughputi yoki login muvaffaqiyati o‘lchanmadi. Mahalliy authenticated user cookie’lari berilmagan, real akkauntlar/baza ishlatilmadi. `--reset-rates` ishlatilmadi, chunki disposable DBga kirish yo‘q; real `api_rate_buckets`ga tegilmadi.

### before

| So‘rov | Parallel | HTTP natija | Ulanish xatosi | Median/p95, ms |
|---|---:|---|---:|---|
| `/` | 30 | HTTP javob yo‘q | 30 | 1.23 / 2.38 |
| `/api/auth/login` | 30 | HTTP javob yo‘q | 30 | 1.18 / 2.32 |
| `/api/frontend/session` | — | skipped: mahalliy authenticated cookie yo‘q | — | — |
| `/api/frontend/view?route=/app&region=dashboard` | — | skipped: mahalliy authenticated cookie yo‘q | — | — |

### after

| So‘rov | Parallel | HTTP natija | Ulanish xatosi | Median/p95, ms |
|---|---:|---|---:|---|
| `/` | 30 | HTTP javob yo‘q | 30 | 1.03 / 2.0 |
| `/api/auth/login` | 30 | HTTP javob yo‘q | 30 | 1.17 / 2.26 |
| `/api/frontend/session` | — | skipped: mahalliy authenticated cookie yo‘q | — | — |
| `/api/frontend/view?route=/app&region=dashboard` | — | skipped: mahalliy authenticated cookie yo‘q | — | — |


Skript faqat loopback hostni qabul qiladi. `CookieJar(unsafe=True)`, POST Origin=Host origin va dashboard region parametri bor. `--reset-rates` faqat `CAPACITY_DATABASE_URL`dagi local `coin_qa` yoki `capacity_*` disposable bazada ishlaydi. Bcrypt va DB bilan haqiqiy before/after tajriba ushbu cheklov olib tashlangan muhitda qayta bajarilishi kerak.

## Migration tarixi va real bazaga tegilmagan topilma

Original MIGRATION_AUDIT_260/265 manifestlaridagi bazaviy SQL hashlar aynan mos. Biroq Git tarixida keyinroq qo‘shilgan migration fayllari tahrirlangan:

- `81d2eca1c52647f591d244dfcf6d028f4cabe7da`: `0086_study_plan_30_sequence.sql`ga 26 satr qo‘shilgan.
- `cc5a528e0cb030753aaade17f4632a02e848b47b`: `0092_coin_gift_fulfillment.sql` constraint tuzatishlari.
- `ea85fe4e085f2c741f004239ef2c9a4cc53cef16`: o‘sha `0092`da dollar-quoted SQL bloklari tuzatilgan.

Bular source history topilmalari. Qaysi versiya qachon productionda qo‘llangani tekshirilmadi. Bu branch hech qanday migration yaratmadi, mavjud migrationni tahrirlamadi va real DBga SQL bajarmadi. Hashlarni yangilab, bu tarix yo‘q deb ko‘rsatilmagan.

Qo‘shimcha source risk: `0086_study_plan_30_sequence.sql`da level-check correct uchun `0..15` constraint bor, amaldagi QUESTION_COUNT esa 17. Haqiqiy production catalogi tekshirilmagan; yangi forward migration qat’iy scope tashqarisida. Hint importi bu constraintli jadvalga yangi result yozmaydi.

## Egasi qaror qilishi kerak

1. Coin `short` milestone: 5 minutdan qisqa media uchun oldingi 90%/short reward maqsadlimi yoki 5 minutdan oldin umuman reward bo‘lmasligi kerakmi? Payout kodiga tegilmadi.
2. login_ip: unverified proxy peer uchun umumiy 40/900s bucket maqsadlimi? `RATE_LIMIT_LOGIN_IP` override faqat o‘lchangan cheklangan qiymat bilan; header trustni avtomatik kengaytirish yo‘q.
3. Production AUTH_SECRET uzunligi: bu ish uni o‘qimadi. 16-char minimum saqlanadi; yangi sozlash uchun >=32 random chars. Rotatsiya sessiyalarni bekor qiladi va bu ishda bajarilmadi.
4. Migration immutability: yuqoridagi main tarixidagi 0086/0092 modifikatsiyalarining release/DB holatini alohida tasdiqlash; kerak bo‘lsa alohida forward-only migration topshirig‘i. Hozirgi 15/17 constraint farqini ham shu scope’da tekshirish.
5. Public/in-app bank: 45/150 farqini haqiqiy tenglikka keltirish uchun public savollar poolini kengaytirishga ruxsat berish yoki tenglik talabi aynan umumiy public subset ekanini aniqlashtirish. Hozirgi qat’iy test qizil saqlangan.
6. CSS/Reading/UI freeze: sequence.css media bloki va missing leaderboard markni tuzatish uchun aniq scope istisnosi kerak. Reading palitrasi hamda admin plan-only entry bo‘yicha testlar Git tarixi bilan tasdiqlangan amaldagi behaviorga moslandi; product kodi yoki server ruxsati o‘zgarmadi.
7. Font: Latin va latin-extni qamrab oladigan Bricolage WOFF2 va OFL fayllarini olish imkonini yaratish. Shundan keyin self-host va haqiqiy browser font-load/CSP tekshiruvi. [Rasmiy font katalogi](https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque).
8. Browser/TCP/Postgres cheklovi bo‘lmagan test muhiti: pixel equivalence, CTA origin, font load va real capacity dalillari. is_https()/postMessage o‘zgarishi shundan oldin qilinmaydi.
9. Tayyor mahalliy kod va rasmlarni aynan `N-Muhammadjonov/learners_area` public reposidagi `fix/stability-seo-pass-20261114` branchiga yuklash uchun alohida tasdiq. Bu ehtiyoj avtomatik approval review rad javobidan kelgan; kod main’ga yuborilmaydi.

## Tekshiruv buyruqlari

Load probe uchun dev dependency zarur bo‘lsa: `python3 -m pip install -r services/backend/requirements-dev.txt -r scripts/loadtest/requirements.txt`. Bu yangi runtime dependency emas. Quyidagi test/build buyruqlari hisobotdagi natijalar bilan real bajarilgan.

```sh
bash scripts/scope_check.sh
python3 scripts/build_native_assets.py
(cd services/backend && python3 -m pytest -q -ra)
(cd frontend/vanilla && npm test)
node --test frontend/vanilla/tests/landing-stability.test.mjs frontend/vanilla/tests/landing-inline-auth.test.mjs frontend/vanilla/tests/public-level-hint.test.mjs frontend/vanilla/tests/login-busy-retry.test.mjs
python3 scripts/loadtest/capacity.py --phase before
python3 scripts/loadtest/capacity.py --phase after
node --check scripts/visual_check.mjs
```

Browser ochilishi ruxsat etilgan muhitda (bu yerda muvaffaqiyatli bajarilmadi):

```sh
VISUAL_OUTPUT=../visual-baseline node scripts/visual_check.mjs
VISUAL_OUTPUT=../visual-after VISUAL_BASELINE=../visual-baseline node scripts/visual_check.mjs
VISUAL_EVIDENCE=../visual-after/evidence.json node --test frontend/vanilla/tests/landing-stability.test.mjs
```

## Asosiy o‘zgarish joylari

- `frontend/vanilla/modules/landing-inline.js`: motion, original rasm URLlari, raw answer payload.
- `frontend/vanilla/modules/auth/public.js`: route-only dynamic import, nonce/abort checks va loadgacha semantic fallback.
- `frontend/vanilla/index.html`, `scripts/build_native_assets.py`: bir manbali statik landing va matching FAQ JSON-LD.
- `frontend/vanilla/js/public-level-hint.js`, auth/session hooklar: jim va navigationdan mustaqil hint consume.
- `services/backend/app/study_plan_level.py`, `study_plan_level_port.py`: server regrade va guarded one-time import.
- `services/backend/app/request_lifecycle.py`, `db.py`, `live_classes_port.py`: alohida bcrypt slotlari, acquire wait logging, bounded cache.
- `frontend/vanilla/js/api-client.js`: faqat login POST uchun cheklangan Retry-After retry.
- `services/backend/app/step18_telegram_auth_port.py`, `browser_video.py`, `security.py`, `main.py`: origin va startup warninglar.
- `.github/workflows/ci.yml`, `cefr-diagnostic.yml`: full CI va amaldagi landing source reference.
- `docs/RATE-LIMIT-DEPLOYMENT-BOUNDARY.md`, `docs/CAPACITY-BOUNDARIES.md`: operator sozlamalari va real cheklovlar.
