# Telegram authentication recovery

Task 10 uses the existing private `telegram_flow_drafts` table. No schema or
configuration change is required. Deploy the backend before the bot client.

Each Telegram actor has one deterministic `auth_intent` draft containing only the
deep-link token's SHA-256 digest. Its expiry is copied from the login intent and
cannot be extended by restarting the bot. `/start` stores this context before
requesting a native self-contact; `/cancel` durably clears it before clearing UI.
MemoryStorage retains compose/UI state. Old clients supplying a raw token remain
compatible during rollout.

A restored context is not verification. Preflight and confirmation still check
the live intent's pending status, expiry and actor binding. Confirmation without
a raw token also requires the exact intent ID returned by preflight, preventing a
new start from substituting a different browser flow. Phone and current channel
membership are checked again, including at browser exchange; the browser nonce
and one-time consumption remain mandatory. No Telegram token is returned to a
browser or stored in a draft.

The existing `telegram_processed_updates` primary key is the durable duplicate
authority. A duplicate update never runs its handler twice, including across bot
restarts. Backend claim unavailability must return webhook 503, without poisoning
the local seen cache. The bot waits for foreground dispatch instead of returning
a successful acknowledgement before the durable claim.

This is at-most-once handler admission, not an exactly-once remote-message
guarantee. If a process dies after admission, its handler is not replayed
automatically: the user can repeat the command or click with a new update ID.
Durable auth intents/drafts remain subject to their original expiry and checks.
Telegram sends whose response is lost may still be ambiguous; do not blindly
replay administrative side effects or report a missing notification as a false
identity verification.

Automated proof: `tests/telegram_durability_postgres_probe.py` applies all 72
migrations to a fresh loopback-only synthetic PostgreSQL database, reconnects
twice, checks gate failures and actor isolation, races confirmation and races 32
duplicate updates. It makes no external Telegram calls. Bot tests separately
cover lost memory, duplicate handling, outage retry and webhook secret validation.
Owner performs manual Telegram/device acceptance.

References: [Telegram webhook retries](https://core.telegram.org/bots/api#setwebhook)
and [aiogram foreground webhook handling](https://docs.aiogram.dev/en/latest/dispatcher/webhook.html).
