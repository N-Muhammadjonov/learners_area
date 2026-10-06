# IELTS Coverage Matrix

Status: **honest inventory**, not a marketing table. A row is `DONE` only when
content can be created, published, given to a learner, attempted, scored and
reviewed *within the canonical system*. Anything less is `PARTIAL` or `MISSING`,
with the specific gap named. Nothing here is claimed as 100%.

Legend: **DONE** · **PARTIAL** (some path exists, named gap remains) · **MISSING**.

---

## 1. Academic and General Training

| Track | Listening | Reading | Writing | Speaking | Mock |
| --- | --- | --- | --- | --- | --- |
| Academic | DONE (same material) | DONE — canonical `reading:general_set`, Academic score policy | PARTIAL — `task1`/`task2` authored; Task 1 visual data is described, not rendered from a spec | DONE — part 1 / part 3 questions + cue cards | PARTIAL — composition, timing, navigation, score policies and binding are DONE; learner exam runner is behind the mock runner surface |
| General Training | DONE | DONE — General Training score policy is a separate policy version | PARTIAL — `task1` letter tasks exist as content; no letter-specific template enforcement | DONE (same material) | PARTIAL — same as Academic; a full GT mock composes and publishes, the learner runner is the shared one |

The two tracks are separated where they must be — reading score policy, writing Task
1, composition rules — and shared where the exam shares them. No IELTS assumption
is baked into shared infrastructure (§3, §68).

## 2. Listening

| Item | State |
| --- | --- |
| Canonical content | DONE — `listening:full_test` imported from a package, converted, hashed, versioned |
| Native structured model | DONE — sections, groups, questions with typed answers |
| Authored from scratch | PARTIAL — `full_test` authorable; `section` and `question_type_practice` have no author yet |
| Learner runner | DONE — attempt → answer → submit → score, version-bound |
| Attempt binding | DONE — `listening_attempts.content_version_id` |
| Assets | DONE — private object storage, signed access |
| Review | DONE — answers, evidence, keys from the bound revision |
| Vocabulary | DONE — occurrences resolve through the shared lexical system |

## 3. Reading

| Item | State |
| --- | --- |
| Canonical content | DONE — `reading:general_set` import + conversion (the strongest path in the repo) |
| Authored from scratch | PARTIAL — `general_set` authorable; `passage`, `passage_set`, `full_test`, `question_type_practice` have no author yet |
| Attempt binding | DONE — `reading_attempts.content_version_id` |
| Score policy | DONE — separate Academic / General Training policies, versioned; per-section scores never collapsed |
| Learner runner | DONE |
| Review | DONE |

## 4. Writing

| Item | State |
| --- | --- |
| Canonical tasks | DONE — `writing:task1`, `writing:task2` authored, versioned, assignable |
| Submission + attempt binding | DONE — `writing_submissions.content_version_id` |
| Human/AI grading | DONE — grading requests and feedback records; AI has no publish authority |
| Other writing content types | PARTIAL — `lesson`, `model_text`, `pattern`, `translation_set` exist as legacy tables (COMPATIBILITY ONLY); they are not yet canonical content types |
| Task 1 visual data | PARTIAL — the visual is stored and shown as an asset/description; no chart-spec → renderer contract yet |

## 5. Speaking

| Item | State |
| --- | --- |
| Canonical bank | DONE — `part1_question`, `cue_card`, `part3_question` authored and versioned |
| Attempt binding | DONE — `speaking_attempts.content_version_id` |
| `topic_set`, `shadowing`, `material` | MISSING as canonical types — legacy speaking tables remain readable (COMPATIBILITY ONLY) |
| Band judgment | DONE — recorded criteria, no fabricated bands |

## 6. Grammar

| Item | State |
| --- | --- |
| Canonical topic | DONE — `grammar:topic` authorable, publication-gated for learners |
| Exercise binding | DONE — `grammar_attempts.content_version_id`; an attempt records the revision it was given |
| Exercise authoring | PARTIAL — exercises are authored inside their topic; there is no standalone `grammar:exercise` author |

## 7. Vocabulary (one lexical system)

| Item | State |
| --- | --- |
| Lexeme → sense → occurrence | DONE — one store, shared by Reading, Listening, TED/Podcast, lessons and vocabulary packs |
| Topic packs as canonical content | DONE — authored, versioned, published; built-in packs are a compatibility fallback |
| Retention texts | PARTIAL — own tables and rotation, not yet canonical `vocabulary:retention_text` |
| Writing topic vocabulary | PARTIAL — still on its legacy table; classified MIGRATE (see LEGACY-MIGRATION.md) |

## 8. Mock

| Item | State |
| --- | --- |
| Orchestration object | DONE — composed by reference and pinned revision |
| Academic / General Training | DONE at composition; PARTIAL at the learner runner (shared runner) |
| Sectional and full mocks | DONE — `sectional`, `full`, `diagnostic`, `custom` |
| Timers server-authoritative | DONE — plan + `sectionStateAt` from the server clock |
| Navigation policy | DONE — per-mock data, formal rules enforced |
| Section scores | DONE — per-section raw score and band stored and shown; never one hidden number |
| Compatible material rules | DONE — track rules, ordering, question counts, pinned revisions |
| Learner exam runner (full e2e) | PARTIAL — the mock surface exists; the section-by-section formal runner is not yet wired end-to-end on top of the new composition object (§98 remains open) |

## 9. Everything else on the §112 list

| Area | State |
| --- | --- |
| Registries (content type, question type) | DONE |
| Versioning + attempt binding | DONE |
| Assignments over canonical content | DONE — creation, roster boundaries, per-student status, learner list |
| Role-bound assignment workflows (teacher UI) | PARTIAL — service + API are done; the teacher-facing workflow screens are not |
| Lessons + typed blocks, video/audio lessons | DONE |
| TED/Podcast DB-driven | DONE |
| Source identity + duplicate detection | DONE |
| Import vs authoring vs composition | DONE — separate surfaces, one writer |
| Validation matrix (§48/§90) | PARTIAL — import, payload and answer-shape validation are real; a single generated matrix of "every content type × every check" is not yet emitted |
| Native preview (§49) | PARTIAL — descriptor-level previews exist for import; a preview of an authored draft for every content type is not yet uniform |
| Publication workflow | DONE |
| Authoring workspace / create-from-scratch (§34/35) | PARTIAL — APIs and 10 registered authors exist; the admin workspace screens are minimal |
| AI output through validation, no publish authority | DONE |
| Banks, taxonomy/tags, search/filters (§37–§40) | PARTIAL — taxonomy and content types are canonical; bank/search/filter surfaces over canonical content are incomplete |
| Attempts/autosave/resume/retry/review/results/progress/history/dashboards (§50–§61) | PARTIAL — attempts, review and progress exist per skill; not uniform across every content type |
| Mock builder + compatibility rules (§62–§65) | DONE for composition; builder UI is PARTIAL |
| Learning paths / locks (§66/§67) | PARTIAL — courses/modules/units/lessons exist with progress; path locking rules are not yet canonical |
| Future-course reuse, thin HTTP + services, normalized storage, private assets | DONE |
| Audit/provenance/copyright boundaries | DONE (provenance on every revision; private assets; no copyrighted question text imported) |
| RIWI boundaries, retention, performance, answer-key security, randomization, accessibility, responsive, tokens, focus, cards, owner preview (§77–§89) | PARTIAL — the security and RIWI invariants hold; the UI-polish items (§83–§89) are not all re-verified after Phase 2 |
| Legacy inventory + migration safety | DONE — classified, nothing deleted |
| §108 documents | DONE — this file and its siblings |

## 10. What this matrix deliberately does **not** claim

No browser acceptance, no R2/provider behaviour, and no "100% complete" statement.
Every `PARTIAL`/`MISSING` row above is work that remains; the companion
`LEARNERS-AREA-CONTENT-MAP.md` gives the file-level view of the same state.
