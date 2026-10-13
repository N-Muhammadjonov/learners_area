# Telegram production integration — 2026-10-13

Base: main `8e9705e57630dc6671224fe728cf1b9b03f35959`.
Source: feature/telegram-access-bot `57963173c0f2934da383ccaf3abfe776b1ab4da0`.
Integration: `codex/telegram-production-integration-20261013`.
Existing bot: @learnersareaaccessbot. Production: https://learnersarea.uz.

This branch preserves the approved website. No main merge, production migration,
owner promotion, token rotation, bot recreation or webhook cutover is authorized by this document.
Owner approval is required before merging. Email/password stays enabled.

## Components reconciled

Existing Python handlers, API client, owner/admin permission engine, native contact
verification, channel checks, delivery workers and webhook runner are carried forward.
The website gains internal bearer-authenticated APIs and browser-bound, expiring,
one-time login/register/link intents. Live database roles/status remain authoritative.
The approved legacy widget remains available with its original signed-payload verification.
`TELEGRAM_INTENT_AUTH_ENABLED=true` selects the deep-link UI independently of
`PUBLIC_AUTH_MODE`. Default: off. Profile linking uses the signed-in account; it
does not create or promote another account.

The old branch's `telegram-only.ts` and disabled legacy callback are deliberately
not imported. Current main's staged auth policy and Owner/Admin recovery remain intact.
Existing owner website transfer and recovery code are preserved; the existing bot
handover/challenge backend is additive.

## Database requirements

All SQL files and journal entries 0000–0052 remain unchanged.
The old bot migrations are appended with new ordinals:

| Source migration | Integration migration |
| --- | --- |
| 0019_fixed_ma_gnuci | 0053_telegram_bot_foundation |
| 0020_telegram_bot_integrity | 0054_telegram_bot_integrity |
| 0021_telegram_intent_purpose | 0055_telegram_intent_purpose |
| 0022_telegram_owner_authority | 0056_telegram_owner_authority |
| 0023_telegram_contact_phone | 0057_telegram_contact_phone |
| Private service access protection | 0058_telegram_private_tables |

0058 enables RLS on all 15 bot/challenge tables without public policies.
The trusted website database service must own/bypass those tables; the Python bot
does not receive DATABASE_URL.

Run `node scripts/inspect-telegram-migration-state.mjs` in an authorized secure
environment. It is read-only and checks the exact recorded journal prefix.
**Do not blindly run db:migrate or db:push.** The old bot documentation says
0019/0020 were applied to an earlier database. That is not proof about today's
production database. If bot tables already exist without the matching new journal
prefix, the preflight refuses. An operator must compare their columns, enum labels,
constraints, indexes and existing records before preparing an explicit reviewed
adoption plan. Never delete/recreate those tables or falsify migration history.
No automatic predeploy migration command is added.

The clean migration fixture preserves existing Owner/Admin/student records and
demonstrates that an anonymous database role cannot read Telegram contacts.
Native PostgreSQL CI additionally tests actual built-server authentication and permissions.
These are fixture results, not proof of production schema state.

## Railway configuration

Existing website project ID: `fa66cadd-5364-47bd-95f9-0689b0562269`.
Environment: `e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a`.
The UI currently names the project Learners-area (formerly kind-rebirth).
Prepared bot service ID: `28a82914-9b2f-4cb9-bed7-f46bc013e2f8`.

Bot source: the integration branch for reviewed candidate preparation; main only
after owner-approved merge. Root: `/services/telegram-bot`. Existing Dockerfile,
Python 3.12. Start: `python bot.py`. One replica. No predeploy migration.
Healthcheck: `/health`; readiness is separate at `/ready`.
Watch path: `/services/telegram-bot/**`. Auto-deployment must wait for successful CI.

| Bot variable | Requirement |
| --- | --- |
| TELEGRAM_BOT_TOKEN | Original token for @learnersareaaccessbot; never rotate |
| BOT_SERVICE_SECRET | Original shared service secret, same on website |
| TELEGRAM_OWNER_ID | Existing verified numeric owner/bootstrap ID |
| TELEGRAM_BOT_USERNAME | learnersareaaccessbot |
| INTERNAL_API_URL | https://learnersarea.uz/api/internal/telegram |
| PUBLIC_SITE_URL | https://learnersarea.uz |
| BOT_MODE | webhook |
| WEBHOOK_BASE_URL | Bot service HTTPS domain |
| WEBHOOK_SECRET | Preserve existing webhook secret; if unavailable, owner must supply it securely |
| WEBHOOK_PATH | /telegram/webhook |
| HOST / PORT | 0.0.0.0 / 8080 |

Website also needs its existing AUTH_SECRET, canonical PUBLIC_BASE_URL,
BOT_SERVICE_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_OWNER_ID.
Set PUBLIC_AUTH_MODE=standard. Do not set Telegram E2E approval until real acceptance.

Vercel's existing production TELEGRAM_BOT_TOKEN/USERNAME/OWNER_ID were found as
write-only Secret variables. Saved secret values cannot be retrieved through that UI;
the token's copy control is disabled. No secret was recovered, exposed or replaced.
Use the owner's existing secure record. Enter original values directly in Railway,
never in chat, source files or GitHub Actions. Do not use Rotate in Vercel/BotFather.

## Cutover and real acceptance

1. Review this PR and approve the main merge.
2. Inspect the production migration ledger read-only; resolve any historical bot
   schema through a separately reviewed non-destructive adoption plan.
3. Restore existing website credentials and deploy the approved backend.
4. Configure original bot credentials, HTTPS domain and secret on the separate service.
5. Start exactly one bot process. It checks production API/schema readiness and
   verifies the existing bot's username before setWebhook. Pending Telegram updates
   are preserved. A failed preflight leaves the existing webhook unchanged.
6. Verify live /health=200 and /ready=200, then getWebhookInfo URL, pending count and
   absence of delivery errors. Wrong webhook secret must refuse updates.
7. Real owner/admin accounts must log in through Telegram, retain website roles,
   use recovery, and link their existing accounts without creating new student duplicates.
8. A real new student shares their own native contact, requests access, remains
   pending until an authorized reviewer approves, then completes onboarding.
   Delegated permissions, suspension, replay, expiry and cancellation must fail safely.
9. Push a harmless bot-only commit and verify Railway automatically deploys that
   exact SHA after CI; verify /ready and Telegram again. Do not infer auto-deploy
   success from a connected source alone.
10. Only after this real acceptance may the existing staged Telegram-only policy
    be enabled for https://learnersarea.uz. Until then email/password remains enabled.

The website is not declared launched by fixture tests or by preparation of this branch.
