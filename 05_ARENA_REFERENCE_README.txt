CURRENT UPDATE2026-10-01
========================
The latest persistent package is arena-package/2026-10-01/. Read its ARENA_RESUME_2026-10-01.md first.
It contains the exact23-file patch, v2full requirements,63-page screenshot PDF and SHA256manifest.
Current owner request supersedes historical font/branch/Part1STOP rules below. Product baseline is dd23e0a.
No application code was changed by this artifact upload.

LEARNERS AREA - ARENA REFERENCE PACK
====================================

This pack is intentionally NOT a ZIP.
Every file is individually uploadable and below Arena's 25 MB file limit.

The owner already has the V4.2 MASTER prompt.
Upload that MASTER prompt separately.

SOURCE PRIORITY
---------------
When sources disagree, use this order:

1. V4.2 MASTER prompt
2. Exact hardened Learners Area repository state / current phase starting SHA
3. Current phase execution prompt (for phase-specific clarification)
4. Owner-supplied screenshot PDF
5. Speaking master bank machine-readable data
6. Owner-supplied reference-code extract
7. Public reference websites
8. Your assumptions

Never copy third-party branding, copyrighted assets, or proprietary source code wholesale.
Use third-party material only to understand interaction/product patterns and reimplement cleanly in Learners Area.

FILES
-----

01_ARENA_PART_01_PREVIEW_STABILIZATION.txt
- Execute this NOW for Arena Part 1.
- Stabilization only.
- Starts from exact Final QA 2 SHA:
  300970040bc6a56ec55db50c9a1f551377e8ae66
- Must STOP after Part 1 is committed, pushed, and reported.

02_arena_visual_reference_screenshots.pdf
- 31-page PDF.
- Contains the owner's manual Preview QA screenshots/product references plus the earlier Speaking visual references.
- Use together with MASTER prompt; screenshots do not override explicit written requirements.

03_ieltsmaterials_frontend_reference_extract.txt
- Plain-text extraction from the owner-supplied ieltsmaterials.uz frontend reference archive.
- Includes useful menu/responsive/progress/audio/AI/partner patterns.
- Reference only; do not copy branding/assets/code wholesale.

04_speaking_master_bank_880.jsonl
- Learners Area canonical Speaking question-bank dataset.
- 880 rows total.
- Intended later for Speaking Practice + Live Partner shared-bank phase.
- Do not import during Part 1.
- Verify counts/idempotency again before the later import phase.

PUBLIC REFERENCE WEBSITES
-------------------------
Arena should inspect the live/public versions itself when relevant:

IELTS Booster:
https://ieltsbooster.uz/
https://ieltsbooster.uz/info8/

Use especially for publicly visible examples of module/training structure such as Listening training stages, Question Types, MCQ Mastery, Retention-style learning ideas, and overall product interaction patterns.

IELTS Materials:
https://ieltsmaterials.uz/

Use especially for public IELTS-style Reading/Listening/Speaking environment and interaction references.

Rules:
- use public pages only
- do not bypass login/paywalls/access controls
- do not clone branding
- do not assume current live behaviour without checking it
- where a supplied screenshot shows gated/internal interaction unavailable publicly, use the screenshot as the visual reference

PART 1 UPLOAD ORDER
-------------------
For the first Arena session upload:

1. V4.2 MASTER prompt (owner already has this)
2. 01_ARENA_PART_01_PREVIEW_STABILIZATION.txt
3. 02_arena_visual_reference_screenshots.pdf
4. 03_ieltsmaterials_frontend_reference_extract.txt
5. 05_ARENA_REFERENCE_README.txt

04_speaking_master_bank_880.jsonl is NOT needed for Part 1.
Keep it for the later Speaking execution phase to reduce noise/context load.

IMPORTANT PART 1 RULE
---------------------
Part 1 must NOT begin Retention V2, new Listening modules, Google auth, Speaking redesign, or Live Partner.
It must first stabilize Preview/runtime/database/navigation issues, commit, push, report exact final SHA, and STOP.

PRODUCTION SAFETY
-----------------
The current hardened baseline includes migration 0020, but production has not been migrated to it.
No Arena phase may silently mutate production DB, merge main, or deploy production without explicit owner approval.

