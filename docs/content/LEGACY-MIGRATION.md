# Legacy Content Migration

Status: **classified and safe**. The machine-readable truth is
[`scripts/content-legacy-inventory.ts`](../../scripts/content-legacy-inventory.ts)
(`npx tsx scripts/content-legacy-inventory.ts`, `--json` for tooling). This document
explains the classifications, the migration tooling that exists, and — just as
importantly — what has deliberately **not** been done.

---

## 1. Classification

| Classification | Meaning |
| --- | --- |
| `KEEP` | Not content: infrastructure, policy or genuinely native code. |
| `MIGRATE` | Real learner-facing content that must become canonical content. |
| `COMPATIBILITY ONLY` | Reads stay because stored or historical rows depend on them; nothing new may be authored into it. |
| `REMOVE AFTER MIGRATION` | Superseded once its content is canonical **and** the dependency check is clean. |
| `MANUAL REVIEW REQUIRED` | Cannot be classified mechanically (ambiguous scope, external provider, copyright question). |

Current inventory: **13 items** — 7 KEEP, 5 COMPATIBILITY ONLY, **0 MIGRATE**, 1
MANUAL REVIEW REQUIRED, **0 REMOVE AFTER MIGRATION**.

The last `MIGRATE` item was closed in this pass: `topic-vocabulary.ts` no longer
holds vocabulary of its own. It now projects the canonical topic packs
(`listTopicPacksForLearner` → `lexemes` rows) and falls back to the built-in list
only while no pack is published, so a word shown in Writing is the same sense
Reading, Listening and TED/Podcast occurrences resolve into.

Zero removals is a deliberate, honest result: nothing is yet proven safe to delete,
and the constraint is explicit — *do not delete legacy content until dependency and
migration safety are proven* (§94). A `REMOVE AFTER MIGRATION` verdict must name the
thing that replaces it, and `inventoryProblems()` fails the inventory if it does not.

## 2. What is classified, and why

| Item | Classification | Reason |
| --- | --- | --- |
| `src/lib/services/vocabulary/packs.ts` (built-in packs) | COMPATIBILITY ONLY | Learners must see vocabulary before any pack is authored, and stored rows reference pack ids. The DB becomes the source of truth the moment a pack is published; this list must not gain new words. |
| `src/lib/services/writing/topic-vocabulary.ts` | KEEP (migrated) | The Writing topic-vocabulary read. Its words come from canonical topic packs (whose words ARE `lexemes` rows), its phrases from published `writing_language_patterns`, its saved state from the learner's real `user_vocabulary`/pattern bank. A read projection, not a content store. |
| `src/lib/data/reading-library.ts` | COMPATIBILITY ONLY | Historical reading attempts reference those rows and must stay readable. |
| `src/lib/import/listening/legacy.ts` | COMPATIBILITY ONLY | Exists to convert old shapes; do not add new formats here. |
| Legacy HTML runtime (`AuthoredListeningFrame`, the `authored`/`sandbox` routes, `authored-sandbox.ts`) | COMPATIBILITY ONLY | Imports from before the canonical Listening contract carry their own HTML/JS/CSS and learners mid-attempt must keep the test they were given. New imports cannot become this: the canonical schema refuses `authoredRuntime`. Execution stays an opaque-origin sandbox with a per-session token and inert blob media. |
| `src/db/seed.ts` | COMPATIBILITY ONLY | Local fixtures only, never a production content source (synthetic data only, §96). |
| `src/lib/import/reading/*`, `src/lib/import/listening/*` (canonical paths) | KEEP | Working import foundation that feeds the canonical store. |
| `src/lib/content/*` | KEEP | This *is* the canonical system. |
| `src/lib/reading|listening/lexical-policy.ts` | KEEP | Policy, not content. |
| LEGACY runtime content tables (listening/reading/writing/speaking legacy rows) | COMPATIBILITY ONLY | Attempts were recorded against them; see the content map for the table list. |
| External provider material (TED/Podcast ids, published papers) | MANUAL REVIEW REQUIRED | A provider id is a safe reference; stored transcripts, question text or audio from a copyrighted paper must be reviewed by a human, and no copyrighted question is re-created here. |

## 3. Migration tooling (§95)

**Vocabulary packs** — `scripts/content-backfill-vocabulary-packs.ts`

* idempotent: re-running changes nothing that is already right;
* `--dry-run` prints exactly what would be created and writes nothing (and disables
  `--publish` while it runs);
* `--publish` publishes what it creates; `--force` re-writes an existing pack;
* requires `CONTENT_BACKFILL_ACTOR_USER_ID`, so a conversion always has a named
  actor in provenance;
* source refs use the charset `a–z 0–9 . - _` (`pack-<id>`); a colon is refused by
  the authoring gate, and a slug an administrator authored is never overwritten.

**Import ledger** — every imported item records the package that produced it
(`content_imports`), so a later migration can ask "did this come from the legacy
path or from a package?" instead of guessing.

**Identity** — `src/lib/content/identity.ts` answers, before anything is written,
whether incoming material is new, identical to what is stored, changed (and how), or
the same content under a different ref. A migration therefore **cannot invent data**:
it either converts a real row, or it reports that it cannot.

## 4. What is *not* done automatically

* No legacy row is rewritten in place into a canonical revision.
* No legacy attempt is re-pointed at a new revision it never used.
* No duplicate is merged automatically.
* No hard-coded list is emptied.

Each of those decisions needs a human who can see the content, and the tooling is
built to make that review cheap rather than to skip it.

## 5. Dependency check before any removal

1. `npx tsx scripts/content-legacy-inventory.ts` — every item classified, no
   problems reported.
2. Find the readers: `grep -rn "<table or module>" src tests` — a reader with a test
   exercising it is a dependency.
3. Confirm the canonical replacement is published for every item the table holds
   (not just one row).
4. Confirm no attempt, assignment, mock or receipt points at the rows.
5. Only then change the classification to `REMOVE AFTER MIGRATION`, name the
   successor, and remove in a dedicated commit that can be reverted on its own.
