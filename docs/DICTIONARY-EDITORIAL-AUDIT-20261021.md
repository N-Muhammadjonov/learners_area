# Dictionary editorial audit — 2026-10-21

Status: **INCOMPLETE — do not merge or activate as a completed dictionary.**

## Source identity and scope

The content-only production snapshot taken for this audit matched the existing 105-passage local Reading source. All 75 Retention version bodies and all 32 non-programme Listening transcript bodies also matched their snapshot fingerprints. No learner table was exported or changed. A fresh remote fetch on 2026-10-22 still places main at `bfd169ffff97c948c916c0549734339bcc57ba85`. Source hashes are rechecked at application time; the old export is not assumed to establish current content identity indefinitely.

The 212 requested material identities are present. Listening Test 8 contains an explicit missing-transcript notice in all four sections; Listening Test 10 contains four empty sections. Thus 30 Listening tests currently have genuine transcripts. Original local owner-provided audio was recovered for the missing two. ASR drafts were produced separately and have **not** been published, treated as verified, or substituted for source text. A second small.en recognition pass covers all five original audio files. Names, numbers, homophones and boundary repetitions still require source/audio review. The web copy of the music conversation repeats the suspicious “music shopper” wording and is not independent confirmation; no matching Cambridge edition has been identified. A completed third medium.en pass on the short ambiguous excerpts still yields “music shopper” and a phonetic “Silver Low”. It remains a draft rather than a direct-listening certificate. “Genre” is an editorial inference, not verified wording.

## Verified inventory

The active release inventory remains: **64,616 entries / 109,487 senses / 81,099 original example pairs**. Presentation changes preserve the immutable source English, Uzbek and IDs.

| Check | Current result |
| --- | ---: |
| Senses with a visible headword-matching example | 32,948 |
| Senses missing such an example | 76,539 |
| Senses with synonym links | 61,773 |
| Senses with collocation/phrase material | 2,167 |
| Invalid related-sense targets | 0 |
| Explicitly reviewed original usage-example senses in this batch (AI, not human) | 78 |
| Explicitly reviewed collocation groups in this batch (AI, not human) | 80 |

An inventory check does not establish contextual correctness. The full-text/content-word review ledger and complete synonym audit remain pending. A word/spelling hit or one available dictionary sense is not proof of the intended meaning of an occurrence. In particular, `Zealand` must not be linked to the Danish island when the passage says `New Zealand`.

## Implemented, local candidate only

- Reading, Listening and Retention popovers display only the meaning bound to the exact authored occurrence, with that meaning’s study material. They never show a sense chooser, select a first spelling hit, reuse another saved meaning or ask the learner to author the missing translation. The general dictionary retains its normal multi-sense entry view. Missing course bindings remain an explicit incomplete-content state, not a guessed meaning.
- Authored occurrence definitions retain authority. Catalogue study data attaches only to an exact term/definition/POS match or its exact canonical sense identity. An unavailable optional catalogue cannot suppress the authored definition. Academic lexical restrictions remain enforced before access.
- Added 77 original English–Uzbek usage pairs to the existing curated presentation and extended the relevant collocation groups. This is a bounded editorial batch, not a claim of full dictionary completion.
- Prepared a source-checked additive OEWN supplement: **18 new entries, 4 existing entries extended, 22 added senses, 22 original example pairs, 27 new synonym links, 42 new collocations**. The counts exclude relations already present in the extended entries. This includes the missing production/preparation meaning of `make`, object-transport meaning of `take`, and container-content meaning of `hold`. Existing sense fields remain unchanged. English meanings and aliases are bound to exact Open English WordNet 2025 plus synsets. Uzbek translations/examples remain AI editorial drafts. The supplement has not been staged or activated in production.
- A separate original context supplement prepares **33 new entries and 4 existing entry extensions**, with 37 original example pairs and 49 explicitly labelled usage frames. It covers missing prepositional/conjunction uses, time expressions, proper names, and selected contextual meanings of gone, storm, break and fair. The storm definition avoids inventing a Beaufort wind speed for an ordinary weather story; fair does not presume competitive prizes or a travelling show. Names receive no invented synonyms. References support facts; proprietary dictionary examples and definitions are not copied.
- Earlier local Reading work includes temporary sky-blue selection, first-press toolbar dismissal, contextual highlight removal, save-before-Back for General Reading and server-enforced Academic sequential unlocking. The Ronalds final five questions and Climate Changers Q10 now have a prepared source-revision manifest and a transactional revision service. It replaces only the live catalogue slot, clones the source questions/groups/paragraphs/occurrences, and leaves old Academic attempts, answers and General results on the original IDs. New set snapshots record the corrected keys. Local PostgreSQL tests verify old/open attempts still score against their original 40 questions, a new attempt receives the correction, retries are idempotent, stale source hashes fail and learner identities cannot apply revisions. These repairs are not yet applied in production.

## Additional bounded review and validation

65 Retention texts and the first Reading passage were read in full. The first fifteen Retention texts now have **925 explicit word/phrase bindings covering 967 content-word tokens**, tied to source and meaning hashes. The prepared full-corpus candidate audit has zero unreviewed content-word tokens in those fifteen texts and still reports **197 unreviewed texts**. This is a partial candidate, not deployed coverage. `left` uses the forgotten-object and departed-place senses in different positions; `minutes` uses the time unit. Existing correct `bus stop`, `looking worried`, `half past eight`, `class trip`, `bus station` and `the night before` phrase identities are retained. The reproducible partial plan and selected meaning glosses are in `content/dictionary/reviewed-context-links-draft.json`.

The exact-binding importer checks the active release, immutable meaning hash, complete source-body hash, real surface/form, phrase parts, source-relative offsets and prior occurrence identity in one transaction. Listening offsets stay relative to their own section/segment. Overlapping old annotations need explicit review rather than silent deletion. Authored discontinuous forms such as `picked it up` have explicit validated parts; no whole-sentence sense propagation occurs. A source edit or conflicting old link aborts the batch. No application endpoint exposes this editorial import to learners.

An isolated PGlite run against the fifteen actual content snapshots inserted 835 missing links, corrected 21 explicitly reviewed old links and retained 69 existing links. A second application changed nothing (925 unchanged), every resulting English definition and Uzbek translation matched its selected canonical sense, and fictional learner SRS data remained byte-for-byte unchanged. This was a disposable local database, not a production application. That check also exposed the source lexical-type label `other`, which the app enum cannot store; exact-sense materialization now converts unknown labels using the authored POS and word/phrase shape while preserving recognized types.

The new batch also distinguishes a building window from a train window, a calendar date from a date fruit, a drawn heart/star from an organ or celestial body, a cooking pot from a flower pot, a fictional story from a real journey account, and the direction left from departing or forgetting an object. Ben and Lily use proper-name entries rather than a mountain or a flower. The adverb higher uses an authored degree form; admitting this spelling never selects a meaning automatically.

The general `bus` meaning no longer lists `double-decker`, `charabanc` or `jitney` as unrestricted synonyms. The narrower definitions were checked against the dictionary publishers; each exclusion is limited to the reviewed head/meaning and retains its source and reason. Canonical source senses remain present.

Exact-sense dictionary saves now carry that meaning’s phrases into flashcard metadata. Existing authored phrases and learner progress are preserved. The hybrid-storage integration test covers both an existing mapped sense and a newly materialized sense.

The local isolated browser showed the authored `malnourished` definition, its three collocations and its matching English–Uzbek usage example. A single outside click dismissed the popover, native selection and highlight toolbar. The popup rectangle was at x=2228, y=12, width=320 within a 2560×1440 viewport, with dark-blue background and light text. Native screenshots only captured the left 1836 pixels, so the screenshot does not establish full visual acceptance of the right-hand popup. No real account was impersonated or changed.

The previous checkpoint passed 19 targeted server/integration tests and 28 UI checks. The search and Reading regression run passed 23 tests, with one real-PostgreSQL concurrency test skipped because its isolated QA target was not enabled. The latest context-only dictionary/popover run passed 38 DOM UI tests; the exact-binding/editorial/storage suite passed 13 tests including nested cases. A later focused regression run passed 26 tests including nested cases, covering the expanded binding workflow, hybrid storage, shared search normalization and the Writing route guard. TypeScript, ESLint and the production build passed. The previously failing CI route inventory and apostrophe checks are corrected locally; fresh CI must be checked against the new pushed revision. These overlapping runs must not be added together as a count of unique tests. This is local validation, not production acceptance.

The native local browser also showed `malnourished` opening its authored adjective definition and Uzbek translation directly, without a sense selector. An unbound `win` showed only the incomplete-content state, with no selector, guessed definition or save form. The screenshot remains cropped before the far-right popup, so the accessibility result proves the displayed content while the image establishes only the visible sky-blue selection.

## Global search candidate

The header search now queries the published content catalogue and full active dictionary as well as real module/section navigation. Results include General passage titles, Academic set titles, Listening tests, Writing questions, Speaking questions/materials, grammar, lessons and TED/Podcast titles. Private vocabulary and assignments remain scoped to the requesting account. Locked Academic passage names, answer keys, source bodies and learner submissions are not searched or returned.

Canonical General results carry their set and passage number. Dictionary results carry the exact entry identity and lookup language. A published Writing question has a read-only preview; an explicit button starts a submission. Speaking materials have stable anchors. A search-provider outage is shown as a recoverable failure/partial result, not a successful empty response. Closing the result list no longer reopens it through restored input focus.

In a disposable local browser with a fictional account, a General passage result opened its correct single-passage study route and Back returned to the catalogue. A dictionary result opened the exact `predict` entry and displayed its authored sense with pronunciation, usage pair and per-sense relation sections. The production build includes the new Writing question route. This search candidate is not deployed or merged at this checkpoint.

## Completion gate

`src/lib/dictionary/editorial-audit.ts` distinguishes full inventory coverage from semantic review. A review is tied to the exact meaning hash, study-material hash and source-text hash. Context spans must point at authentic source characters and the recorded sense. Morphology admits candidates but cannot choose one; equally specific conflicting meanings cannot establish coverage. `can`, `May`, `will` and `US` cannot disappear through a lowercase function-word filter; auxiliary uses require explicit contextual exemptions. Meaning, example, phrase or source changes invalidate stale review receipts. An applicable relation must have actual material; a non-applicable relation needs an explicit referenced editorial rationale. Nothing generates a fake synonym or a generic filler sentence to satisfy a counter.

`scripts/dictionary/audit-editorial.ts ... --require-complete` fails until all expected materials, meaningful word occurrences, examples and relevant relations have current review records. At this checkpoint it correctly returns **readyForManualCheck=false**. It is a report-only tool and never writes dictionary, course or learner rows.

## Remaining work before merge

1. Finish audio verification of the two recovered Listening transcript drafts and publish appropriate source revisions while preserving existing results.
2. Read and annotate all 212 material contexts, including proper names and multiword units; resolve the missing forms from primary sources with sense-specific Uzbek and usage material.
3. Supply and review the remaining **76,539** missing usage examples, inspect synonym/phrase applicability across all **109,487** senses, and correct semantic errors rather than only spelling mismatches.
4. Apply the Reading test corrections through new source versions that preserve historic attempts, keys and results.
5. Run complete-source readiness, regression, browser checks and deployment verification before the authorized main merge. Passing unit tests or a successful build alone must not be reported as the completed editorial objective.

## Additional primary source

Open English Wordnet 2025 plus: https://en-word.net/downloads/english-wordnet-2025-plus-json.zip

Archive SHA-256: `8832b8fa26a14c0ba8c99bb1ef8db6f9e122a6d9193b65ca9e0ef572580fee7e`. CC BY 4.0; upstream Princeton WordNet license applies to incorporated elements. Source archive, audio, full corpus, ASR drafts and detailed queues are local working inputs, not Git payloads.
