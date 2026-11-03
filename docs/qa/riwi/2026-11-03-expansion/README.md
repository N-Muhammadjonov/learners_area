# RIWI study-library expansion acceptance — 2026-11-03

The two original-note packs are active in QA through the authenticated Safari
Owner candidate → approve → promote workflow. Guardian has 154 governed units
(150 article-level guides and four shared rules); Cambridge has 25. The existing
92 original lessons and 92 detail units remain active: 363 governed units total.
Publisher PDFs, full articles and exercise keys are not redistributed.

The tested application commit is `b8cc3da70d611d1fee71cb2a8e2160bac6e3ce95`;
the native asset revision is `b1e713b5f1a579ff1171`. A later documentation-only
commit may follow; `tested-files.json` pins all 19 expansion source/test files.

| Check | Result |
| --- | --- |
| RIWI backend | 317 passed |
| Main core backend contracts/build/SEO/assets | 37 passed |
| Complete frontend | 1,277 passed, 0 failed, 11 skipped |
| RIWI frontend subset (included above) | 13 passed |
| Native build | 513 files, 125 routes |
| Live guide/semantic cases | 13 initial cases and four fresh learner queries |
| Site material reads | All seven kinds, plus plain/timed podcast variants |
| Listening revision SQL matrix | Seven expected allow/deny cases passed |
| Responsive Safari | 1440×900 and 390×844, day and night |

The 11 frontend skips are existing legacy Listening importer tests requiring
`LEGACY_LISTENING_FIXTURE`; no such owner fixture was supplied. Initial full-suite
runs lacked local test dependencies. The final run used temporary QA dependencies
and completed with the counts above; the temporary repo symlink was removed.

## Live findings and corrections

- A whitespace-only Listening transcript appeared in the catalogue but could not
  be read. Whitespace sources are now hidden; a real-text QA fixture succeeded.
- Full Listening transcripts require a student's own completed exact current
  published revision. Old, missing, unfinished and another actor's attempts fail
  closed. Sequence and active-exam gates remain in force.
- `/simple` renders approved rules as separate steps in Uzbek and English.
  `/examples` gives examples without repeating the full explanation. Six authored
  examples per guide form two sets; this is not unlimited novel text generation.
- Safari's material search field now inherits the actual day/night palette.
  All six recorded layout samples have no horizontal overflow. Mobile day/night
  and desktop night samples confirm Send is visible and unobscured; a desktop day
  sample was taken before scrolling the composer fully into view.

Native Safari verified `/clear`, `/new chat`, `/language eng`, `/language uz`,
`/help` and the material picker. Captured network requests after clear/new chat
omit the old conversation and material. Unknown follow-ups ask for a topic.
User bubbles align right, assistant bubbles left, with the site's palette.

Seven exact temporary synthetic QA source rows were reversibly archived after
text-retrieval checks. All five fixture catalogues return zero rows and a direct
archived Listening read returns 404. The fixtures are not model training, actual
recordings or scored IELTS answers. Existing Speaking and Retention source reads
were also verified. No production content was used as synthetic QA acceptance.

## Scope and release boundary

`live-acceptance.json` records source identities, semantic checks, runtime identity,
layout measurements, fixture cleanup and hashes of the local raw receipts.
Meaning-focused review used fresh learner wording and negative controls; it is
not a second human review or a proofread of every PDF token. Student guards have
automated and PostgreSQL evidence, not a separate authenticated student Safari
session. Physical iPhone, microphone and media playback acceptance remain separate.

Production inventory is SELECT-only: 30 of 61 published Listening tests have
nonempty source text; the other 31 have no transcript to teach. Site material is
read in place under its publication, enrollment, attempt and version gates, so
future eligible published material needs no global export.

Main has not been merged, production has not been deployed or written to, and
no schema migration was performed for this expansion. The earlier RIWI branch
includes its own migration/rollout work; production schema and knowledge activation
require their separate approval. Owner permission is still required before main
merge or production deployment. The only newer main commit at this check adds
`prototype_redesign.html`, outside RIWI paths; the read-only merge-tree comparison
found no conflict.

See ../../../riwi-study-library.md for source scope and the normal activation
workflow. The local detailed checkpoint is `RIWI_EXPANSION_CHECKPOINT_20261103.md`
in the Owner's RIWI workspace; raw responses and logs remain under its `evidence/`.
