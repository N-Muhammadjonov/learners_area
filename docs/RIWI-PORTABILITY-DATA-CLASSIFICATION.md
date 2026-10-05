# RIWI portability data classification

`PORTABILITY_TABLES` is the normative, closed table allowlist. Every Drizzle table has one class and explicit scope list. CI test `schema classification is closed...` prevents silent inclusion.

- **riwi-core:** approved knowledge units/sources/conflicts and approved assessment policy/version metadata; allowed in A/B.
- **site-content:** canonical Learners Area educational content; allowed in A/C.
- **site-private:** identities, progress, submissions, evaluations, conversations and Speaking data; allowed in A/C subject to private archive policy.
- **governance-private:** audit, candidate learning, experiments, confirmations and usage; full-system only unless a future reviewed sanitizer creates a distinct portable artifact.

Speaking transcripts, attempts, sessions and audio are site-private. RIWI-only exports exclude them. Knowledge source objects and Speaking audio have distinct object classes. Password/token hashes are private authentication verifiers, not deployment credentials, and may move only in an encrypted full-system package. API keys, `DATABASE_URL`, R2 secrets, session tokens and credentials are prohibited in every mode. Deleted/expired rows and objects are excluded.
