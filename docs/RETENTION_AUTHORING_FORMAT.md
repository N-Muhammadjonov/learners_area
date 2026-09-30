# Retention — authoring format

Retention memory is a five-level memory exercise. The learner gets **one text**,
reads it for two minutes, then writes what they remember for three minutes. The
score is computed on the server, deterministically, from the **Measurement
Structure** you write next to the text. There is no AI in the loop, and there is
nothing for a learner to appeal to: the same answer always produces the same
score.

Two things are pasted in the Management screen, in this order.

---

## 1. RETENTION TEXT

Plain prose. No Markdown headings, no bullet lists, no instructions to the
student — the text is the reading material itself.

The word count must fall inside the level's range:

| Level | Target | Allowed |
| ----- | ------ | ------- |
| A2    | ~110   | 100–125 |
| B1    | ~175   | 160–195 |
| B2    | ~260   | 240–285 |
| C1    | ~300   | 280–330 |
| C2    | ~415   | 390–450 |

15 texts per level is the launch **target**, not a maximum. Nothing stops you
from adding a 16th, a 30th or a 100th; the rotation engine uses them all.

### How the word count is measured

The editor's live counter and the server's validation call **the same function**,
so they cannot disagree:

* the text is normalised first (full-width characters and ligatures are folded);
* a word is a run of letters or digits, optionally joined by an apostrophe or a
  hyphen: `don't` is one word, `well-known` is one word, `state-of-the-art` is
  one word;
* a grouped number is **one** word: `50,000` and `1,234,567` count as one each;
* digits are words: `1998` is one word;
* punctuation and dashes separate words; repeated spaces and line breaks never
  add one.

The number you see under the text box is the number the server will store.

---

### Sample pair (a complete B1 exercise)

The text below is the one the structure further down scores. It is 172 words,
inside B1's 160–195 range, and the pair passes the production validator — this
exact example is re-validated by the test suite on every run.

<!-- retention-text-example:start -->
```text
Ada Lovelace was born in London in 1815. Her father was a famous poet, but her mother
raised her alone and wanted her to study mathematics instead of poetry. When Ada was
seventeen, she met Charles Babbage, an inventor who was building a machine called the
Analytical Engine. Babbage wanted to calculate long tables of numbers without making
mistakes. Ada translated an article about his machine from French into English, and then
she added seven notes of her own. The last note described how the machine could follow a
series of instructions to repeat a calculation. Many historians say this was the first
computer program, written more than a hundred years before the first electronic computer
was built. Ada called her idea poetical science, because she believed that imagination
and mathematics worked best together. She died in 1852 at the age of thirty-six, and her
notes were almost forgotten for a century. Babbage never finished his machine, and it
was not built in their lifetime, but Ada's notes were published in 1843.
```
<!-- retention-text-example:end -->

---

## 2. MEASUREMENT STRUCTURE

A JSON document worth **exactly 100 points**. Nothing in it is code: there are no
regular expressions, no formulas and no callbacks. It is data the scorer reads.

```json
{
  "schemaVersion": 1,
  "maxScore": 100,
  "claims": [
    {
      "id": "meeting",
      "label": "Ada Lovelace met Charles Babbage and worked on the Analytical Engine.",
      "points": 30,
      "scope": "sentence",
      "groups": [
        { "id": "ada", "points": 10, "kind": "concept", "anyOf": ["ada lovelace", "ada"], "critical": true },
        { "id": "babbage", "points": 10, "kind": "entity", "anyOf": ["babbage", "charles babbage"], "critical": true },
        { "id": "engine", "points": 10, "kind": "entity", "anyOf": ["analytical engine", "the engine"] }
      ],
      "acceptedPhrases": ["ada lovelace worked with charles babbage"],
      "rejectPhrases": ["babbage built the first computer alone"]
    },
    {
      "id": "program",
      "label": "Her notes are considered the first computer program.",
      "points": 25,
      "scope": "sentence",
      "groups": [
        { "id": "notes", "points": 10, "kind": "concept", "anyOf": ["notes", "her notes"] },
        { "id": "first-program", "points": 15, "kind": "concept", "anyOf": ["first computer program", "first program"], "critical": true }
      ],
      "rejectPhrases": ["her notes were written by babbage"]
    },
    {
      "id": "death",
      "label": "She died in 1852 at the age of thirty-six.",
      "points": 20,
      "scope": "sentence",
      "groups": [
        { "id": "date", "points": 12, "kind": "date", "anyOf": ["1852"], "critical": true },
        { "id": "age", "points": 8, "kind": "number", "anyOf": ["thirty-six", "36"] }
      ],
      "rejectPhrases": []
    },
    {
      "id": "teaching",
      "label": "Her mother wanted her to study mathematics rather than poetry.",
      "points": 25,
      "scope": "sentence",
      "groups": [
        { "id": "mother", "points": 10, "kind": "concept", "anyOf": ["her mother", "mother"] },
        { "id": "mathematics", "points": 15, "kind": "concept", "anyOf": ["mathematics", "maths", "math"], "critical": true }
      ],
      "rejectPhrases": []
    }
  ]
}
```

### The rules the validator enforces

| Rule | Detail |
| ---- | ------ |
| `schemaVersion` | must be exactly `1` |
| `maxScore` | must be exactly `100` |
| claim `points` | whole numbers, positive; all claims together must total exactly 100 |
| group `points` | whole numbers, positive; the groups of a claim must total exactly that claim's `points` |
| limits | ≤ 40 claims, ≤ 20 groups per claim, ≤ 30 alternatives per group, ≤ 20 accepted/rejected phrases per claim, ≤ 200 000 characters of JSON |
| ids | non-empty, unique; claim ids unique across the document, group ids unique inside their claim |
| `label` | the sentence the learner is trying to remember — it is also what the result screen shows them |
| `scope` | `sentence` (credit inside ONE sentence) or `answer` (credit may come from different sentences) |
| `kind` | `concept`, `entity`, `number` or `date` |
| `critical` | optional; a missing or contradicted critical group marks the claim as not fully remembered |
| `acceptedPhrases` | optional; if one of these appears, the claim receives its full points unless a critical number/entity conflicts |
| `rejectPhrases` | optional; if one of these appears in the claim's evidence, the claim scores **0** and is shown as contradicted |

A single outer Markdown code fence around the JSON is tolerated when pasting.
Anything else — prose, comments, trailing commas — is refused by the validator
with the exact reason.

---

## How the score is decided

1. **Normalisation.** Case, accents, curly vs straight apostrophes, articles and
   other function words are ignored, and `don't` is read as `do not`, so a
   negation is visible. Number words are equal to digits (`two` = `2`).
2. **Sentence scope.** Each sentence of the answer is a separate piece of
   evidence. Credit comes from the single best sentence — a claim cannot be
   assembled out of keywords scattered across a paragraph. `answer` scope may use
   the whole answer.
3. **False positives are treated as worse than misses.** The scorer refuses
   credit for a negated fact, for a fact that appears only inside a denial
   ("this was not what happened"), for the wrong number, and for the wrong date.
   A missing point is recoverable; a wrong point teaches the wrong thing.
4. **Safe typo tolerance** applies only to `concept` groups that are not
   `critical`: a word of 1–4 letters must match exactly; 5–8 letters allow one
   edit; 9 or more allow two. Names, numbers and dates are never fuzzy-matched.
5. **Score = the sum of the awarded claim points**, an integer from 0 to 100. It
   is stored with the claim-by-claim breakdown, so the result screen can show the
   learner which ideas they kept without ever exposing the rubric.

Run the "Check" button in the editor before saving: it calls the same endpoint
the save calls and reports the word count, the point total and any structural
problem. When the panel says **Ready to save**, the server will accept the text.

---

## Editing and deleting

* **Change** always writes a new version (`v2`, `v3`, …). Attempts that were
  already scored keep pointing at the exact version they were given.
* **Delete** archives. The text leaves rotation, learners stop receiving it, and
  every attempt, score and version stays in the database.
* **Restore** puts an archived text back into rotation without creating a version.
* The **Uses** column counts finished attempts on the current version; the
  **Lifetime** column counts all finished attempts across every version.
  In-progress attempts are never counted.

## A safe workflow

1. Write the text, then read it aloud once. If a fact is not in the text, it
   cannot be in the structure.
2. Write one claim per main idea, and give it points roughly equal to its
   importance. Critical facts (dates, names, numbers, the main conclusion) get
   their own group.
3. Add `rejectPhrases` for the most likely *wrong* version of the claim — the
   opposite of the fact, or a plausible confusion.
4. Paste, check, save. Then take the exercise yourself before the learners do.
