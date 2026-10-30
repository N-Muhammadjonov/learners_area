# Part 2 dictionary import 26 October 2026

The owner-approved queue contains 123 unique headwords. Five already exist in the current dictionary and are retained. This append publishes 118 custom entries, each with an English definition, an Uzbek translation and definition, and a bilingual example.

## Source and identity

- Source: IELTS_Part2_01-25_Dictionary_Candidates_40(1).txt
- Library identity: libfile_c67d5096ccb48191b38c6677e7e694ab
- Reviewed JSON plan SHA-256: fa88431ed60cf7b14cd2a41d2a9f3d969d2e927bc61217c9ec704a8bd1c4bbae
- Base release: rel-v1-cfadf47e87701f627f3270ce
- Candidate release: rel-v1-977bce7f8dab7e773955238e
- Execution source: commit c6d5d64792997de15bfd956abcd54abb27181762

The existing headwords are hard sell, shop around, work-life balance, do your homework and sore throat. Source items 26, 32 and 40 had unrelated example sentences; the matching sentences from the original sample answers replace them. New senses record owner-supplied editorial provenance and draft Uzbek example translations. Cambridge attribution is not applied to unverified source records.

## Publication controls

The temporary execution hook is limited to the approved production origin and environment, exact source checksum, active owner, 100 saved approved drafts and the exact base release. A durable lease uses the existing dictionary publisher job table. Transaction locks work through a transaction pooler. No Worker, bucket, secret, route or permission is created.

The native immutable shard writer, entry validation, index builder, manifest validator and signed Dictionary Worker are reused. Existing entry IDs, content hashes, sense IDs and example IDs must match the base. All R2 objects are verified before activation. All 123 headwords must return the expected entry ID through the Worker.

The second group of 18 draft records is recorded as published in the same transaction that activates the completed release. Failure leaves the stable channel unchanged. The completed import has an idempotent receipt and the temporary startup hook is removed afterwards.

## Capacity maintenance

All dictionary rows and search terms were retained. Reindexing reclaimed space. Migration 20261026143610 removes dictionary_entries_identity_idx after verifying that the valid unique index on release_id, lemma_norm, part_of_speech, lexical_type, lexeme_id covers its full key prefix and that the removed index backs no constraint.

## Verification

- Targeted tests: 36 passed, including serial/parallel index equality and immutable retries with existing gzip encodings.
- After restoring the regular publisher: 14 native R2 publication tests passed.
- Published and validated at 2026-10-26 15:57:02 UTC. The stable channel points to rel-v1-977bce7f8dab7e773955238e; its previous release remains rel-v1-cfadf47e87701f627f3270ce.
- All 123 exact English searches returned the expected entry through the existing signed Dictionary Worker.
- Independent SQL verification matched all 118 new entry IDs, normalized headwords, parts of speech, lexical types, content hashes, sense IDs and example IDs against the reviewed plan.
- All 64,938 original entries retain their content hashes, sense IDs and example IDs. Changed or missing original entries: zero.
- The release contains 65,056 entries, 109,927 senses and 81,539 examples. All entry payloads are offloaded across 256 R2 shards.
- The verified R2 index contains 1,655 objects, 93 routes and 1,226,256 logical search terms.
- All 118 imported drafts are published. The publish job and import receipt are complete, with no job error or remaining lease.
- All 3,851 sense mappings and 1,201,156 legacy search-term rows remain present.
- Database size after publication: 467,463,315 bytes, below the 500,000,000-byte limit.
- Manifest SHA-256: 3e2f1638bc4127da5fb359093ea97aeacdeebdc2d4d293dc161e174be4ad845c.

The final cleanup removes the startup import hook, temporary import module, source payload and temporary tests, and restores the regular index builder exactly. Reviewed execution source and tests remain in commit c6d5d64792997de15bfd956abcd54abb27181762. The capacity migration and this publication receipt remain in the current tree.
