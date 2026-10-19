# Contextual vocabulary for the owner's 75 Retention V4 texts

`entries.tsv` contains 375 context-specific English explanations and Uzbek
translations: five learning units in each original text, A2–C2. The complete
source bodies were read to choose their meanings. Entries include whole
collocations, fixed expressions and separable phrases; the longest exact span
wins over a member word. These are AI-authored editorial drafts, marked
`unverified`, not represented as human-reviewed dictionary entries.

The installer binds each source to exactly one active immutable database version
by its full original body and SHA256, not a reused display label. The existing
lexical engine assigns a canonical sense ID from spelling, POS and English
meaning. Every occurrence gets its own version-bound ID and exact character
offsets. Lookup and save verify the current version, body slice, learner-owned
attempt and server reading deadline. A word without a bound meaning stays
unchecked; no spelling-based fallback silently selects a different sense.

Migration 0063 adds the nullable version FK, source integrity check and unique
version/offset index. Existing content, scoring, results, timers and lexical IDs
are preserved. No source text or lexical spans are supplied in recall/results.
Saved words use the shared Vocabulary engine and a default Retention folder;
they can be learned with the existing word-review activities.

`scripts/install-retention-vocabulary.ts` validates source coverage by default.
`--apply` requires the existing Railway production identity and an exact
`RETENTION_VOCAB_EXPECTED_REVISION` and an active owner in `RETENTION_VOCAB_OWNER_ID`. The whole batch is transactional; missing,
changed, ambiguous or unresolved sources abort it. Reinstallation reuses IDs.

General Reading, Listening and Retention open lookup on a double click (or
keyboard Enter). A single pointer click, a drag, an input gap or empty transcript
space does not open lookup. Authored Listening checks the painted text rectangles
because browser caret APIs otherwise snap whitespace to the nearest word. The
Listening conflict copy is retained in a collapsed hub archive; a new real
conflict is dismissible and does not become a permanent warning on every visit.
