# Authoring Workflow

Status: **implemented**. Executable source of truth:
[`src/lib/content/authoring.ts`](../../src/lib/content/authoring.ts) (draft → publish),
[`src/lib/content/authors.ts`](../../src/lib/content/authors.ts) (the per-content-type
author registry), `src/app/api/admin/content/**` (the HTTP surface), `src/lib/content/lessons.ts`
and `src/lib/content/blocks.ts` (lessons and their typed blocks).

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

Registered today (12):

| module | authored content types |
| --- | --- |
| listening | `full_test`, `section` |
| reading | `general_set`, `passage` |
| writing | `task1`, `task2` |
| speaking | `part1_question`, `cue_card`, `part3_question` |
| grammar | `topic` |
| vocabulary | `topic_pack` |
| lesson | `lesson` |

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

1. **Choose the content type.** The taxonomy (`taxonomy.ts`) says which modules and
   content types exist; the author registry says which can be created.
2. **Draft.** `saveContentDraft` validates the payload against the type's schema,
   creates the content row, normalizes it to canonical content, and pins a `draft`
   revision with provenance (`origin: authored | imported | ai | converted`) recorded.
   A refused draft writes nothing and returns named issues.
3. **Revise.** Passing `versionId` edits that revision; a **published revision is
   immutable** (`published_is_immutable`), and editing one means creating N+1.
4. **Validate.** `answerShapeIssues` and the type registry run at draft time, so an
   impossible question is refused before it exists. Content referencing another item
   uses `content_reference` blocks and is checked (`referenceProblems`).
5. **Publish.** `publicationIssues` gates the move: missing answer key, archived
   content row, or an unresolved reference blocks it. Publishing records the actor
   and the reason in `provenance`.
6. **Assign.** `listAssignableContent()` is the list a teacher may choose from, and
   it offers only content that can actually be opened: a published revision of a
   content type the registry knows, whose canonical row still exists and is still
   learner-live. A draft, an archived row, a deactivated row, a schedule that has not
   opened, an unknown content type or an orphaned revision is not offered — and the
   assignment pins the exact revision the list showed.
7. **Schedule** when the material should open later, or **archive** when it should
   stop being set. Both are the same operation with a different target state, and
   both are reversible back to `draft`. Publishing a revision takes the publication
   slot from the revision that held it (which becomes `superseded`); writing a draft
   does not.
7. **Assign.** Staff pick from `listAssignableContent()` — published revisions only,
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
