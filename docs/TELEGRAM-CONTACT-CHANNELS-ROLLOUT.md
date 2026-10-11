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
- `POST /api/internal/telegram/admission/request` checks a verified phone and
  freshly calls Telegram `getChatMember` for all configured channels **before
  creating any user or application rows**. Unavailable checks fail closed.
- Website Telegram *registration* exchange enforces the same prerequisites,
  preventing a bypass of the bot's `/apply` action.
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

## Owner acceptance sequence (before any release)

1. Confirm existing website OWNER login through Telegram and account linking
   BEFORE enabling `AUTH_TELEGRAM_ONLY`.
2. Prepare a dedicated **staging** app/backend and compatible migration state;
   never point a review worker at live production writable DB for QA.
3. Execute Python bot pytest, TypeScript typecheck, native PostgreSQL integration
   tests and Telegram sandbox interaction checks.
4. Test `/start` own contact, forwarded/other contact, missing `user_id`,
   forged service request and retry after backend outage.
5. Test zero/one/four required channels, fifth-channel refusal, invalid channel,
   bot without administrator rights, member/left/kicked user, membership API
   outage, and concurrent owner add calls.
6. Verify browser Telegram registration cannot bypass channel/phone gates.
7. Verify delegated bot admins and users CANNOT read phone numbers; primary
   owner can see Telegram numeric ID, username and verified phone.
8. Verify contact removal and account anonymization clear phone PII.
9. Verify EN/UZ, mobile, original owner roles, existing sessions and account
   data. Verify no change to website academic results.
10. Only after all green checks and owner's explicit approval: integrate the
    reviewed bot code into Railway's source branch using a normal PR; separately
    port the appropriate website auth/API changes forward onto the **actual
    current website production tree**. Preserve newer website work.
11. Record rollback deployment SHA, ensure `/health` and `/ready`, monitor
    webhook processing, and only then enable `AUTH_TELEGRAM_ONLY` in Vercel.

## Important boundaries

- This review branch has **not** been deployed to Railway or Vercel production.
- GitHub Actions cover Python tests and TypeScript compile checks, **not**
  genuine Telegram webhook/owner/browser/database acceptance.
- Railway and Vercel currently track different branches. Git merging this bot
  feature branch directly over the website's current production branch is
  unsafe and not authorized.
- Never paste Telegram bot tokens, `BOT_SERVICE_SECRET`, or database credentials
  into chat, logs, issues or PRs.
