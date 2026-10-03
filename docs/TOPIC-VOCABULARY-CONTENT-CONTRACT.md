# W13 Topic Vocabulary — status and content contract (2026-10-03)

**Status: OWNER ACTION REQUIRED** (content). No fabricated IELTS content was added.

| Question | Answer | Evidence |
|---|---|---|
| A. Architecture complete, content absent? | **Yes.** The learner tab, filters (topic / task / function), save-to-vocabulary and save-to-pattern-bank work. 2 of the 60 reference topics have content. | `src/lib/services/writing/topic-vocabulary.ts`, `src/components/writing/topic/*`, `src/lib/services/vocabulary/packs.ts` (2 packs, 21 words: Health & Medicine, Work & Career) |
| B. Owner-approved content elsewhere? | **No.** The repo and `arena/reference-materials` hold only `work_career_vocab_practice.html` (already the Work & Career pack). The 60-topic list in the reference PDF has titles only, and copying third-party material is not allowed. | `git ls-tree origin/arena/reference-materials` |
| C. Blocked by Preview DB? | **Partly.** Words (packs) work without migrations. Phrases/frames live in `writing_language_patterns` from migration **0031**, which is not approved for Preview. | `drizzle/0031_writing_workspace.sql` |
| D. Authoring still needs owner input? | **Yes.** The owner (or a teacher the owner approves) must supply or approve the topic texts. | — |

## Contract A — topic word pack (works today, no migration)
One pack per topic. Each word needs all five fields (collocations is optional).
Text must be original and centre-authored. Uzbek uses Latin script with an ASCII apostrophe (`o'`, `g'`).

```json
{
  "id": "environment",                       // lowercase_snake, unique, stable forever
  "label": { "en": "Environment", "uz": "Atrof-muhit" },
  "words": [
    {
      "term": "emission",
      "partOfSpeech": "noun",
      "definitionEn": "gas or other substance sent into the air",
      "translationUz": "chiqindi gaz, chiqarish",
      "collocations": "carbon emissions · reduce emissions · emission targets",
      "example": "Cities cut emissions by expanding public transport."
    }
  ]
}
```
Recommended: 8–15 words per topic; `example` ≤ 160 chars and must contain the term or a form of it;
no duplicate `term` within a pack. Developers add it to `TOPIC_PACKS`. Existing lexeme ids are
preserved because packs save through the one vocabulary engine.

## Contract B — phrases / frames (needs 0031 on the target DB)
Authored at **/admin/writing → Patterns** (owner/admin), or as a bulk list in this shape:

```json
{
  "pattern": "There is a growing consensus that …",
  "function": "argument",          // collocation | sentence_frame | cohesion | comparison | concession | trend | argument
  "taskType": "task2",             // task1 | task2
  "topic": "Environment",          // same label as the pack (links them in the filter)
  "targetBand": 7,                 // 5..9 or null
  "example": "There is a growing consensus that cities must cut emissions.",   // ≤ 400 chars
  "usageNote": "Opens a body paragraph; follow with evidence.",
  "provenance": "Centre-authored, approved by <owner name>, 2026-10-..",       // required
  "sourceRef": "env-arg-001"       // optional stable id, unique
}
```
Items publish only through the existing publication states (draft → published).

## What the owner sends
1. The list of topics to cover (up to the 60 in the reference PDF, titles in the centre's own words).
2. For each topic: one Contract A pack, plus optional Contract B items.
3. A one-line approval for each batch ("approved for publication").

After 0031 is approved and applied, Contract B items can be published. Until then the ledger
row W13 stays **OWNER ACTION REQUIRED**.
