# Listening Test 11 — native Academic integration

**Status: STRUCTURE INTEGRATED · PUBLICATION BLOCKED — OWNER BINARY REQUIRED.**

Test 11 is owner source material for a native Learners Area Academic Listening test. This file records
what the repository can now do with it, what it deliberately does not do, and what only the owner can
supply. It is written so the work can be finished later without re-deriving any of it.

## What the source is

| | |
|---|---|
| Product | Academic Listening full test — `/app/listening/academic` (never General, never MCQ practice) |
| Structure | 4 parts / 40 questions |
| Types | Q1–10 Completion · Q11–14 Map / Plan · Q15–25 MCQ · Q26–30 Matching · Q31–40 Completion |
| Totals | Completion 20 · MAP/Plan 4 · MCQ 11 · Matching 5 |
| Transcripts | a full transcript for each of the four parts |
| Script Completion | 6 purposeful gaps per part, 24 total |
| Vocabulary | 20 source items |
| Source activities | 9 concepts — Full Test, Review, Script Completion, MCQ, Map/Plan, Matching, Completion, Vocabulary, Retry |
| Audio | `assets/audio/full.mp3`, 80 kbps, 44.1 kHz stereo, 1650.964898 s, 16,509,954 bytes, sha256 `39dc7e45…a64660` |

Reference bundle: `reference/listening/test-11/` (read-only metadata; it deliberately omits the MP3).
The owner's original ZIP sha256 is `ac09de62…10f2a94`. This is a **separate** owner source from the one
pinned in `docs/LISTENING-SOURCE-ZIP-CONTRACT.md` (Test 10), which is untouched.

## Importer gap analysis (source fact → canonical representation)

Established by `tests/listening-test-11-source-contract.test.ts` (T11-01…T11-24) and
`tests/listening-map-plan.test.ts` (M1–M7). "Verified" means the repository proves it; where the
owner's packaged JSON could not be read, that is stated rather than assumed.

| Source fact | Canonical representation | Supported? | Required change |
|---|---|---|---|
| 40 questions, Q1–Q40, one per number | `listening_questions` rows (`order` unique per test), package `questions[40]` | YES — verified | none |
| Part per question (1–4) | `listening_questions` → `order`/section mapping + package `question.section` | YES — verified | none |
| Question type per range | canonical registry ids (`note_completion`, `map_labeling`, `mcq_single`, `matching`, …) via `type_code` | YES — verified | none |
| MCQ (Q15–25) | `kind: "mcq"`, options, key | YES — verified | none |
| Matching (Q26–30) | `kind: "matching"` + shared option pool; never filed as MCQ | YES — verified | none |
| Completion (Q1–10, Q31–40) | `kind: "completion"`; a typed answer, never a menu | YES — verified | none |
| **Map / Plan (Q11–14)** | `kind: "map"` (NEW), `map_labeling`/`plan_labeling` in the registry, `mapDiagram` on the package | **ADDED BY THIS WORK** | none outstanding |
| Full transcript ×4 | package `sections[].transcript` + `studyPack.scriptParts[].transcript` | YES — verified | none |
| Script Completion gaps (6/part) | `studyPack.scriptParts[].gaps[]` (`q`, `match`, `answer`) | YES — verified | none |
| Vocabulary (20 items) | package `vocabulary[]` → the ONE canonical lexical system on save | YES — verified | none |
| Audio duration + path | package `audio` (`path`, `durationSec`) | YES | none |
| **Audio binary (16.5 MB)** | private object storage key, served through the existing private asset route | **OWNER BINARY REQUIRED** | owner supplies the file; nothing is fabricated |
| Evidence text per question | `evidence.why` | YES | none |
| Evidence window (`timeStart`/`timeEnd`) | `evidence.at` / `evidence.end` | YES | validate it falls inside the audio duration at import |
| Paraphrase | `listening_questions.paraphrases` (heard/asked) — carried by the **authoring** payload; the canonical **package** question schema does not expose it | PARTIAL | map the source's paraphrase facts into the existing study/version snapshot at import; **no schema change needed** |
| Trap / distractor explanation | `explanation` (the review text a learner reads) | SUPPORTED via `explanation` | decide at import whether the trap text belongs in `explanation`; no new column |
| Mistake type | no canonical field | NOT SUPPORTED | deliberately **not** added: it would be a new persistent capability for study metadata the product does not yet render. Recorded as an owner decision, not silently dropped |
| Map visual (inline SVG) | `mapDiagram` (sanitized viewBox + coordinate/text shapes) | YES — verified | none; extraction never executes the source page |
| Source activity list (9) | `studyPack.activities[]` (canonical ids) | YES — the ceiling now tracks the registry instead of a hard-coded 9 | none |
| Answers PDF | never a learner asset | YES (excluded by design) | keep it in the owner QA workflow only |

**Answers to the two questions the owner asked before authorising a fix:** the existing Content OS
`listening:full_test` author cannot materialise the canonical package (a different, still-open item —
see the ledger's OWNER REVIEW note), and it does not need to for Test 11: the canonical import path
(`importCanonicalListeningPackage`) is the correct door, and it now accepts the map/plan shape.

## What was added (generic — nothing Test 11-specific)

* `kind: "map"` on the canonical question shape, and `map` in the canonical activity ids.
* The activity ceiling follows the registry (`LISTENING_ACTIVITY_IDS.length`) instead of `max(9)`.
* Map/Plan Mastery as a real graded practice: registry row, practice route, practice page with the plan
  rendered beside the questions, graded as a label choice.
* The plan renders on the parts that **contain** map questions (`mapDiagramSections`), with the
  historical Part 2 placement kept for packages that predate the kind.
* A map question is never counted as an MCQ — the same trap as matching, closed in the same place.
* EN + UZ copy for the new chrome.

No `Test11Page.tsx`, no hard-coded question list, no `if (id === "test-11")` anywhere: Test 11 is the
first real proof of the generic system, not an exception to it.

## Why publication is blocked, and what unblocks it

The reference bundle deliberately contains **no audio**. A full test whose plan, questions and
transcripts are ready but whose recording cannot play is not publishable — a card that opens a silent
exam is worse than no card. Therefore Test 11 stays **Draft / Owner Action Required** until the exact
owner binary is present:

```bash
sha256sum "Listening Test 11.zip"   # must be ac09de62c60085185ccb540cb9baa1674d58ffc1cf8beaa8656e7ea1910f2a94
# and the audio inside it must hash to 39dc7e45666d43585fc5841afed3d33d3ef2e3788b42e28e5693a7c769a64660 (16,509,954 bytes)
# then ingest through the canonical import + private storage path; never commit the MP3 to the repository
```

Nothing in this repository fabricates, substitutes or downloads a replacement recording.

## Final repository verification — 2026-10-08

**Repository-side work complete; publication still blocked on the exact owner audio binary.**

The remaining structured-source and legacy visual gaps were closed in `37fcb60`:
- Authored Map/Plan labels retain the `map` family; explicit subtype evidence is preserved.
- Unknown types block for staff review, never become completion or MCQ by default.
- PARTS SVG extraction is inert and sanitized. Missing required maps and incompatible multiple
  drawings block rather than inventing a visual or silently choosing the first.
- Map activity comes from actual map content. Review SVG/image, native exam image and Study image
  follow the same source-derived map sections, preserving approved legacy fallback.

The frozen code/test tree `8b23dfe` passed the full gate: unit **1452/1355/0/97**, UI
**271/271/0/0**, real PostgreSQL **1452/1448/0/4** (total/pass/fail/skip), typecheck, lint,
production build and both diff checks. Existing migrations: **53/53**; none added or modified here.
The prompt's 52-migration anchor predates already-committed work that was preserved.
Final-build HTTP smokes: Academic **50/50**, General **46/46**, General human journey **59/59**;
classification **21/21**, with each script's fixture cleanup verified.

See `APP-IMPLEMENTATION-LEDGER.md` for initial failures and corrections, exact scope, skip reasons,
QA2 residue, preserved unrelated worktree edits and owner/external dependencies. This is repository
and DOM/HTTP evidence, not real-browser pointer/mobile acceptance or proof of the absent owner ZIP.
