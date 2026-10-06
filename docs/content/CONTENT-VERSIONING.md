# Content Versioning and Attempt Binding

Status: **implemented**. Executable source of truth:
[`src/lib/content/versions.ts`](../../src/lib/content/versions.ts) (identity,
hashing, `pinVersion`, snapshots), [`src/lib/content/authoring.ts`](../../src/lib/content/authoring.ts)
(draft save, publication workflow), [`src/db/schema.ts`](../../src/db/schema.ts)
(`content_versions`, `content_imports`, attempt columns).

---

## 1. The promise

> A learner is given a specific revision of specific content, and editing that
> content later never changes what they were given, how they were graded, or what
> they see in review.

Everything below exists to keep that promise true.

## 2. Identity

A version identity is exactly `(module, contentType, sourceRef, versionNo)`, spelled
`writing:task2:task-107@v2`. Nothing else identifies content — not a title (editable),
not a filename (unstable), not a row id (machine-local).

The **source ref** is the stable human-meaningful identity of a piece of material
(§43): it comes from a natural key (a package's own source id, a provider video id,
an internal code), is normalized once by the import core, and may contain
`a–z 0–9 . _ -`, up to 80 characters. The same material always maps to the same ref;
different material never shares one.

## 3. What a revision stores

| column | meaning |
| --- | --- |
| `module`, `content_type`, `source_ref`, `version_no` | identity |
| `title`, `track` | metadata (editable without a new revision) |
| `status` | `draft` / `published` / `superseded` / `archived` — the *version's* life |
| `publication_state` | `draft` / `scheduled` / `published` / `archived` — the *publication* life |
| `publish_at` | the moment a scheduled revision opens |
| `content_hash` | the whole payload, canonicalized |
| `semantic_hash` | **only the fields a learner is graded on** for that module/type |
| `answer_key_hash` | the answer keys alone |
| `content_snapshot` | the canonical content as it was at this revision |
| `target_type`, `target_id` | the concrete content row this revision describes |
| `provenance` | where it came from (import, authoring, AI, conversion) |

Three hashes, because a change can be one of three things:

* **metadata** — a title, a note the learner is not graded on. Same revision, no
  new version, and the change is recorded as such.
* **semantic** — the material the learner is assessed on moved. New revision.
* **answer key** — only the truth moved. New revision, and named as an answer-key
  change, because this is the change that could silently regrade history if it
  were ever applied in place.

## 4. `pinVersion`

The single writer. Given canonical content and a provenance it:

1. finds the newest revision of that identity;
2. if only metadata moved (or nothing moved at all) it updates **that row** — a
   rename must not manufacture a version number;
3. otherwise it inserts `version_no + 1`;
4. **only when the new revision is itself published** does the previous published
   revision become `superseded`;
5. always writes the snapshot and all three hashes.

Rule 4 is the one that is easy to get wrong, and getting it wrong breaks work that
was already set: if writing a *draft* superseded the published revision, then the
moment an editor started revising published content the item would have no published
revision left — every assignment pointing at it would have nothing to open. A draft
is a proposal, not a replacement. Publication is what takes the publication slot:
`publishContentVersion` supersedes the revision that held it, so at most one
revision of an item is published at a time.

Nothing else writes to `content_versions`. An import, a hand-authored draft, an AI
draft, a media lesson and a legacy backfill all arrive at the same writer, so all
five share the same guarantees.

## 5. Publication workflow

```
draft ──► scheduled ──► published ──► archived
  ▲           │             │            │
  └───────────┴─────────────┴────────────┘   (every state may return to draft)
```

* Allowed moves: `draft → {scheduled, published, archived}`, `scheduled → {draft,
  published, archived}`, `published → {draft, scheduled, archived}`, `archived →
  {draft, published}`. Anything else is refused with the current state named.
* A learner-visible item is one whose revision state is live **and** whose content
  row's own `publication_state`/`publish_at` are live. Both halves are required:
  publishing a revision whose content row stays hidden would publish nothing.
* Publication is gated: `publicationIssues` runs before the state change, so a
  missing answer key or an archived content row blocks publication instead of
  being discovered by a learner.
* A grammar topic has no schedule column, so scheduling one is **refused**
  (`unsupported_schedule`) rather than silently treated as publishing.
* `activateDueVersions` opens scheduled revisions when `publish_at` arrives; the
  row state is the truth, so a scheduled revision is invisible until then.
* `publicationProblem` reports `missing_publish_at` / `unexpected_publish_at`, so a
  scheduled item with no moment, or a published item still carrying one, is caught.

An imported package may carry a publication *intent*; the intent is applied through
the same workflow and never grants rights the actor does not have.

### Who writes revisions

| door | writer | notes |
| --- | --- | --- |
| hand authoring / AI draft | `saveContentDraft` → `pinVersion` | payload validated by the content type's own schema |
| Reading import | `importCanonicalReadingSet` → `pinVersion` | pinned inside the importer's transaction, with its target row and import id |
| Listening import | `importCanonicalListeningPackage` → `pinVersion` | created and re-imported-with-changes paths |
| media lesson (TED / Podcast) | `createVideoLesson` → `pinVersion` | `ted:video_lesson` / `ted:audio_lesson` |
| lesson structure | `saveLessonStructure` → `pinVersion` | with its typed blocks |
| vocabulary pack | `saveTopicPack` → `pinVersion` | one lexical system, see `LEARNERS-AREA-CONTENT-MAP.md` |
| existing material | `scripts/content-backfill-imported-versions.ts` | reads only stored rows; dry-run first; idempotent |

The import *ledger* (`content_imports`) answers "did this package arrive?"; the
version store answers "what exactly did the learner get, and can it be set as work?".
Both records are written by the same transaction, so they cannot disagree.

## 6. Attempt binding

An attempt row records the revision it was taken against:

| table | column |
| --- | --- |
| `reading_attempts`, `listening_attempts` | `content_version_id` |
| `writing_submissions` | `content_version_id` |
| `speaking_attempts` | `content_version_id` |
| `grammar_attempts` | `content_version_id` |
| `assignments` | `content_version_id` (what the learner will be given) |
| `mock_sections`, `mock_attempts` | `content_version_id` / `content_version_bindings` |

Consequences that are enforced, not hoped for:

* **No mutation of history.** A published revision is immutable
  (`published_is_immutable`); editing content creates revision N+1 and leaves N
  exactly as it was. Grading, review and teacher views read the bound revision's
  snapshot, so an answer-key edit after the fact cannot regrade a past attempt.
* **Assignments pin.** Creating an assignment resolves the revision once and stores
  it; if the content is later revised or archived, the learner's task still shows
  the version they were given, and the assignment still reports that version's
  state honestly.
* **Archiving withdraws, never erases.** Archiving stops new work from being set
  against a revision; attempts, assignments and reviews that already point at it
  keep working.
* **Version-bound results.** A result row is interpretable years later without
  guessing which wording of a passage the learner actually read.

## 7. What hashing does *not* protect against

Hashes detect change; they do not make content correct. Correctness comes from the
registries (`QUESTION-TYPE-REGISTRY.md`), the validation matrix and human
publication. A revision can be perfectly consistent and still be wrong pedagogically
— which is why publication is a human act with a named actor and a reason.
