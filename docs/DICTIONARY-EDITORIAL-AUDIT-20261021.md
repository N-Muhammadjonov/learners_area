# Dictionary editorial audit — 2026-10-21

Status: **INCOMPLETE — do not merge or activate as a completed dictionary.**

## Source identity and scope

The current production Reading body fingerprint matches the existing 105-passage local source. All 75 Retention version bodies and all 32 non-programme Listening transcript bodies also match their current production fingerprints. These are content-only identity checks; no learner table was exported or changed. Production main remains `bfd169ffff97c948c916c0549734339bcc57ba85` at this checkpoint.

The 212 requested material identities are present. Listening Test 8 contains an explicit missing-transcript notice in all four sections; Listening Test 10 contains four empty sections. Thus 30 Listening tests currently have genuine transcripts. Original local owner-provided audio was recovered for the missing two. ASR drafts were produced separately and have **not** been published, treated as verified, or substituted for source text. Names, numbers, homophones and boundary repetitions still require audio review.

## Verified inventory

The active source remains complete: **64,616 entries / 109,487 senses / 81,099 original example pairs**. Presentation changes preserve the immutable source English, Uzbek and IDs.

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

- Dictionary choices and authored contextual lookup now supply sense-specific study metadata. The text popover displays that meaning’s synonyms, collocations and examples, including for an already saved word. Changing a selected meaning replaces the study material; another sense’s phrases do not remain visible.
- Authored occurrence definitions retain authority. Catalogue study data attaches only to an exact term/definition/POS match or its exact canonical sense identity. An unavailable optional catalogue cannot suppress the authored definition. Academic lexical restrictions remain enforced before access.
- Added 77 original English–Uzbek usage pairs to the existing curated presentation and extended the relevant collocation groups. This is a bounded editorial batch, not a claim of full dictionary completion.
- Prepared a source-checked additive supplement: **18 new entries, 1 existing entry extended, 19 added senses, 19 original example pairs, 29 synonym links, 33 collocations**. Existing sense fields remain unchanged. English meanings and aliases are bound to exact Open English WordNet 2025 plus synsets. Uzbek translations/examples remain AI editorial drafts. The supplement has not been staged or activated in production.
- Earlier local Reading work includes temporary sky-blue selection, first-press toolbar dismissal, contextual highlight removal, save-before-Back for General Reading and server-enforced Academic sequential unlocking. The Ronalds final five questions and Climate Changers Q10 now have a prepared source-revision manifest and a transactional revision service. It replaces only the live catalogue slot, clones the source questions/groups/paragraphs/occurrences, and leaves old Academic attempts, answers and General results on the original IDs. New set snapshots record the corrected keys. Local PostgreSQL tests verify old/open attempts still score against their original 40 questions, a new attempt receives the correction, retries are idempotent, stale source hashes fail and learner identities cannot apply revisions. These repairs are not yet applied in production.

## Additional bounded review and validation

Five Retention texts were read in full. The first has 51 explicitly selected sense spans covering 43 distinct meanings; the other four have not yet received per-word annotation. Names and grammatical senses that cannot be matched honestly remain in a separate queue. In the first text, `school` as an institution and the period of lessons in `after school` use different sense IDs. This partial ledger is not full contextual coverage.

The general `bus` meaning no longer lists `double-decker`, `charabanc` or `jitney` as unrestricted synonyms. The narrower definitions were checked against the dictionary publishers; each exclusion is limited to the reviewed head/meaning and retains its source and reason. Canonical source senses remain present.

Exact-sense dictionary saves now carry that meaning’s phrases into flashcard metadata. Existing authored phrases and learner progress are preserved. The hybrid-storage integration test covers both an existing mapped sense and a newly materialized sense.

The local isolated browser showed the authored `malnourished` definition, its three collocations and its matching English–Uzbek usage example. A single outside click dismissed the popover, native selection and highlight toolbar. The popup rectangle was at x=2228, y=12, width=320 within a 2560×1440 viewport, with dark-blue background and light text. Native screenshots only captured the left 1836 pixels, so the screenshot does not establish full visual acceptance of the right-hand popup. No real account was impersonated or changed.

At this checkpoint, 19 targeted server/integration tests and 28 UI checks passed; ESLint and the production build passed. This is local validation, not GitHub CI or production acceptance.

## Completion gate

`src/lib/dictionary/editorial-audit.ts` distinguishes full inventory coverage from semantic review. A review is tied to the exact meaning hash, study-material hash and source-text hash. Context spans must point at authentic source characters and the recorded sense. Meaning, example, phrase or source changes invalidate stale review receipts. An applicable relation must have actual material; a non-applicable relation needs an explicit referenced editorial rationale. Nothing generates a fake synonym or a generic filler sentence to satisfy a counter.

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
