# Phase 9 Dictionary V2 — QA-only compatibility bridge

**Source of truth:** `N-Muhammadjonov/learners-area-dictionary`, branch `arena/01a0ffbd-learners-area-dictionary`, commit `64af9c187dee17f2e12eee9b1a4587ab675caa47`.

This changes only the isolated QA bootstrap's recognized release checksums. **It does not import Dictionary content into production, activate V2 or change the website's stable release pointer.** The existing V1 release remains `rel-v1-606b65c5282a75647c9928c3`.

## Input evidence

| Property | Authoritative V2 value |
|---|---|
| Release ID | `rel-v1-a834010a6ccc72c8b3cd8db9` |
| Source artifact | `data/releases/phase9_v2/uzdict_phase9_learner_nested.json.gz` (in separate dictionary repository) |
| Gzip SHA-256 | `5224b974f8bfc11213e265841087156c262cc0f5db78f489a5cab0997a0113b7` |
| Uncompressed SHA-256 | `81fd356d099b85b2b363141237345857c8acc9568810d65a70cd8746a80e6ca5` |
| Published lexemes | `62,376` |
| Published senses | `105,488` |
| Published examples | `81,099` |
| Valid CEFR labels | `101,260`; `4,228` held for review |
| Sense-level synonym edges | `151,756` |

Checksums and counts are also recorded in the dictionary repository's `data/releases/phase9_v2/RECONSTRUCT.md` and `docs/SYNONYM_CEFR_V2_FINAL_REPORT.md`. Source repo reported release QA PASS. That **does not yet prove** Learners Area QA database import or production readiness.

## Safe isolated bootstrap

Use an **isolated local** `learners_qa2` PostgreSQL database with approved migrations, never Supabase production, and a locally obtained original gzip with the checksum above:

```bash
DATABASE_URL='postgresql://localhost/learners_qa2' \
  node --conditions=react-server --import tsx \
  scripts/dictionary/bootstrap.ts \
  /absolute/path/to/uzdict_phase9_learner_nested.json.gz \
  /tmp/learners-area-dictionary-v2-qa.json
```

The script refuses all other DB hostnames and database names, refuses all unapproved source checksums, parses every entry with the existing strict schema, checks the complete persisted release manifest, and only marks V2 `validated` in isolated QA. It **never activates V2 in `dictionary_channels`**; the existing stable V1 pointer is retained.

Before considering production activation: verify the data-transfer license/attributions, available Supabase storage and indexing capacity, idempotent importer behavior on a recent QA restore, exact and prefix EN/UZ lookup, inflections, multiword phrases, CEFR and sense-specific synonyms, anonymous access denial, saved sense associations, V1 rollback, and fresh backup/restore. A separate owner-approved production runner is needed, not the QA bootstrap.
