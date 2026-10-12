# Authoring Workflow

Status: **implemented**. Executable source of truth:
[`src/lib/content/authoring.ts`](../../src/lib/content/authoring.ts) (draft → publish),
[`src/lib/content/authors.ts`](../../src/lib/content/authors.ts) (the per-content-type
author registry), `src/app/api/admin/content/**` (the HTTP surface), `src/lib/content/lessons.ts`
and `src/lib/content/blocks.ts` (lessons and their typed blocks). The human surface over
all of it is ONE admin workspace, `/admin/content/workspace`, whose bank panel is the inventory view —
it calls these APIs and has no write path of its own. `/admin/content` remains the library
index (counts of live vs not-live per kind, linking to each surface).

---

## 1. One door

Everything that creates content goes through the same pair of operations:

```
saveContentDraft(actor, module, contentType, sourceRef, title, payload[, versionId])  → a draft revision
publishContentVersion(actor, versionId, to[, publishAt])                             → a published revision
```

Import, hand authoring, AI output and legacy conversion all arrive here. There is no
second write path, so there is no second set of guarantees: the same reference
validation, the same payload schema, the same hashing, the same publication gate and
the same audit trail apply regardless of who (or what) proposed the content.

## 2. The author registry

A content type is *authorable* only when a `ModuleAuthor` is registered for it:

```
registerModuleAuthor({ module, contentType, payloadVersion, label,
                       payloadSchema, persist, setPublication, readSchedule })
```

`persist` validates and normalizes the payload into **canonical content** and
creates the content row the revision describes; `setPublication` moves that row's own
visibility with the revision (and reports `unsupported_schedule` when the row cannot
hold a moment); `readSchedule` reads it back.

Registered today (17):

| module | authored content types |
| --- | --- |
| listening | `full_test`, `section` |
| reading | `general_set`, `passage` |
| writing | `task1`, `task2`, `lesson`, `model_text`, `pattern`, `translation_set` |
| speaking | `part1_question`, `cue_card`, `part3_question`, `material` |
| grammar | `topic` |
| vocabulary | `topic_pack` |
| lesson | `lesson` |

`preview.ts` covers exactly this list: `previewInventory()` is computed from
`listRegisteredAuthors()` (17 types → 17 `PREVIEW_READY`, 0 `MISSING`), so a new author
cannot land without deciding what its preview shows.

The four secondary Writing types are canonical through the SAME tables the app already
reads (`writing_lessons`, `writing_model_texts`, `writing_language_patterns`,
`writing_translation_sets`) — the row IS the content, and the revision pinned beside it
is what an assignment can point at. Their authoring schemas reuse the Writing admin
lists (`LESSON_CATEGORIES`, `MODEL_TEXT_MIN_WORDS`, `PATTERN_FUNCTIONS`,
`TRANSLATION_QUESTION_TYPES`/`TRANSLATION_BANDS`) so the form, the author and the
database CHECK cannot drift. One trap is handled explicitly:
`writing_language_patterns.source_ref` already means "the model text this pattern came
from", so the pattern author resolves the row to revise from the previous revision's
`target_id` instead of overwriting a provenance column.

A `section` is a Listening practice item (one recording, at most twelve questions,
carrying its `sectionNo`) and a `passage` is a Reading item of exactly one passage:
both are filed under their own content type, so an item cannot be mistaken for a
full test in the catalogue, in a mock composition or in a revision history — the
same source ref under two content types is two items, not two revisions of one.

`canAuthor(module, contentType)` is the honest answer to "can this be created from
scratch here?" — `listRegisteredAuthors()` is what the admin UI lists, so a surface
never offers a create form the backend cannot honour. TED/Podcast media lessons are
*referenced* (provider + external id + centre-written notes) through the TED content
type rather than authored from a blank form; the content type itself remains
registered in the taxonomy.

## 3. The steps

0. **See what is already there.** The bank panel of the workspace (`bank.ts`,
   `GET /api/admin/content/bank`) answers
   "does this exist, in what state, at which version?" before anyone writes a second copy
   of it: filter by module, content type, present state, has-ever state, track, identity,
   title, free text or version. Identity-based duplicate detection lives in `identity.ts`
   and is not a title comparison.
1. **Choose the content type.** The taxonomy (`taxonomy.ts`) says which modules and
   content types exist; the author registry says which can be created — and the workspace
   lists exactly `listRegisteredAuthors()`, so it never offers a form the backend cannot
   honour. Its template endpoint emits the payload shape for the chosen type.
2. **Draft.** `saveContentDraft` validates the payload against the type's schema,
   creates the content row, normalizes it to canonical content, and pins a `draft`
   revision with provenance (`origin: authored | imported | ai | converted`) recorded.
   A refused draft writes nothing and returns named issues.
3. **Revise.** Passing `versionId` edits that revision; a **published revision is
   immutable** (`published_is_immutable`), and editing one means creating N+1.
4. **Validate.** `answerShapeIssues` and the type registry run at draft time, so an
   impossible question is refused before it exists. Content referencing another item
   uses `content_reference` blocks and is checked (`referenceProblems`).
5. **Preview.** `preview.ts` projects the exact revision through the same shape the
   learner renderer consumes, WITHOUT publishing it: staff-only, revision-identified, an
   optional region that fails stays local, a core region that fails fails closed, and
   executable content is withheld rather than echoed (§Z).
6. **Publish.** `publicationIssues` gates the move: missing answer key, archived
   content row, or an unresolved reference blocks it. Publishing records the actor
   and the reason in `provenance`.
7. **Schedule** when the material should open later, or **archive** when it should
   stop being set. Both are the same operation with a different target state, and
   both are reversible back to `draft`. Publishing a revision takes the publication
   slot from the revision that held it (which becomes `superseded`); writing a draft
   does not.
8. **Assign.** Staff pick from `listAssignableContent()` — published revisions only,
   newest published revision per item — and the task pins exactly that revision. A
   draft revision is never offered and never pinned, even when its version number is
   higher (`GET /api/assignments/assignable`).

## 4. Rules

* **Nothing publishes itself.** No import, no script and no AI pass has publish
  authority: they produce drafts (or published revisions only when a human actor
  with the right role performs the operation).
* **AI output is content, not a decision.** An AI draft arrives as a payload, is
  validated by exactly the same schema and shape rules as a human draft, is marked
  with `origin: ai` in provenance, and waits for a human to publish it (§36).
* **No untyped blobs.** A payload schema per content type means JSONB is only ever
  used for bounded metadata; content with a shape has a shape.
* **First target, then revision.** `persist` must create the row before the revision
  is pinned, because a revision whose `target_id` is missing cannot be published or
  read back (`target_missing`).
* **Unstable refs are refused.** A source ref must already be stable
  (`unstable_source_ref`); a caller does not get to smuggle `:` or spaces into
  identity.
