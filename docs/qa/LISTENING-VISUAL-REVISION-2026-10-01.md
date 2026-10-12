# Listening and visual revision — owner request 2026-10-01

Baseline: f6ec865dccfcd3c568c0c06e50bb67f3c129f1ed on arena/01a0f1a0-learners-area. No production DB changes.

## Actual inspected inputs

Downloaded Full Listening Test 1 HTML contains the same canonical question set as the supplied Full Listening 10 ZIP, but references a relative audio path. Do not invent or swap another recording based on its filename.
Keyword Match and Keyword Match 2 downloaded HTML files are byte-identical (SHA256 c3c8aaf57a41f6765e40882bc73bf7c58f76cfaefb6552e28a07e6c01d3e5bfd). They cannot supply two distinct exercises. The native package retains the genuinely different two activities from the actual source ZIP.
CDI Lis 47 is a separate exam layout with relative external scripts/assets and no inline audio source. It informs layout, not an executable import or a canonical source mapping.
The supplied library screenshot informs rounded cards, heavier headings and local category controls. No Booster branding/scripts/styles copied.
sharifjons.uz was viewed in an isolated browser: dark gradient, gold orbit, bold heading, capsule actions. Our original motion uses CSS transforms and reduced-motion fallbacks, without borrowed artwork, claims or animation libraries.

## Implemented in this revision

- Five-activity hub retained. Activity 1 now offers IELTS Exam and Controlled practice.
- Controlled practice has native play/pause/seek, 0.75–2x speed, four sections, prompts/options/transcripts with shared lexical popup, and source/owner scoped drafts.
- Practice check is authenticated, uses canonical server grading, refuses all-empty input, reveals keys only for answered questions and does not create IELTS attempts or unlock official exam progress.
- Optional Listening catalogue lookup reuses existing lexical enrichment, excludes user-provided meanings and declines ambiguous/unknown entries. Save uses the existing Vocabulary endpoint and canonical listening source. It does not promise every English word has a meaning in the current catalogue.
- IELTS mode retains no rewind/speed/word lookup and no pre-submit key.
- TED removes a completed iframe on authenticated-origin/source player-state evidence and replaces it with Replay. Forged messages are ignored. Native CC/quality/speed controls and popup/top-navigation sandbox remain.
- All audited sidebar root routes now have original module vector icons. Listening cards/actions have contextual symbols; display headings are heavier.
- Original lightweight landing motion. No new client animation dependency or extra landing media requests.
- Transparent edited mark variants, dark-origin for day, light-origin for night. Original six brand masters and original legacy derivatives preserved. New compact PNGs checked for real alpha and declared size. These image-edited cutouts are not asserted to be pixel-identical original resamples. Horizontal UI uses the transparent mark plus configured text.

## Actual boundaries; do not mark PASS

YouTube official parameters: https://developers.google.com/youtube/player_parameters . `modestbranding` is deprecated/no effect. `rel=0` limits recommendations to the same channel; it does not eliminate them. Native logo/Copy Link and pause overlays cannot all be removed by a supported embed parameter. This revision only replaces the completed frame; it does not conceal controls with an iframe overlay or falsely advertise a brandless embed. Fully custom/no-provider-brand playback requires an authorised direct video file and the existing direct-media player. No video was downloaded/rehosted from YouTube.

Preview native Listening import remains blocked until QA schema is safely migrated. Confirmed project bpexpsugmuhwmztacbqd. No usable Preview DATABASE_URL or verified backup reference available; migration journal has a 0021 gap requiring reconciliation. Do not fake a backup, bypass preview-qa-migrate guards or alter Production.

Actual source package contains ONE test with five activities, not ten independent tests. The derived QA ZIP with four supplied transcripts exists in outputs; it has not been uploaded to Preview. The owner's instruction to ignore transcript transcription mistakes for functional QA does not constitute audio/content review or publication approval.

Remaining detailed Listening work outside this revision includes real Preview import/exam/controlled-word-save/clip/browser checks, real PostgreSQL gates, strict refresh-resistant one-pass timeline enforcement, generic unsupported question families, semantic Keyword 1 grading, complete server drafts for every activity, and global rather than per-page library search. No 100% completion/performance claim.

## Test changes disclosed

Brand test theme expectations reversed to the owner's new requirement; six original assets/existence/filter prohibitions unchanged.
Library category test accepts its added decorative symbol while still asserting the category actually filters.
Welcome source checks accept whitespace/newlines introduced by formatting; still require one CTA, prefetch=false and the authoritative login/dashboard/pending destinations.
The popup wrapper's executed-case count increased from 15 to 17 for the two new cases; exit-status and all earlier assertions remain.
New runtime tests cover controlled audio/lexical UI, empty check, owner/source draft and failed-check recovery, genuine versus forged TED completion messages and replay, catalogue lookup/save and unknown-meaning handling. New asset test validates transparent compact variants.

## Validation (2026-10-02)

Final root suite: 696 total, 666 passed, 0 failed, 30 skipped (real PostgreSQL gates). Final client suite: 107 passed, 0 failed. Earlier full client run also passed 107/107; an earlier root run passed 666/696 before the additional lexical integration. Final typecheck, zero-warning lint, production build, whitespace check pass. Retention verifier 11/11. No skipped PostgreSQL gate is represented as passed.
Initial parallel run had environment-blocked local sockets, nested-test timeouts under resource contention, one new typographic apostrophe and then an obsolete wrapper count. Apostrophe/count fixed; sockets and timeouts passed on permitted reduced-concurrency rerun. No timeout threshold or behavioral assertion was weakened.
