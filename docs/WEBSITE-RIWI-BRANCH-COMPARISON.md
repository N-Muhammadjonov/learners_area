# WEBSITE ↔ RIWI BRANCH COMPARISON — MIGRATION COLLISION REPORT

Required by the execution contract §B ("Prepare a comparison report between the website and RIWI
branch histories and migration schemas; never silently merge divergent trees").

This document is **read-only analysis**. No merge, no cherry-pick, no branch switch was performed,
and none is authorized.

## Branch identities (measured, not quoted)

| | Website | RIWI |
| --- | --- | --- |
| Branch | `arena/1052c0fd-learners-area` | `arena/01a10bac-learners-area` |
| Remote HEAD at comparison | `47d00315f0eeee6d8613a86247bc80e9d9338b5c` | `fd0dc498405ba46b9283f4749722b9c045d0d63c` |
| Contract-recorded HEAD | `3965967…` (historical) | `fd0dc49…` |
| Drift vs contract | newer (expected; preserved) | none |
| `.sql` migrations | 53 | 49 |

The RIWI branch HEAD is byte-identical to the SHA recorded in the contract, so the RIWI workstream
has not advanced since the document was generated.

## Finding 1 — the two branches have NO COMMON GIT ANCESTOR

```
git merge-base 47d0031 fd0dc49   ->   (empty, exit 1)
```

`git rev-list --count` against an empty base is meaningless; measured directly, the RIWI branch
carries **186 commits** that are not reachable from the website branch, and the website branch's
history is not reachable from RIWI. These are **unrelated histories**. A plain `git merge` would
require `--allow-unrelated-histories`, which is explicitly not authorized.

## Finding 2 — migrations 0000–0035 are IDENTICAL, 0036+ COLLIDE

Migrations `0000`–`0035` are the same blobs on both branches (verified by object hash, not by
filename). From `0036` onward the **same ordinal numbers name completely different migrations**:

| Ordinal | Website branch | RIWI branch |
| --- | --- | --- |
| 0036 | `0036_speaking_study_support.sql` | `0036_riwi_core.sql` |
| 0037 | `0037_profile_photos.sql` | `0037_riwi_governance_hardening.sql` |
| 0038 | `0038_dictionary_releases.sql` | `0038_riwi_provider_experiment_idempotency.sql` |
| 0039 | `0039_academic_reading_sets.sql` | `0039_riwi_learning_signal_pipeline.sql` |
| 0040 | `0040_content_imports.sql` | `0040_riwi_learning_signal_retention.sql` |
| 0041 | `0041_content_versions.sql` | `0041_riwi_learning_signal_knowledge_link.sql` |
| 0042 | `0042_mock_composition.sql` | `0042_riwi_knowledge_private_upload.sql` |
| 0043 | `0043_authoring_identity.sql` | `0043_riwi_target_cursor_indexes.sql` |
| 0044 | `0044_lesson_blocks.sql` | `0044_riwi_owner_history_indexes.sql` |
| 0045 | `0045_media_lessons.sql` | `0045_assessment_contracts_and_owner_policy.sql` |
| 0046 | `0046_vocabulary_topic_packs.sql` | `0046_tiny_george_stacy.sql` |
| 0047 | `0047_assignments_canonical.sql` | `0047_bent_bulldozer.sql` |
| 0048 | `0048_typing_trainer.sql` | `0048_condemned_pyro.sql` |
| 0049–0052 | `lesson_notes`, `lesson_learning_area`, `listening_question_revision`, `listening_mcq_program_days` | (none) |

## Consequence — integration is BLOCKED on an owner-approved renumbering plan

A merge of these two trees in their current state would place **two different migrations at every
ordinal from 0036 to 0048**. That breaks:

- fresh-install ordering (which 0036 runs first is undefined),
- `drizzle/meta/_journal.json` hash parity (both journals claim those ordinals),
- any upgrade from an already-accepted database on either side.

Neither branch may be renumbered unilaterally: the contract forbids renumbering, rewriting or
deleting existing migration history, and both sets are already applied to real accepted databases.

**Status: `EXTERNAL_ACCEPTANCE_REQUIRED` / owner decision.** Per §B, if branch transfer is ever
approved it must go through *"a reviewed staging/integration branch and verified non-overlapping
migration paths"*. The concrete unblock action for the owner is to authorize a dedicated
integration branch on which the RIWI migrations are re-sequenced to `0053+` (additively, with
fresh-install and upgrade proof on both accepted databases) — not a merge of these two branches.

## Scope note

Nothing in this report authorizes or performs RIWI work. The RIWI lanes (RIWI-01…RIWI-13) live on
the RIWI branch, which this session cannot check out: this Arena session is bound to
`arena/1052c0fd-learners-area`, and §B forbids switching away from the website checkout. Per §B,
RIWI execution requires **an additional isolated Arena workspace bound to the RIWI branch**.
