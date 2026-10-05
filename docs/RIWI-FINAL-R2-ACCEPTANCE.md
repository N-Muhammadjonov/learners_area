# RIWI final R2/S3 acceptance

Status: **OWNER ACTION REQUIRED / EXTERNAL REQUIRED**.

No R2/S3 credentials, source bucket, destination bucket or authorized isolated prefix is configured in this workspace. Secrets must be configured in the authorized platform environment and must never be pasted into chat, Git, manifests, screenshots or logs.

## O1 keep-R2 — pending receipt

Must prove server authentication, private-by-default object, authorized learner/staff read, unauthorized denial, authoritative stable object key, temporary signed URL, MIME/size/hash, CORS/rewrite behavior and no public exposure.

## O2 move-objects — pending receipt

Under an authorized isolated prefix: create/inventory source fixture; record bytes/SHA-256/MIME/class; copy; read destination bytes; reconcile bytes/hash/MIME; test authorized and unauthorized access; test partial failure; then clean up or quarantine according to D-04. A successful copy API response alone is insufficient. Source deletion before rollback-window acceptance is forbidden.

The in-memory O1/O2 tests remain code-level evidence only, not real object-store acceptance.
