# Listening implementation and TED follow-up — 2026-10-01

Status: PARTIAL. Code and automated checks do not certify Preview import, playback or publication.

## Implemented

- Native Next.js library, 4/3/2/1-column responsive grid, bounded 100-row pages, real completed-activity counts; category controls do not manufacture section-only materials.
- One parent Full Listening test and exactly five activity routes. Only a server-confirmed completed exam unlocks activities 2–5.
- ZIP import reads JSON literals from the five supplied HTML files, never executes their scripts or injects their HTML. Worker decompression, filename/count/expanded-size limits, duplicate filename refusal. Audio is probed in the browser and uploaded once through the existing private, owned upload-intent flow; map uses its own claimed image intent.
- Atomic draft import, source-ID uniqueness and concurrent-conflict handling. Upload intents must be finalised, owned, unattached and the correct purpose/type. Existing authenticated resource delivery remains authoritative.
- Native exam receives prompts/options only, no answer keys, explanations, transcript or vocabulary. One-speed audio UI, volume/fullscreen, question navigation, answer retention, local/server drafts, confirmation before immutable grading. Paired answers can swap but repeated letters cannot earn two marks.
- Review displays actual submitted answers and authored explanations, canonical audio moments, full supplied transcript, shared contextual vocabulary lookup; nested graded speed training (1, 1.25, 1.5, 1.75, 2; server-side 80% prerequisite) and existing MCQ training.
- Keyword I asked/heard comparison and authored-model checking; Keyword II heard-first meaning choice; vocabulary study/quiz and scoped saves. Vocabulary client receives no main-audio URL and mounts no audio element.
- Owner/source/activity-scoped tab drafts restore after leaving a practice route. Explicit saves write real server history. Automatic server saves are currently implemented for the exam, not every practice activity.
- Legacy New Test upload now uses the current upload-intent protocol; new entries default to drafts. Legacy listening pages continue working before migration 0028; unavailable new import shows a notice before uploading files.
- Listening vocabulary source filtering happens in SQL before the limit, rather than taking an arbitrary first 200 entries from all tests.
- TED: removed the app-owned paragraph shown in the owner's screenshot. Direct licensed-media player gains fullscreen, including native Safari video fallback. Existing provider sandbox and origin validation remain intact.

## Actual source audit

The provided ZIP contains ONE test, Full Listening 10 (Volume 9–Test 1): 40 exam questions, 20 Keyword I items, 20 Keyword II items, 15 vocabulary items, one map, one 16,451,023-byte MP3. macOS afinfo independently estimates 1645.061224 seconds (27:25), mono, 44.1 kHz, 80 kbps; this is file metadata, not an auditory review. It does not contain ten independent tests.

All four supplied RTF transcripts were read. The second practice take in the Forensic Linguistics transcript was excluded from the derived transcript; the raw original was preserved outside the application. Dormancy and Survival has a truncated beginning/end and transcription inconsistencies, including the Q35 wording/key discrepancy. It is flagged for audio review and publication is blocked. No missing prose, timing offsets or answer evidence was invented.

The derived QA ZIP retains the source assets and adds data/transcript.json. It was NOT imported into Preview during this run. Passing a PGlite test against parsed source data is not a real upload or playback check.

## Validation

- Actual source parser and immutable grading exercised against the supplied ZIP, including named map choices, correct local instructions, choose-TWO option text, swapped answer positions and 40/40 canonical answers.
- Final root suite run twice: each run 695 tests, 665 passed, 0 failed, 30 skipped. PostgreSQL-dependent gates remain skipped without an isolated PostgreSQL database.
- Client UI suite: 102/102 passed, including failed submission retaining answers, zero main-media/API mount requests for vocabulary, local filters and owner-scoped draft restoration.
- Typecheck, lint with zero warnings, production build and retention schema verifier run locally. These are not browser evidence.
- Existing N13 source test updated because the owner explicitly removed the visible disclosure requirement; origin, sandbox, native captions and no-overlay assertions remain. Migration fixture adds coverage for the new additive migration; identity/history/backup guards remain.

## Outstanding acceptance work and dependencies

1. Preview database: migration journal previously has a gap at 0021; reconcile actual DDL with the journal before applying 0025–0028. No history reset, forged receipt, fabricated backup reference or force migration. The guarded script includes additive 0028 and verifies its three tables/speed column, while preserving URL/server fingerprint, production refusal, journal-prefix and backup gates. No Preview migration was applied here.
2. Import the derived QA ZIP using ONLY the owner's Preview QA account after migration; retain draft status. Verify upload, actual MP3 duration/section boundaries, all 40 questions and map, immutable submission, five activities and vocabulary network isolation. No synthetic local browser account is authorised.
3. Audio-review/correct all four transcripts against the actual recording, especially the incomplete fourth section and Q35, before publication. The native UI must not be certified against contradictory source content.
4. Two full real-browser acceptance passes at desktop/tablet/mobile widths, plus Safari fullscreen/captions and failure/back/refresh checks. Existing automated DOM tests do not establish rendering, actual audio/network timing, or real PostgreSQL concurrency.
5. Master-spec gaps: global multi-page search/overall progress (current search/progress is per page); independently authored section-only bank; all generic listening question types beyond this imported source; richer review accuracy/type/band and wrong-answer filters; per-activity automatic server draft saves; calibrated free-form Keyword I relation grading (currently exact authored model); stricter one-pass refresh/audio timeline enforcement. Current exam audio position is saved, but it is not tamper-proof playback enforcement.
6. YouTube embeds still show provider-native branding/Copy Link/recommendations. These cannot be honestly removed by the app's CSS or deprecated modestbranding parameter. No overlay is added. To provide only the owner's requested controls without provider branding, use an owner-authorised direct video file and captions on the configured media origin. Quality switching also needs real encoded renditions; the current direct source is a single file. Do not pretend a YouTube URL became a self-hosted video.
7. Older outstanding Part 1/2 gates are not closed by this Listening commit: paid-service credentials/infrastructure, actual two-user Live Partner audio, Google OAuth live checks, real PostgreSQL gates, full remaining-feature browser acceptance and approved content/publication/import work.

Reference for the embed limitation: https://developers.google.com/youtube/player_parameters (modestbranding is deprecated and has no effect).
