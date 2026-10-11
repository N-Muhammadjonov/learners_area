# RIWI portability acceptance — current independent review

D05 is locally accepted on the exact source in RIWI-GROUPS-25-30-INDEPENDENT-REVIEW.json. The earlier partial table is superseded for D05 only. D04 remains PARTIAL.

Two fresh PostgreSQL16.14 clusters applied 51 canonical migrations to each QA base. Native A/B/C rehearsals verify >1,000 rows, archive checksums/counts, relationship and timestamp preservation, owner mapping, exclusion/expiry canaries, zero-write dry-run and injected mid-import rollback. The existing constraint and concurrency suites ran without skips. Canonical feature IDs use UUIDs; serial feature identities are not used.

Each round also created independent A/B/C source/destination databases and booted the actual application using Next development mode. HTTP checks prove target-owner authentication, restored learner authentication, scope-specific content/search and owner-panel denial. A/C restored original Speaking880 and Listening40; the running app grades 40 original answers including reversed choose-TWO and rejects a repeat submission. Day-eight offline chat is excluded. Listening audio transfer is not claimed.

This is synthetic and original-fixture native restore evidence. It does not assert a production-data migration, production build, browser QA, real R2/S3 movement or live-provider acceptance. O1/O2 real-store inventory/access/read-back/failure/cleanup remains open. No build, deploy, commit or push was performed. Published closure remains the last independently verified 19/34; locally accepted closure is 20/34. The pending batch has one new accepted group and does not meet the five-new-group push policy.
