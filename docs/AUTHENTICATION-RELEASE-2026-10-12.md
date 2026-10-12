# Authentication release and Telegram cutover

Approved website source: `arena/learners-area-next` at
`ea080a9da69af149c67fd27281d0bcb053258a6b`. GitHub comparison with main
`bcbf3ebdf54039c3807fcf9479dec5b5c306a0ea`: 546 ahead, 0 behind;
main is the merge base. This release preserves that website and its approved
owner day logo/profile avatar. No RIWI work, material upload or production
migration is part of this release.

## Prepared, not activated

`PUBLIC_AUTH_MODE=standard` is the default. All existing public authentication
remains available until real Telegram E2E verification. No production variables
were set to activate enforcement in this release.

After real Telegram login and bot verification on https://learnersarea.uz, set:

```text
PUBLIC_BASE_URL=https://learnersarea.uz
PUBLIC_AUTH_MODE=telegram-only
TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN=https://learnersarea.uz
```

Existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` must also be present.
The attestation must exactly match the HTTPS origin of PUBLIC_BASE_URL. Missing
or mismatched attestation or bot configuration keeps standard authentication.
This marker records an operator-verified result; its presence is not itself
proof of a real Telegram login. Never set it based on unit/fixture tests.

Telegram-only mode hides the password login/register/reset forms and Google
button. Password login, registration and both password-reset endpoints, plus
Google start/callback, return 403 before provider/database/hash work. Public
reset pages redirect to login. The existing widget/callback architecture,
accounts, hashes, admission rules, sessions and database authorization remain.

The widget executes in its own DOM container to avoid React 19 async-script
hoisting, receives the request CSP nonce and uses the narrowly permitted
https://oauth.telegram.org iframe. HMAC verification retains the existing
algorithm and now refuses malformed IDs/hashes and distant-future timestamps.

## Owner/admin recovery and rollback

`/auth/recovery` uses `/api/auth/recovery/login` and the preserved password
implementation. It issues a session only after valid password proof for an
existing ACTIVE database owner/admin. Student/teacher, pending/suspended,
missing account and wrong password all fail with the same 401 and no cookie.
No request parameter or role claim grants recovery access. Existing per-account
and per-IP limits, constant-time decoy password comparison, same-origin
middleware, secure HttpOnly cookies and current-user database authorization
remain. The recovery form contains no public registration/reset/provider links.

Email delivery recovery was already unavailable in deployed environments and is
not introduced here. If credentials are unavailable, the deployment operator
can restore public methods by setting PUBLIC_AUTH_MODE=standard and redeploying.
This changes no database records or hashes. Existing sessions are not revoked.
Do not regenerate AUTH_SECRET, bootstrap a new owner or change roles to work
around a missing configuration.

## Verified Railway identity and configuration

Project: Learners-area, `fa66cadd-5364-47bd-95f9-0689b0562269`.
Service: learners_area, `68f0cfac-8723-40e7-9c3c-52856dc06786`.
Production environment: `e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a`.
Source: N-Muhammadjonov/learners_area, branch main, auto-deploy enabled.
Domains: learnersarea.uz and learnersarea-production.up.railway.app, port 8080.
No pre-deploy command was configured. Default build/start use package scripts;
they do not run migrations. `/api/version` now also reads RAILWAY_GIT_COMMIT_SHA.

The inspected production service listed 11 custom variables, with values hidden.
AUTH_SECRET, PUBLIC_BASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and
BOT_SERVICE_SECRET were absent from that list. Recover existing credentials
privately through the owner's trusted deployment setup; do not expose them in
chat, logs or Git, and do not rotate the bot token unnecessarily. Reconfirm the
configuration and real recovery access before launch. Successful container
startup alone does not prove authentication or database compatibility.

## Separate existing bot integration

The preserved bot source is on `codex/archive-production-telegram-bot-20261011`
at `0bdba18306a1f0b800aa4f22772d6edeb2078364`, under services/telegram-bot.
It was inspected, not recreated, deployed, modified or merged by this release.
Its configuration requires:

- Existing TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME.
- Matching BOT_SERVICE_SECRET in the website and bot.
- INTERNAL_API_URL=https://learnersarea.uz/api/internal/telegram (or a trusted
  private Railway endpoint with the same API path).
- PUBLIC_SITE_URL=https://learnersarea.uz.
- BOT_MODE=webhook, HTTPS WEBHOOK_BASE_URL, existing WEBHOOK_SECRET,
  WEBHOOK_PATH=/telegram/webhook, TELEGRAM_OWNER_ID and Railway PORT.
- Health check GET /health. Only one active consumer/webhook per existing bot.

Important compatibility finding: the approved website tree contains the legacy
widget callback at /api/auth/telegram/callback but does not contain the bot's
/api/internal/telegram backend or its auth-intent confirmation endpoint. The
archived bot calls /ready, /users/:telegramId, /auth/confirm and other endpoints
under that prefix. Deploying this bot without reconciling its preserved backend
will not integrate it with this website. Resolve that integration in the next
bot phase while preserving the approved website and separate RIWI branches.

For the retained legacy widget, BotFather /setdomain must associate the same bot
with learnersarea.uz. See https://core.telegram.org/widgets/login-legacy.
Do not migrate the website to a new Telegram/OIDC architecture in this release.

## Acceptance before activation

Verify real login/cancel/retry on https://learnersarea.uz, the signed callback,
secure session, reload/logout, approved/pending/suspended routing and live
owner/admin recovery. Verify the existing bot /start, readiness, webhook secret,
website API authentication and one-time confirmation flow once its backend is
integrated. Forged/stale/malformed callbacks and unauthorized recovery must fail.
Retain a private evidence receipt identifying the bot, website commit, origin and
time. Only then set the cutover variables and verify both UI and endpoint denial.
The website is not declared launched before this acceptance.

## Automated evidence and limits

The release has policy/route/PGlite recovery tests, EN/UZ DOM tests and a
GitHub Actions production-build HTTP test. These use disposable fixture
credentials and no production database. They cannot certify real Telegram E2E.
Local HTTP startup is blocked by host sandbox EPERM on port binding, so HTTP
transport acceptance is run on the GitHub Actions runner. Native PostgreSQL
checks that require a separately configured disposable database remain skips.
