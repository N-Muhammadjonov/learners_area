# Speak or Die — implementation va qabul

Sana: 2026-11-10, Asia/Tashkent. Starting arena: `2c0278e054abe1be162233a87be81a149979822f`. Read-only main: `0bba91d3414c21ca4c8d91b346a37694b5bf65d5`. Starting comparison: arena ahead 90 / behind 4, diverged. Arena asosida ishlangan. Main merge/rebase/import qilinmagan.

Oldingi bo‘limda mikrofon signali bilan boshqariladigan game engine bo‘lmagan, robot esa umumiy hub va Practice intro’da dekorativ joylashgan edi. Yangi o‘yin alohida state machine, lokal audio input va stable DOM bilan amalga oshirildi.

## 12 komponent

| N | Component | Previous | Implemented | Files | Unit QA | Browser QA | Status |
|---|---|---|---|---|---|---|---|
| 1 | Speaking hub card | AI examiner | Speak or Die → canonical lazy route; EN/UZ | hub.js, generated/views/speaking.js, routes.js, i18n | Hub/routing fixture PASS | Egada | Implemented |
| 2 | Mascot placement | Hub + Practice intro | Faqat game arena; original SVG va unique ID saqlangan | hub.js, practice.js, mascot.js, fluency-art.js | Placement/identity PASS | Egada | Implemented |
| 3 | Game arena | Yo‘q | Dark arena, floor, waveform, original hazard va LA robot | fluency-art.js, fluency-game.css | Stable DOM, live sample projection PASS | Egada | Implemented |
| 4 | Danger physics | Yo‘q | Silence → forward; speech → freeze; normalized collision | fluency-engine.js | Grace, collision, no reversal, event ordering PASS | Egada | Implemented |
| 5 | Microphone VAD | Game yo‘q | User gesture → getUserMedia + AudioContext + local analyser | voice-activity.js | Noise/RMS/hysteresis/permission/cleanup PASS | Egada; real hardware NOT VERIFIED | Implemented |
| 6 | Difficulty | Yo‘q | Beginner / Intermediate / Advanced fizikasi va keyboard selection | engine, controller, CSS | Real config/selection PASS | Egada | Implemented |
| 7 | Timer | Yo‘q | Monotonic 60s; background/interruption pause | engine, controller | Fake monotonic clock, no 60s wall wait PASS | Egada | Implemented |
| 8 | Questions | Existing bank | Bounded published/authorized GET; anti-repeat, Part 3 preferred | fluency-questions.js, browser_speaking.py | Fixture + real isolated API PASS | Egada | Implemented |
| 9 | Win/Loss | Yo‘q | Actual elapsed result, replay/new question/change level | controller, engine | Win/loss/replay PASS | Egada | Implemented |
| 10 | Cleanup | Yo‘q | Final state, quit, route abort, pagehide, stale permission cleanup | controller, voice input | Track stop/context close/RAF cancellation PASS | Egada | Implemented |
| 11 | Mobile UI | Yo‘q | Scoped 1/3-column levels, proportional actor track, Day/Night/reduced motion | fluency-game.css | Markup/control contracts PASS | Actual layout/screenshots NOT VERIFIED | Implemented; owner visual QA |
| 12 | Regression | Existing Speaking | Old AI deeplink, recorder, history, Lessons, Partner va practice saqlangan | Scoped diff; unrelated sources unchanged | Full frontend/backend + owned API PASS | Egada | Preserved; owner QA |

## Lifecycle va privacy

Phases: idle → requesting_permission → calibrating → ready → running → won/lost; running/preparation → paused → explicit microphone reacquisition/calibration → running. Quit/error tozalashdan keyin qayta boshlanishi mumkin. Terminal round stale frame yoki eski async callback bilan qayta yurmaydi.

Har final/abort holatida tracks stop, source/analyser disconnect, AudioContext.close, RAF cancellation, pending GET abort va listener cleanup chaqiriladi. Permission javobsiz qolsa 30 soniyalik timeout, keyin berilgan stream ham to‘xtatiladi. 400 ms’dan katta sample gap unfair loss o‘rniga pause beradi. Pause davrida mic yopiladi. Resume yangi user gesture bilan ochadi. Real hardware cleanup qabuli egada.

Game MediaRecorder, upload, STT/LLM yoki scoring endpoint ishlatmaydi. Audio buffer faqat xotirada qisqa vaqtli energiya/waveform hisoblash uchun. Natija, ovoz, transcript va difficulty localStorage yoki serverga yozilmaydi. Speaking attempt yaratilmaydi. Mavjud Vocabulary reward ledger topildi, ammo Speak or Die earning policy topilmadi. Shu sabab coin/star/points berilmaydi va berilgandek ko‘rsatilmaydi.

## Source va qayta ishlab chiqilgan qiymatlar

Mentora PDF 25–26-sahifalarida intro, dark arena, chapdagi tishli disk, o‘ngdagi mascot, markazdagi waveform, uch difficulty va Start kompozitsiyasi ko‘rildi. Alohida ZIP va to‘rt screenshot topilmadi. ZIP chunklari yoki Mentora engine/VAD parametrlari bu sessiyada tekshirilgani da’vo qilinmaydi. Minified Mentora kodi yoki uning assetlari nusxalanmadi.

60 soniya, silence advances/speech freezes/no reversal, uch level va win/loss qoidalari foydalanuvchi topshirig‘idan. Quyidagi qiymatlar mustaqil LA tuning, asl Mentora parametrlari emas:

| Level | Grace ms | Danger / second | Activation ms | Release ms | Sensitivity |
|---|---:|---:|---:|---:|---:|
| Beginner | 2100 | 0.045 | 80 | 320 | 1.15 |
| Intermediate | 1100 | 0.075 | 110 | 260 | 1.00 |
| Advanced | 450 | 0.120 | 130 | 210 | 0.95 |

Collision progress 1.0. To‘liq jimlikda kutilgan collision: taxminan 24.322 / 14.433 / 8.783 soniya. Screenshotdagi 8 soniya hardcode qilinmagan. Timer/collision qaysi biri oldin yuz bersa o‘sha natija, aniq tenglikda collision ustuvor.

VAD: 1024 PCM samples, DC-removed RMS, 1200 ms va kamida 12 sample calibration, 60th-percentile noise floor, 65 ms smoothing, max(0.007, floor×2.8)/sensitivity onset, 0.6 release ratio va 5000 ms quiet-floor adaptation. Floor >0.045 bo‘lsa too_noisy, butunlay zero input bo‘lsa no_signal. Bu semantic speech recognition emas; boshqa tovushlar ham faollashtirishi mumkin. UI buni aniq aytadi.

Question source: `/api/speaking/practice/questions?part=part3&channel=practice_alone`. Bir sahifa ko‘pi bilan 100 prompt; bo‘sh bo‘lsa Part 2, so‘ng Part 1. Faqat endpoint qaytargan source text ishlatiladi. Shu scoped xotiradagi savollar qayta takrorlanishi kamaytiriladi; bitta savol bo‘lsa doimo yangi savol borligi va’da qilinmaydi. AI provider talab qilinmaydi.

## Tekshiruv va qolgan qabul

Yakuniy aniq PASS/FAIL/SKIP sonlari, commandlar, Git SHA va yagona preview holati delivered report hamda QA paketida. Barcha joriy avtomatik FAIL tuzatiladi va final pushdan oldin tekshiriladi. Real browser, audio, mic, Safari, device, responsive layout va screenshot qabulini foydalanuvchi avvalgi ko‘rsatmasiga binoan o‘zi bajaradi. `01-owner-manual-qa.md` topshirish ro‘yxati.

Faqat arena kod/test/QA fayllari push qilinadi. O‘quv materiallari main’da qoladi. Schema/migration, environment, R2, Worker yoki production konfiguratsiyasi o‘zgarmagan. Git integration final arena pushdan bitta preview yaratishi mumkin; alohida deploy/redeploy/production promotion qilinmaydi. Shu vazifa tugagach keyingi bosqich boshlanmaydi.

API reference: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia ; https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume ; https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData .
