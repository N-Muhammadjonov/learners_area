# N16 — reading-105 no-database dry run (real source)

* **Source:** `learnersarea_reading_105.zip` on branch `assets/learners-area-brand`. Last changed in
  commit `9b573758ebdf1c0f04c09bc157f284ce03455e97` (2026-09-26, "Add files via upload").
  * sha256 `d736cd4bada0f55309a498116e0e408dd64306ad22779d3ba306a20d01529dd6`, 2,897,149 bytes.
  * Extracted to `/tmp` only; the zip is not committed to this branch.
* **Command:** `env -u DATABASE_URL node --import tsx scripts/import-reading-105.mjs --source /tmp/reading105.zip`
  * No `DATABASE_URL` was set, so no database was contacted.
* **Bundle read:** `learnersarea_reading_supabase_ready_v1/data/reading_bundle_01_105.json`
  * 105 passages.
  * 2,591 lexical senses, which map to 2,589 legacy sense keys.
* **Result:** exit 1. `STOP Source contains colliding legacy sense keys; reconcile explicitly before import. Nothing was written.`
* **Exact blocker:** one collision. The two senses share the legacy key (`legacySenseKeyOf`: term, coarse part of speech and
  shortened meaning), but their full semantic identity (`senseKeyOf` v2) differs:

| sense id | term | POS | definition_en |
|---|---|---|---|
| `8244161a-a268-512a-a03b-4ffd6aa3c86e` | literacy | noun | the ability to read and write, or competence in a specific symbolic system |
| `0de2a7de-6858-551c-9c1e-981139716c1b` | literacy | noun | the ability to read and write |

The importer refuses rather than silently merging two meanings, or dropping one, which is correct.

**Owner action:** decide the content question, which the script will not guess:

* **(a) Same sense:** make both definitions identical in the source bundle. One shared lexicon sense results.
* **(b) Different senses:** give the second definition a distinct wording that survives
  `legacyMeaning` normalisation.

Then re-run the same dry run. After it passes, apply it to the Preview QA database with `--apply`. That step
needs the Preview credential and is not possible from this sandbox.

No passage text, question or receipt was invented. `docs/READING-105-IMPORT-REPORT.md` was not rewritten,
because the run stopped before the report step.
