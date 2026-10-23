# Learners Area — Speaking V48 + Writing V50 integration candidate V52

Source of truth: `main` (READ ONLY). Target: `arena/96836bcf-learners-area`.
Remote HEAD inspected on 2026-10-23: `6890554650dde1168e0f0654557f3e130f353db5` (Grammar V48). Preserve newer commits.

This archive contains the V51 collision-aware overlay of the original Speaking V48 / Writing V50 staged modules, plus one Writing autosave correctness fix and focused browser regression tests. It is **NOT pushed or applied to GitHub**.

## Confirmed correction in V52

`modules/writing/exam.js` previously accessed a mutable entry's `revision` after awaiting `/api/writing/exam/:id/draft`. If a second keystroke occurred while the first PUT was pending, the first completion could mark the second edit saved without ever sending it. The PUT now captures an immutable `{content, revision}` snapshot before awaiting the response, and acknowledges only that revision. A new delayed-network Chromium fixture exercises this precise scenario.

## Apply only to an up-to-date clean checkout

```
git fetch origin arena/96836bcf-learners-area
git switch arena/96836bcf-learners-area
git pull --ff-only origin arena/96836bcf-learners-area
node /path/to/extracted/integrate-speaking-writing.mjs /path/to/repository
```

The script does not commit, push, or write outside the 27 Speaking/Writing module assets, three focused QA/test/evidence files, and the scoped `migration/vanilla-frontend/js/routes.js` dispatch. It refuses unrelated changes to existing staged module paths. It also registers the missing `/app/writing/prompts/:id` path and preserves existing Grammar/Listening/Reading/Video route dispatch.

Full branch verification still required after applying. Build instructions from existing package: `npm ci --ignore-scripts && npm run build && npm test`; run existing browser suites sequentially, then `npm run check:assets`. **Do not push** if asset CSS pin, build, or regressions fail; don't repin original assets merely to hide incompatibilities.

## Executed checks for this candidate

- `node --test tests/writing-v51.test.mjs`: PASS, 12/12 Writing true-ESM files and focused contract tests.
- `python tests/writing-v52-browser-smoke.py`: 6/6 synthetic Chromium checks PASS (includes autosave concurrent edit).
- Speaking V48 original `staging-smoke.mjs`: PASS, 13 JavaScript modules + seven route patterns.
- Strict ESM parsing of all 25 JavaScript modules: PASS.

## Untested / limitations

- Complete `npm run build`, asset pin, full repository/browser regression suite **not run** (no authenticated clone in local execution environment). HEAD was verified using GitHub connector only.
- No live backend integration. The existing `/api/frontend/view` is a proposed adapter in `js/adapters/frontend.js`, not proven to exist in the live backend.
- No hardware microphone / full two-client WebRTC / real AI evaluation or EN/UZ rendered visual parity verified.
- No change to GitHub refs, `main`, original Next.js files, FastAPI backend, database or deployments.
