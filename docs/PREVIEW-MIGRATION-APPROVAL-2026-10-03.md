# Preview migration approval checkpoint — 2026-10-03

Preview migrations 0029–0035 applied after explicit owner approval and fresh recovery verification. No content write or Production mutation performed.

- DB fingerprint: `a4e4e19c00742afea56b97be5aa601262fe445ddcf5b8c758dbd686bde03bbfb`.
- Server identity: `d2ecefc6644a924472f61835fcd766aaed3fcbe493da5dcdb445241e8c0e9560`.
- Project reference: `bpexpsugmuhwmztacbqd`; pre-apply public/drizzle journal had 0000–0028 (29 rows); post-apply has 0000–0035 (36 rows).
- Read-only plan refused seven unapproved migrations as intended.
- Apply order must be 0029 → 0030 → 0031 → 0032 → 0033 → 0034 → 0035.

|Migration|Effect|Risk|
|---|---|---|
|0029_vocabulary_architecture|Lexical units/senses/forms/pronunciation/context; backfill 17 current lexemes; optional video occurrences|Additive schema plus data backfill; check existing duplicates/senses and preserve owner words|
|0030_general_reading|General Reading foundation tables|Additive; content still needs authoring|
|0031_writing_workspace|Native Writing workspace tables|Additive; table creation does not create a complete content library|
|0032_writing_exam_papers|Exam paper tables and optional relationship|Additive; preserve existing submissions|
|0033_writing_language_stealing|Resumable 7-stage sessions|Additive; no generated owner content|
|0034_typing_duration_presets|Nullable duration preset and allowed-value constraint|Additive; existing rows preserved; constraint verification required|
|0035_teacher_student_links|Explicit roster relation|Additive; must not infer access from former assignment history|

## Backup / recovery

The October 2 receipt was stale and was not used as current recovery evidence. A fresh native pg_dump snapshot was restored to isolated PGlite before apply, with all 75 application table counts matching. After the owner started an external local server, native PostgreSQL 18.4 restore was independently verified: 75 tables, 329 rows and 662 constraints match. Native restore occurred after apply; it does not alter the pre-apply evidence chronology. Public/drizzle scope excludes Supabase Auth/Storage and object storage. Strict TLS with official CA was retained.

## Owner approval

User request section 30 explicitly requires one owner approval. Approval sought: apply only these seven migrations to the fingerprinted Preview, after fresh recovery protection is verified. Approval received directly from the owner: “Tasdiqlayman”. Authorization is limited to pending 0029–0035 on this fingerprint and remains conditional on fresh verified recovery protection. After approval, safely update the apply allowlist (not the Drizzle journal), verify identity again, then schema/journal/data/roster checks and the eight Writing tabs. Production remains excluded.

## Execution receipt

Current backup: `docs/receipts/QA-backup-2026-10-03.json`; 75 application tables/329 rows restored to isolated PGlite; native PostgreSQL 18.4 restore independently verified afterward. Apply receipt: `docs/receipts/preview-qa-migrate-2026-10-03T10-36-09-697Z.json`; pending=[] and all schema checks pass. Browser admin Writing and all eight Writing tabs open after apply.
