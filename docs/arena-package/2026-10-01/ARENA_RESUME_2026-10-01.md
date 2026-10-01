# Resume the exact Learners Area package from disk

Product branch: `arena/01a0f1a0-learners-area`.
Expected unchanged product baseline: `dd23e0a3e1d31bb1ac3e68ca7ca016b063905621`.
Reference artifact branch: `arena/reference-materials`.
Artifact folder: `arena-package/2026-10-01/`.

The23-file patch is complete and is NOT a reconstruction. Its SHA256 must be:
`6e3fc30592e22b0883f074bfb076db3e66be72125c698d2b7ec4dc1863b303e0`.

Before coding, persist the artifacts inside the feature checkout. From repo root:

```sh
git fetch origin refs/heads/arena/reference-materials:refs/remotes/origin/arena/reference-materials
mkdir -p docs/arena-package/2026-10-01
for file in arena-current-changes.patch Arena_visual_evidence_2026-10-01_v2.pdf Arena_implementation_and_acceptance_2026-10-01_v2.txt package-manifest.json ARENA_RESUME_2026-10-01.md; do
  git show "origin/arena/reference-materials:arena-package/2026-10-01/$file" > "docs/arena-package/2026-10-01/$file"
done
```

1. Verify downloaded bytes against package-manifest.json (SHA256). PDF must have63pages.
2. Read the current v2TXT and inspect PDF, including new owner screenshots pages57–63.
   Read captions before treating old7r908hz5n screenshots as current deployment evidence.
3. Check clean baseline/remote ancestry. On dd23e0a, run:
   `git apply --check docs/arena-package/2026-10-01/arena-current-changes.patch`.
   If remote advanced, reconcile the intervening diff; do not reset/force-push.
4. Apply the exact patch; run the prescribed checks. Do not reconstruct from memory,
   weaken assertions or call context loss a code blocker when disk files exist.
5. After every context compression, reread this file, the v2TXT and the saved patch.
6. Continue N07 (server-authoritative early read finish), N08 (real-data progress trends),
   N11/N16 import dry-runs and other applicable open work. Several are independent of
   the font/UI patch; inspect them while external secrets/content/DB dependencies remain open.
7. Newly supplied ZIP contains7screenshots; N12 input blocker is resolved. Two error digests
   `149493362` and `2721559850` require current reproduction/log correlation, not guessed causes.
8. Other content, real PostgreSQL, Google configuration, YouTube-player limitations and full
   browser acceptance remain open until proven. Keep auth/ownership/privacy and real URLs.
9. Commit/push to the feature branch without force. Provide requirement-by-requirement report
   tied to exact code and Preview SHA; no100% PASS from code presence or skipped tests.

If direct attachment cannot be read, retrieve from the reference branch as above.
Do not claim the PDF was inspected if you read only its captions; render it to page images
using available PDF tools. Keep the owner's Chrome session untouched.
