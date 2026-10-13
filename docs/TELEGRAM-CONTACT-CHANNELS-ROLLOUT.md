> Historical bot-branch document. Its release results, migration numbers and setup instructions are not current production proof. Follow [the current integration runbook](TELEGRAM-PRODUCTION-INTEGRATION-2026-10-13.md). Reuse @learnersareaaccessbot; never recreate or rotate it.

# Telegram-only onboarding, verified phone and required-channel gates

Status: **REVIEW BRANCH ONLY — NOT DEPLOYED**.

## Source of truth

Railway is connected to `feature/telegram-access-bot` at
`/services/telegram-bot/Dockerfile`, using `python bot.py`.
The Vercel website production tracking branch is
`arena/01a0cf7b-learners-area`. They are **different code histories**.
Never replace the Vercel production tree with this older bot feature tree.

The review branch is `codex/telegram-onboarding-channels-20261011`.
It is intentionally NOT the Railway tracked branch.

## New behavior

- The `/start` command asks for Telegram's native self-contact immediately, in
  EN/UZ chosen from `from_user.language_code`. The keyboard uses
  `KeyboardButton(request_contact=True)`.
- Any third-party, forwarded or anonymous contact is rejected. The bot insists
  `message.contact.user_id == message.from_user.id` in a **private** chat.
  Deep-link login tokens remain unconfirmed until verification.
- The internal API checks the same identity binding and writes only to an
  existing Telegram contact. Verified phone numbers are private PII.
- Only the effective primary bot owner can read verified phone numbers from
  the directory card, and only via an owner-authorized internal endpoint.
- Primary owner can add/remove **up to four** required channels. Bot must be a
  channel administrator with a usable Telegram join URL.
- When `TELEGRAM_ACCESS_GATES_ENABLED=1` is deliberately activated,
  `POST /api/internal/telegram/admission/request` checks a verified phone and
  freshly calls Telegram `getChatMember` for all configured channels **before
  creating any user or application rows**. Unavailable checks fail closed.
- Website Telegram *registration* exchange uses the very same flag, preventing
  a bypass of the bot's `/apply` action when gates are enabled.
- `TELEGRAM_ACCESS_GATES_ENABLED` is **OFF by default** to keep existing users'
  access-request workflow working while the backend is deployed before the
  new bot. This is a temporary transitional release state, NOT full policy
  enforcement. After smoke tests, explicitly enable it on the website backend.
- Owner contact removal/account anonymization clears phone PII.
- `AUTH_TELEGRAM_ONLY=1` or `true` disables email/password login, email
  registration, and password-reset APIs, hides those form controls and displays
  Telegram sign-in and Telegram registration instead. The toggle defaults to
  OFF to avoid locking out an owner who has not linked Telegram yet.
- No Google provider is added or connected by these changes.

## Required migration

`drizzle/0023_telegram_contact_phone.sql` adds the nullable
`telegram_contacts.phone_number` and `phone_verified_at` columns.
Run the normal migrations with explicit authorization on an isolated test
database **before** deploying an app build that references these columns.
Do **not** automatically migrate production or reset/seed real student data.

Required prerequisites in the target environment must be reconciled with its
migration history; existing bot branches include 0021/0022 and the website's
production branch can differ considerably.

**Confirmed repository migration namespace collision (NOT proof of actual DB state):**

| Index | Legacy bot code lineage | Modern Arena website code lineage |
|---|---|---|
| 0020 | `0020_telegram_bot_integrity.sql` | `0020_lexical_source_snapshot.sql` |
| 0021 | `0021_telegram_intent_purpose.sql` | `0021_registration_gender.sql` |
| 0022 | `0022_telegram_owner_authority.sql` | `0022_retention_bank.sql` |
| 0023 | `0023_telegram_contact_phone.sql` | `0023_video_lesson_notes.sql` |

The current owner-authorized website release and Supabase migration history
must be inspected before ANY production DDL. Do not assume a matching numeric
prefix implies matching schema. If the database follows the modern Arena
lineage, the bot functionality needs a separately designed forward-only
migration after the current last migration; the old 0023 cannot be applied
as if it were that website's 0023. Similarly, bot tables from the legacy
0020-0022 lineage must not be assumed to exist on a modern-only schema.

## Coordinated release order — NO incompatible half-deployment

**Live unauthenticated route-presence check, 2026-10-11:**

- `/api/internal/telegram/ready` returns HTTP 401 (route present).
- `/api/internal/telegram/required-channels` returns HTTP 404 (absent).
- `/api/internal/telegram/contacts/1` returns HTTP 404 (absent).
- `/api/internal/telegram/contacts/phone` returns HTTP 404 (absent).

Source: GitHub Actions `Telegram live backend compatibility`. This is
anonymous, read-only evidence and NOT a test of secrets or DB schema.

1. **Rotate the exposed Telegram token first.** The user-provided screenshot
   disclosed credential characters. Update Railway and Vercel with the
   newly issued token. Never paste the new value into issues or chat.
2. Identify the **real Vercel production deployment** and its exact SHA;
   the GitHub production-tracking branch alone may not describe the active
   aliased deployment. Preserve newer real website features.
3. On an isolated **staging database**, verify existing migration history,
   then apply the nullable `0023_telegram_contact_phone.sql`. Reconcile
   with the actual production migration lineage before any production write.
4. Test bot and website in staging (own contact, forged contact, channels
   0/1/4/5, membership failures, owner phone access, anonymous callers,
   EN/UZ, website login and registration). Confirm all blocked paths have
   zero unauthorized DB writes.
5. With deployment permission, apply the reviewed, compatible, nullable DB
   migration to the correct website database first. Make a backup beforehand.
   Do NOT reset the database.
6. Deploy the new website backend API **with**
   `TELEGRAM_ACCESS_GATES_ENABLED=0` and `AUTH_TELEGRAM_ONLY=0`. The old
   Railway bot and email login must still work at this point.
7. Re-run the public **read-only** live-route-presence check; then run a
   secure server-to-server authenticated integration check using secrets
   stored only in hosting settings. Verify phone storage, owner view and
   channel registry; check `/ready` health and DB migration compatibility.
8. Update Railway's `feature/telegram-access-bot` via reviewed fast-forward
   changes. Verify `/start` self-contact, owner panel, error handling,
   Telegram webhook, `/health` and `/ready`.
9. Only after the bot and backend work together, set
   `TELEGRAM_ACCESS_GATES_ENABLED=1` on Vercel and redeploy. Verify
   application denials for unverified phone, unsubscribed users, and
   membership-provider failures; verify successful authorized application.
10. Confirm the existing owner can authenticate **via Telegram**, then set
    `AUTH_TELEGRAM_ONLY=1` and redeploy. Confirm email/password login,
    registration and reset endpoints all refuse requests and Google is not
    presented. Keep prior sessions and academic data intact.
11. Record exact website and Railway deployment SHAs, DB migration receipt,
    acceptance evidence and a rollback/disable-flags plan. No new token or
    `BOT_SERVICE_SECRET` may appear in logs or reports.

## Owner acceptance prerequisites

- A successful bot `pytest` and website typecheck are necessary but not
  sufficient; run real PostgreSQL migration and end-to-end Telegram checks.
- Test bot admin versus primary owner phone-number access.
- Test exact `Contact.user_id === Message.from_user.id` binding;
  forwarded/anonymous/other-account contacts must be refused.
- Test bot-admin rights and Telegram `getChatMember` membership for 4 channels.
- Confirm older bot behavior remains working while gates are OFF.
- Do not automatically deploy or merge a bot branch into the divergent
  website production tree.

## Important boundaries

- This review branch has **not** been deployed to Railway or Vercel production.
- GitHub Actions cover Python tests and TypeScript compile checks, **not**
  genuine Telegram webhook/owner/browser/database acceptance.
- Railway and Vercel currently track different branches. Git merging this bot
  feature branch directly over the website's current production branch is
  unsafe and not authorized.
- Never paste Telegram bot tokens, `BOT_SERVICE_SECRET`, or database credentials
  into chat, logs, issues or PRs.
