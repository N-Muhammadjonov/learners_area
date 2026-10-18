# Learners Area — Vanilla migration checkpoint

**STATUS: PARTIAL. This is not the complete migration requested and is NOT production-ready.**

The original Next.js application is unchanged. All additions are isolated here. No backend,
database, Railway, Worker/R2, authentication configuration or production service was changed.

## Actual coverage

- Source-discovered: **115 page files, 206 component files, 214 API route files, 13 route boundaries**.
- Active-route semantic inventory: **not complete**; page count is not an active-route count.
- Two page conversion candidates: `/` and `/auth/recovery`; **zero fully parity-verified routes**.
- Original global not-found candidate and historical URL normalization are included.
- **113 page entries are not converted**, including all educational and staff interfaces.
  They display an explicit migration-status message. That message is NOT a converted interface.
- No persistent private shell, educational module conversion, live Telegram integration,
  exam integration, session-revocation listener, recording or uploads are claimed.

See [handoff](docs/GPT_WORK_HANDOFF.md), [route matrix](docs/ROUTE_MIGRATION_MATRIX.md),
[limitations](docs/KNOWN_LIMITATIONS.md), [functional report](docs/FUNCTIONAL_PARITY_REPORT.md).

## Reproduce without the original Next.js app

Node 22.22.3 was used; Node >=22 is required. Python 3 is used **only for archive packaging**,
not as an application backend. Native browser ES modules are the only frontend runtime.

```sh
cd migration/vanilla-frontend   # or the extracted archive directory
npm ci --ignore-scripts
npm run build
npm test
npm run preview               # 0.0.0.0:4173; PORT may override
```

Open the preview at its exposed browser URL. Absolute-root asset URLs require serving at the
origin root. Opening `index.html` as `file://` is not supported. No Next.js server is needed.
The preview serves only `build/`, never the repository or documentation. API requests return
**503 JSON `backend_not_connected`**. There is intentionally no production proxy and no demo account.
Authentication-dependent functionality is not usable in this disconnected preview.

### Optional real-browser smoke and measurements

With the preview running on 4173, in a second terminal:

```sh
node tests/browser.mjs
node scripts/performance.mjs
```

These use pinned development-only Chromium 133 and Playwright Core. The browser helper extracts
package-supplied Linux libraries into ignored `node_modules/`. It uses no production credentials.
Host OS support is Linux x86_64; Safari needs a separate real Apple/WebKit test environment.
Browser tests use isolated preference-response fixtures, never production responses.

```sh
npm run inventory    # SOURCE CHECKOUT ONLY; refreshes structural inventory, not semantic review
npm run package      # deterministic ZIP + per-file hashes; does not include node_modules/build/.git
python3 scripts/package.py --verify
```

`npm run build` refreshes dictionaries, CSS, aliases, assets and safe redirect code when the
original source tree is present. The extracted archive includes these inputs and builds independently.
The compiled CSS is conventional CSS. Fonts and licenses are preserved. Dependency audit has
**7 development-only findings (5 high, 2 moderate)**; see limitations. No npm runtime dependencies
are imported by the delivered browser app. Do not hide the audit findings or upgrade Tailwind
across major versions without visual regression tests.

## Safety

Do not deploy, merge, repoint the domain, or attach this preview to production data.
The assigned delivery branch is `arena/96836bcf-learners-area`; do not mutate `main`.
Read all acceptance failures in the handoff before treating this as an integration candidate.
