# V11 source/state inventory — safely reimplemented, NOT recovered

Started from verified V10 9c62895674025159b4dcbab839bb1fb8f37348af after independently verified preservation of359 stale V4 files and a normal fast-forward. The lost V11 environment was NOT found. All runtime work remains native browser modules inside migration/vanilla-frontend. Original application/content/backend are read-only; no staff implementations integrated.

## Original Test 1 — separate gates for all nine activities

Each row remains **FRONTEND CODE PARTIAL**, **focused fixture verified**, **ORIGINAL BEHAVIOR PARTIAL**, **LIVE INTEGRATION UNVERIFIED**. Focused verification uses actual read-only original HTML and original adaptation hooks, with isolated synthetic server/media responses. It is not the original live application or protected recording. Comprehensive behavioral closures: **0/9**; navigation identities do not count as closures.

| Original activity | Focused actual-source evidence | Still needed for comprehensive closure |
|---|---|---|
| Full IELTS Test | Own input, flag, ephemeral notes, autosave, reload/resume, cancel submission; no score or study navigation until matching canonical40-row ACK; malformed/foreign feedback fails closed; manual retry and stale pending-outbox reload recover | All question types, full real-duration exam/review timers, real recording/transcript/seek mapping, all answer restrictions, exit/retake/race matrix, accessibility/live policy |
| Review & Revision | Original part4 selector and question controls | All parts, check/reveal/retry restrictions, own-answer restoration, media and full lifecycle |
| Script Completion | Source gaps, check, retry clearing | All transcript parts/timestamps, full progress/reload/error/keyboard journey |
| MCQ Mastery | Prediction survives reveal/choice rerender and reload; original source choices retained | All mastery rounds, stage/reveal gating, audio continuity, progress/error/reentry matrix |
| Map Mastery | Actual map SVG and map option controls; NOT renamed Matching | Every actual map interaction/check/retry, mapping, persistence and audio lifecycle |
| Choose TWO Mastery | Five genuine A–E buttons, two selections retained across reload with source closure restored | Check/reveal/retry across every group, all stage/media/progress/restriction states |
| Completion Mastery | Input and next/previous controls | All item interactions/check/retry, resume, media and error states |
| Vocabulary Builder | Original card list, practice mode and options | All cards, saved terms, pronunciation, exercises, restrictions, reload/error lifecycle |
| Retry Weak Areas | Original text/single-choice presentation retained; feedback now server-only; grouped A–E two-choice retry sends individual letters per missed question; already-correct paired letter locked (unit verified) | All question types, server failure/retry/race matrix on actual original UI, clip mapping, sustained navigation and live policy |

Evidence: evidence/v11/original-behavior-v11.json and original-focused-v11.json and original-outbox-v11.json; tests/browser-original-source-v11.mjs reads ORIGINAL_SOURCE_ROOT at test time. No material, protected audio, transcript or actual key is copied to this package.

## Shared and generic media

- Existing reviewed shared controller is subclassed, not replaced. Owns/removes18 audio listeners, bounds commands and capability reads, metadata-only preload, retains one controller across inner documents. Source `.src=` changes resolve registered authored paths to inert identities; child promises reject on pause/source change/timeout/pagehide.
- Generic uploads now use credentialed same-origin download=1 Range reads of at most256KiB, validated Content-Range/total/MIME/ETag, If-Range, cache/coalescing and disposal.401 revokes session;403/404/5xx and malformed/oversized responses fail visibly. One transient5xx retry;15s read deadline. Chunk bodies are size-bounded before caching.
- Supported single-decoder MP3 uses opaque-child MediaSource playback before the next withheld chunk arrives. Paused hub does not silently download the entire MP3: one initial chunk, bounded buffered lookahead while playing. Native buffered seek/pause/rate/reentry verified with encoded synthetic silence.
- Other containers, duplicate nodes and decoder failure use explicit Range acquisition → Blob fallback. **Fallback is not progressive. Universal media is NOT complete.** Stable full duration, arbitrary unbuffered/random seek, long/quota cases, every container/legacy/provider caller, Safari/user activation and actual expiry/revocation/provider integration still need acceptance. Encoded cache retains acquired chunks for the owned session; long-file aggregate-memory bounds need further engineering/verification.
- Exact sandbox=allow-scripts and opaque CSP preserved. No same-origin permission, network access or private capability URL in child. Parent owns authentication, URLs and cache; child owns/revokes object URLs and decoder listeners.

## Counts and scope

No full-route/component promotions: recomputed canonical statuses22/15/71 of108; components62/17/127 of206. Listening9/6/1 of16 routes and9/10/5 of24 components. Staff-owned author desk/library/actions are not learner CRUD. Reading not started. Earlier General/Academic/history/lessons/exam/review/Activities2–5 remain preserved rather than rebuilt.
