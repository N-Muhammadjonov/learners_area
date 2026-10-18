# V5 validation scope and reproducible gate

Primary workspace build211unit/202Chromium fixtures pass. Exact suite totals:27original,14V2,49V3,72V4,40V5. No historical test file edits. No filtered-zero run is accepted as a full result. Unit211/0/0; V5 latest full40/0/0. Source-state audit/ledgers are frontend claims, not live or pixel-comparison acceptance.

Commands (Node>=22/Python packaging tool only):

```
npm ci --ignore-scripts
npm run build
npm test
node scripts/regression-v5.mjs
node tests/browser-v5.mjs
node scripts/performance-v5.mjs
node scripts/assets-css-v5.mjs  # source checkout only; original read-only assets required
python3 scripts/package.py
python3 scripts/package.py --verify
python3 scripts/package.py --v4 --verify
```

The final independent validation is executed in `node_modules/v5-independent` (excluded scratch, not shipped as source) after fresh ZIP extraction with no original app tree. Fresh npm ci/build/full units/all202browser cases, packaged asset hashes/compiledCSS, original historical archive hashes, ZIP member hashes/sidecar and repeated ZIP hash are checked. Tests legitimately rewrite reports/screenshots: independent fresh results are copied outside the self-hashed archive, then packaged evidence bytes are restored before the final internal manifest check. This is not hiding failures; the external independent results/logs remain the source of truth. Install/dependency/build/manifest/browser logs plus exact local/remote SHA and ZIP SHA are recorded in `deliverables/V5_VALIDATION.txt` after execution. This document does not embed its own ZIP hash/commit SHA recursively.

Asset evidence25hash-identical source copies and deterministic source/compiled CSS are not original rendered screenshots. Runtime npm audit reports0; dev5high remains documented. CSP/opaque iframe/server authority preserved; production change0. No Safari/live provider/backend/media/microphone/production acceptance.
