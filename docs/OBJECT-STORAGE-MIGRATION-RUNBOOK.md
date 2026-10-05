# Object storage migration runbook

O1 (`keep-r2`): keep private R2 objects, configure destination server credentials out-of-band, verify authorized reads and CORS, and copy no object bytes. Database references remain accepted only after the destination can enforce the same ownership checks.

O2 (`move-objects`): inventory objects by class (RIWI source, Speaking audio, other private site), owner/scope/retention state, MIME, bytes and SHA-256. Copy with bounded concurrency and resumable checkpoints. Re-read destination bytes and require exact size/hash before accepting references. Missing, expired/deleted, signature/MIME mismatch or access-class mismatch fails. Never publicize objects or place credentials/long-lived signed URLs in a manifest. Rollback leaves source objects intact until acceptance and retention window end.
