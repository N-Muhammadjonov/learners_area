# RIWI step 08: preserve finalized browser transcripts

Base: `ce282f09ebc50071b18c9b54933e532d11feb2d5` on `arena/01a10bac-learners-area`.
Source group: C01 in the remaining-work execution prompt.

## Reproduction and change

Before the fix, five of six lifecycle regressions failed: Stop detached result handlers before the browser could deliver final text, repeated result snapshots duplicated finals, stale callbacks could change a new recording, natural end retained handlers, and Stop had no finalization deadline.

The recognition hook now returns a shared asynchronous Stop result. It keeps handlers attached until end/error, with a two-second deadline. Stop timeout/error preserves finalized text, aborts recognition and detaches handlers. Reset and unmount settle pending finalization and ignore callbacks from an old recognizer. Whole browser result snapshots replace interim results and prevent duplicate finals. Constructor/start failure, permission errors, no-speech end and unsupported recognition stay bounded and retryable.

The recorder stops audio immediately in parallel with STT finalization and releases the audio track. Its stopping state prevents transcript editing until the finalized result is available. The review receives the same final text as raw and editable transcript; interim text is not silently relabelled as a final raw source. No upload, evaluation or submission occurs on Stop. Playback URLs are revoked on unmount; missing audio returns safely to idle.

## Verification

- Original lifecycle RED run: six tests, one passed and five failed.
- Final lifecycle/integrated recorder suite: seven passed, zero failures/skips. The integrated test checks immediate audio stop/track release, late final review, editable transcript, playback URL cleanup, and absence of implicit upload/submit.
- Complete UI suite: 241 passed, zero failures/skips.
- Speaking backend suites: 25 passed, zero failures/skips.
- Typecheck, lint, production build and diff checks passed locally.

The handoff script reruns the complete backend suite, UI suite, typecheck, lint and build before commit and push. Publication is pending until the resulting remote SHA and changed blobs are verified.

## Progress and boundaries

`RIWI-REMAINING-PROMPT-PROGRESS.json` records the 34 original R/B/C/D groups and the source prompt hash. Equal-weight full-group closure at the verified base is 2/34 = 5.88%; partial groups receive no full-group credit. This does not measure already-existing platform functionality or development effort. B07 and D01 have closure evidence. C01 has this code/QA checkpoint pending publication; live desktop/mobile microphone/browser acceptance remains under C09. Global RIWI and website percentages have no reconciled evidence denominator and remain undetermined.

Microphone permission cancellation and the wider recorder lifecycle in C02 remain a separate task. Real browser speech-recognition availability/accuracy, private storage, live provider feedback and deployment acceptance are not established by JSDOM fixtures.
