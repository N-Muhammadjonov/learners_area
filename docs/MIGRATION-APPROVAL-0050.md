# Migration approval — 0050 `lesson_learning_area`

Status: **reviewed, additive, hash-pinned, applied on the isolated QA2 PostgreSQL only.**
Owner approval of the *contract* was given on 2026-10-06 (the Listening Lesson semantic
correction); this document records what the migration does and how it was proven. It does
**not** authorise a Preview or Production apply — those still require the guarded
`scripts/preview-qa-migrate.mjs --plan` → backup → `--apply` flow with an owner decision.

## What it is

| # | statement | kind |
| --- | --- | --- |
| 1 | `ALTER TABLE lessons ADD COLUMN IF NOT EXISTS learning_area varchar(20)` | additive |
| 2 | `ALTER TABLE lessons ADD COLUMN IF NOT EXISTS teacher_notes text` | additive |
| 3 | `ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_learning_area_chk` + `ADD CONSTRAINT lessons_learning_area_chk CHECK (learning_area IS NULL OR learning_area IN (…7 areas…))` | constraint |
| 4 | `ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_teacher_notes_len_chk` + `ADD CONSTRAINT lessons_teacher_notes_len_chk CHECK (teacher_notes IS NULL OR (char_length(…) BETWEEN 1 AND 8000 AND btrim(…) <> ''))` | constraint |
| 5 | `CREATE INDEX IF NOT EXISTS lessons_learning_area_idx ON lessons (learning_area, publication_state, updated_at)` | index |
| 6 | `ALTER TYPE upload_block_kind ADD VALUE IF NOT EXISTS 'video'` | additive enum value |

No `UPDATE`, no `DELETE`, no `DROP COLUMN`, no `NOT NULL`, no backfill. **Existing lesson
rows are not classified.** `NULL` means "not classified yet", which is deliberately
different from the explicit choice `general`. No value is ever inferred from a title, a
slug, an audio block, an attached media item or a course — the repository holds no
unambiguous mapping from those facts to a subject, and manufacturing one would create
exactly the false classification the column exists to prevent.

`teacher_notes` is lesson metadata, independent of the media type; `video_lessons.notes`
keeps its own media meaning and is untouched (it stays a read-time compatibility fallback
that lesson-level notes always win over).

## Registration

* `drizzle/meta/_journal.json` — entry `idx: 50`, tag `0050_lesson_learning_area`,
  strictly-increasing `when`, one `breakpoints` marker per statement.
* `scripts/preview-qa-migrate.mjs` — tag added to `ALLOWED_PENDING`; SQL hash pinned in
  `APPROVED_INTEGRATION_SHA256`:
  `ff5d754833e804723c198ab3ebefb0553006ae47e7e6908c06757f3d5865089d`
  (re-pinned after the `upload_block_kind` statement was appended — a changed migration
  must never keep its old hash).
* Static guards: `tests/content-migration-journal.test.ts` (J1–J5, 51 entries) and
  `tests/preview-qa-migrate.test.ts` ("through 0039 leaves exactly 0040…0050 pending, all
  registered and hash-pinned"). A reviewed migration whose SQL differs from the pinned
  hash is refused by the planner, not silently applied.

## Proofs (real PostgreSQL, isolated local QA2 — never Preview/Production)

`scripts/qa2-lesson-learning-area-0050-upgrade.mjs` (`fresh` → `apply` → `verify`, and
`branch`). It applies the exact journal-ordered SQL files and refuses any target other
than `localhost/learners_qa2`.

| proof | result |
| --- | --- |
| fresh database through the real migrator (`npm run qa:pg`) | **51 / 51** migrations applied |
| 0049 → 0050 upgrade | 25 / 25 gates: both columns, both CHECKs and the index appear |
| historical data untouched | row-level md5 identical for every `lessons`, `video_lessons` and `upload_intents` row; **no row added, changed or deleted** |
| closed vocabulary | `listening` accepted; `listeningg` refused by the database; `NULL` still allowed |
| Teacher Notes bound | 8 000 accepted, 8 001 refused, blank refused, clearing stores `NULL` not `''` |
| media notes preserved | `video_lessons.notes` byte-identical after the migration |
| `upload_block_kind` | `{image, audio, video, file}` with the three old values intact; an existing `audio` intent row reads as `audio`; a new `video` intent row is accepted |
| idempotency | re-applying 0050 is a no-op and leaves the historical rows unchanged |
| integrated-branch upgrade | accepted **0039 → 0050** lands both columns; 51/51 journal rows applied exactly once |

Application-level compatibility is proven separately: old `{ blocks }`-only revisions stay
readable (`tests/listening-lessons.test.ts` L7, `tests/content-preview.test.ts` PV7 — the
preview falls back to the lesson row and states `source: "lesson_row"`), and the
built-server acceptance (`scripts/verify-lesson-learning-area.mjs`, 41/41) exercises the
four roles against the real HTTP surface.
