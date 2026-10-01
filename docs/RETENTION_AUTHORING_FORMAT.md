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
| `acceptedPhrases` | optional; if one of these appears in a unit, that unit earns every **non-critical** group. Each `critical` group still needs one of its own authored values in the same unit (since evaluator v2), so a broad phrase can never stand in for a date, number or name |
| `rejectPhrases` | optional; if one of these appears in the claim's evidence, the claim scores **0** and is shown as contradicted |

A single outer Markdown code fence around the JSON is tolerated when pasting.
Anything else — prose, comments, trailing commas — is refused by the validator
with the exact reason.

---

### More complete pairs (lower and higher level)

These are documentation fixtures, not bank content: they show the format at the
bottom and near the top of the level range. Every pair in this document is
executed by the production word counter, validator and scorer in
`tests/retention-authoring-docs.test.ts`.

#### A2 pair (121 words, range 100–125)

<!-- retention-pair:A2:start -->
```text
Mira lives in a small town near the sea. Every Saturday morning she walks to the market with her grandfather. The walk takes twenty minutes, and they always stop at the old bridge to watch the boats. At the market, her grandfather buys fish, bread and green apples. Mira carries the apples in a blue bag. Last Saturday it started to rain, so they waited in a café for one hour. The owner gave Mira a cup of hot chocolate and did not ask for money. When the rain stopped, they walked home along the beach. Mira found a white shell and put it in her pocket. At home, she gave the shell to her little brother, who was very happy.
```

```json
{
  "schemaVersion": 1,
  "maxScore": 100,
  "claims": [
    {
      "id": "market-walk",
      "label": "Every Saturday Mira walks to the market with her grandfather.",
      "points": 25,
      "scope": "sentence",
      "groups": [
        { "id": "grandfather", "points": 10, "kind": "entity", "anyOf": ["grandfather", "grandpa", "granddad"], "critical": true },
        { "id": "market", "points": 10, "kind": "concept", "anyOf": ["market", "shop", "shopping"] },
        { "id": "saturday", "points": 5, "kind": "date", "anyOf": ["saturday", "saturdays", "weekend"] }
      ],
      "acceptedPhrases": ["goes shopping with her grandfather"],
      "rejectPhrases": ["walks with her grandmother"]
    },
    {
      "id": "shopping",
      "label": "Her grandfather buys fish, bread and green apples.",
      "points": 20,
      "scope": "sentence",
      "groups": [
        { "id": "fish", "points": 7, "kind": "concept", "anyOf": ["fish"] },
        { "id": "bread", "points": 6, "kind": "concept", "anyOf": ["bread"] },
        { "id": "apples", "points": 7, "kind": "concept", "anyOf": ["apples", "apple", "green apples"] }
      ],
      "rejectPhrases": ["red apples"]
    },
    {
      "id": "rain-cafe",
      "label": "When it rained they waited in a café for one hour and Mira got free hot chocolate.",
      "points": 35,
      "scope": "answer",
      "groups": [
        { "id": "rain", "points": 10, "kind": "concept", "anyOf": ["rain", "rained", "raining"], "critical": true },
        { "id": "cafe", "points": 10, "kind": "concept", "anyOf": ["cafe", "café", "coffee shop"] },
        { "id": "hour", "points": 5, "kind": "number", "anyOf": ["one hour", "an hour", "1 hour"] },
        { "id": "chocolate", "points": 10, "kind": "concept", "anyOf": ["hot chocolate", "chocolate", "cocoa"] }
      ],
      "rejectPhrases": ["paid for the hot chocolate"]
    },
    {
      "id": "shell",
      "label": "On the beach Mira found a white shell and gave it to her little brother.",
      "points": 20,
      "scope": "sentence",
      "groups": [
        { "id": "shell", "points": 10, "kind": "concept", "anyOf": ["shell", "seashell"], "critical": true },
        { "id": "brother", "points": 10, "kind": "entity", "anyOf": ["brother", "little brother"] }
      ],
      "rejectPhrases": ["gave the shell to her sister"]
    }
  ]
}
```
<!-- retention-pair:A2:end -->

#### C1 pair (291 words, range 280–330)

<!-- retention-pair:C1:start -->
```text
In 1854, a cholera outbreak struck the Soho district of London, killing more than five hundred people in ten days. At the time, most doctors believed that the disease spread through bad air, a theory known as miasma. John Snow, a physician who had studied earlier outbreaks, doubted this explanation. He suspected that cholera was carried by contaminated water rather than by smells rising from rubbish and sewers.

To test his idea, Snow did not rely on laboratory experiments, which could not yet identify the cause. Instead, he interviewed families and recorded where each victim had lived. When he marked the deaths on a street map, a clear pattern appeared: the cases were concentrated around a single public water pump on Broad Street. Several details strengthened his argument. Workers at a nearby brewery, who drank beer supplied by the brewery's own well, largely escaped the illness. In contrast, a woman who lived far away but preferred the taste of Broad Street water had it delivered to her home, and she died. Snow also compared households supplied by two water companies, one of which took its water from a part of the Thames polluted by sewage, and found far higher death rates among that company's customers.

Snow presented his evidence to the local authorities, who agreed to remove the handle of the pump. New cases were already declining by then, so the action alone did not end the outbreak, and critics used this fact against him. Nevertheless, his map became one of the most famous examples of using data to explain a public health problem. Decades later, after scientists identified the bacterium responsible, his conclusion about water was widely accepted, and he is now often described as a founder of modern epidemiology.
```

```json
{
  "schemaVersion": 1,
  "maxScore": 100,
  "claims": [
    {
      "id": "outbreak",
      "label": "In 1854 a cholera outbreak in Soho, London killed more than 500 people in ten days.",
      "points": 20,
      "scope": "sentence",
      "groups": [
        { "id": "cholera", "points": 6, "kind": "concept", "anyOf": ["cholera"], "critical": true },
        { "id": "year", "points": 6, "kind": "date", "anyOf": ["1854"], "critical": true },
        { "id": "place", "points": 4, "kind": "entity", "anyOf": ["soho", "london"] },
        { "id": "deaths", "points": 4, "kind": "number", "anyOf": ["500", "five hundred"] }
      ],
      "rejectPhrases": ["cholera outbreak in paris"]
    },
    {
      "id": "miasma",
      "label": "Most doctors believed the disease spread through bad air (miasma).",
      "points": 15,
      "scope": "sentence",
      "groups": [
        { "id": "doctors", "points": 5, "kind": "concept", "anyOf": ["doctors", "physicians", "experts"] },
        { "id": "air", "points": 10, "kind": "concept", "anyOf": ["bad air", "miasma", "smells", "polluted air"], "critical": true }
      ],
      "acceptedPhrases": ["miasma theory"],
      "rejectPhrases": ["doctors already knew it was the water"]
    },
    {
      "id": "water-hypothesis",
      "label": "John Snow suspected cholera was carried by contaminated water.",
      "points": 20,
      "scope": "sentence",
      "groups": [
        { "id": "snow", "points": 8, "kind": "entity", "anyOf": ["john snow", "snow"], "critical": true },
        { "id": "water", "points": 12, "kind": "concept", "anyOf": ["water", "contaminated water", "dirty water"], "critical": true }
      ],
      "rejectPhrases": ["snow blamed the air"]
    },
    {
      "id": "map-pump",
      "label": "Snow mapped the deaths and found them clustered around the Broad Street pump.",
      "points": 25,
      "scope": "answer",
      "groups": [
        { "id": "map", "points": 8, "kind": "concept", "anyOf": ["map", "mapped", "marked on a map"] },
        { "id": "pump", "points": 10, "kind": "concept", "anyOf": ["pump", "water pump"], "critical": true },
        { "id": "broad-street", "points": 7, "kind": "entity", "anyOf": ["broad street"] }
      ],
      "rejectPhrases": ["the deaths were spread evenly"]
    },
    {
      "id": "handle-legacy",
      "label": "The pump handle was removed; the map became a famous example and Snow a founder of epidemiology.",
      "points": 20,
      "scope": "answer",
      "groups": [
        { "id": "handle", "points": 10, "kind": "concept", "anyOf": ["handle", "removed the pump", "closed the pump"] },
        { "id": "epidemiology", "points": 10, "kind": "concept", "anyOf": ["epidemiology", "public health", "founder"] }
      ],
      "rejectPhrases": ["removing the handle ended the outbreak immediately"]
    }
  ]
}
```
<!-- retention-pair:C1:end -->

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
   A denial only removes a claim when it is **about that claim**: either it
   carries the claim's own wording (a concept/entity group or accepted phrase),
   or it has no subject of its own and follows the claim ("It was not true").
   Sharing a single date or number is not enough — "The weather report for 1998
   was not true" does not cancel "The company was founded in 1998" (evaluator
   v3, `retention-deterministic-v3`).
4. **Safe typo tolerance** applies only to `concept` groups that are not
   `critical`: a word of 1–4 letters must match exactly; 5–8 letters allow one
   edit; 9 or more allow two. Names, numbers and dates are never fuzzy-matched.
5. **Grammar is not scored.** Spelling of ordinary words (within the typo
   tolerance), articles, word order and tense carry no Retention points; the
   score measures remembered ideas only.
6. **Limits of a deterministic scorer.** The server matches authored evidence;
   it cannot prove in general that a learner's sentence is semantically true.
   Good structures therefore list real paraphrases, mark the facts that must
   be exact as `critical`, and add `rejectPhrases` for the likely wrong versions.
7. **Score = the sum of the awarded claim points**, an integer from 0 to 100. It
   is stored with the claim-by-claim breakdown, so the result screen can show the
   learner which ideas they kept without ever exposing the rubric.

Run the "Check" button in the editor before saving: it calls the same endpoint
the save calls and reports the word count, the point total and any structural
problem. When the panel says **Ready to save**, the server will accept the text.

---

### Evaluator versions

Every scored attempt stores the evaluator version that graded it. Fixes to the
scorer ship as a new version for **newly graded** attempts only; existing
terminal results and breakdowns are never re-graded or rewritten. History:
`retention-deterministic-v1` (launch), `-v2` (critical groups need their own
evidence; accepted phrases credit only non-critical groups; disclaimers must be
about the claim), `-v3` (a shared date/number alone does not make an unrelated
denial about the claim), `-v4` (found by the N14 draft audit: every occurrence
of an alternative is considered, so a negated first mention no longer hides a
later affirmative one; answer scope keeps sentence boundaries, so a negation never
crosses a full stop and no phrase is matched across two sentences; a decimal
point such as `1.27` no longer splits a sentence).

**Authoring rule for negative facts (v4 and v5):** if the fact is itself negative
("the flat had no garden", "procrastination is not laziness"), the group must be
the negative phrase (`no garden`, `not laziness`). A bare `garden` group is
correctly refused whenever the learner writes the true negative sentence.

**Known limitation:** the scorer matches authored evidence and ignores grammar
on purpose, so a bare list of the exact rubric terms can still reach a high
score. Learners never see the rubric (it is never sent to the client), which
limits this in practice, but it is a property of the deterministic design, not
a solved problem.

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

### Evaluator v5
New attempts use `retention-deterministic-v5`. Exact comma-, semicolon- or newline-separated rubric term lists are evaluated as separate evidence units, not combined into complete claims. This is a deterministic guard, not semantic understanding; human review is still required. Stored attempts are not regraded.
