# Preview Dictionary and Reading approval package

Existing shared Preview approval covers 0037 only. Neither 0038/0039 nor the frozen Dictionary bootstrap has been applied to shared Preview. Production is excluded.

Requested scope: additive migrations 0038_dictionary_releases and 0039_academic_reading_sets, followed by loading verified release rel-v1-606b65c5282a75647c9928c3. Before application, take a fresh native PostgreSQL backup, restore it in isolation, verify strict TLS and target identity, and allow only the reviewed SQL hashes. Preserve existing learner vocabulary identities and report ambiguous mappings instead of merging them.

Reviewed SHA-256:

- 0038: b54e0187c6c5bcafdd7070437c5a9a27d7d3259ba1a93976544da26da74e916d
- 0039: 7d4bb56a0cbc516f7be38da90c46b55e64be2fc7bd4816b1b6fe993642e0ebbd

0038 adds frozen releases, search terms, sense mappings, private recent searches, owner drafts, publication jobs and audit records. 0039 records all three passages on Academic Reading attempts and preserves historical single-passage attempts.

Frozen source commit: 594c00904e07702c27329f1c0ce9ec6dadee1adb. Verified local bootstrap: 62,376 entries, 105,488 senses, 81,099 examples, 1,201,156 search terms. Source compressed SHA-256: ae4130d6b7d9ad1d5a65cb4f56944735e497e9754fd53c6a387097c7aaff650c.

Local evidence in work/evidence: all 40 migrations replayed cleanly; complete bootstrap inventory validated; publication and rollback passed in 962 bounded steps; primary suite 1,071 passes, zero failures, five skips; latest UI suite 214 passes, zero failures; type checking and lint passed. Final focused regression and build verify the last answer-key removal separately.

The read-only Preview plan correctly refused unapproved 0038/0039. This is a review package, not an application or deployment receipt. Guarded shared-Preview bootstrap tooling is now implemented in `scripts/dictionary/bootstrap-shared.ts`. It is fail-closed: `--apply` requires the approved Preview fingerprint/project/server identity, a fresh `PREVIEW_QA_BACKUP_REF`, the exact frozen source hashes/counts, the 0038/0039 schema to already exist, and `PREVIEW_DICTIONARY_BOOTSTRAP_APPROVAL` equal to the frozen `BASE_RELEASE`. The runner never supports Production and writes a redacted receipt. Actual shared Preview migration application, the 62,376-entry bootstrap itself, and authenticated deployed-browser acceptance still require the owner's explicit environment/credential action and are not claimed by this document.
