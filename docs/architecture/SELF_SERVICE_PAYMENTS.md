# Self-service payments: boundaries and verification

This feature extends the native FastAPI/Vanilla application. The existing tuition
ledger, balanced journal, allocation rules and transactional outbox remain authoritative.
It is a development-branch implementation. No merchant, production migration or live
payment has been verified in this task. External actions live only in
[SALE_READY_MANUAL_ACTIONS](../SALE_READY_MANUAL_ACTIONS.md).

## Money and billing

Existing `amountMinor` means integer whole UZS. This preserves the historical API.
Payme and Uzum receive exactly `amountMinor * 100` tiyin. Click receives decimal UZS
text, parsed exactly with Decimal. No float reaches a monetary posting.

The current release uses `MONTHLY_INVOICE` / `monthly-invoice-v1`, consistent with
existing frozen tuition contracts. A quote never promises extra days or lessons.
Confirmed amounts pay posted obligations after credits. Surplus stays as customer
advance. Only settled refunds reduce it. Alternative prepaid policies are not
activated by this release and no entitlement counter is fabricated.

A student is the beneficiary, while the authenticated student or guardian is the
payer. Both are immutable, along with amount, currency, provider, environment,
idempotency key, quote version and expiry. Database guards verify the linked ledger
payment and guardian/child pair. Provider events are append-only.

## HTTP contract

| Actor | Read summary/history | Create intent | Read intent | Refresh canonical status |
|---|---|---|---|---|
| Student | GET `/api/finance/me/payments` | POST `/api/finance/me/intents` | GET `/api/finance/me/intents/{intent_id}` | POST same intent + `/refresh` |
| Guardian | GET `/api/guardian/children/{child_id}/payments` | POST child payments + `/intents` | GET child payments + `/intents/{intent_id}` | POST same intent + `/refresh` |

History is server-paged using `offset` and `limit` (maximum 50), with an optional
status filter. Older cash/bank/provider payments remain visible. Every response is
private/no-store. Creation uses the existing session, origin checks, strict Pydantic
validation and per-user rate limiter. No body can select another beneficiary.

Every guardian request rechecks the current active child link and channel identity.
A shared row lock orders intent creation against revocation. Revocation immediately
denies reads and new preparation. An already accepted provider payment can settle
only its original child, even after a session change or revoked link. The portal
never grants staff finance, payroll, refunds, charges or unrelated progress access.

Guardian HTML entry is checked separately from the API allow-list. Its previous
hard reload produced a 503 because the API-only rule rejected the SPA document.
Teachers/admins can reach the existing guardian composer, as its server permissions
already allowed. Academic guardian views remain read-only and only add a gated link
to the child's separate payment page. Telegram reply targeting is unchanged.

## Provider boundaries

| Product | Callback | Proof and behavior |
|---|---|---|
| Click Shop API | POST `/api/payments/callbacks/click`, form body | Exact documented prepare/complete MD5; service, amount, immutable order and preparation reference must agree |
| Payme Merchant API | POST `/api/payments/callbacks/payme`, JSON-RPC | Constant-time Basic authorization using configured login/key; integer tiyin; persisted Create/Perform/Cancel/Check/GetStatement state |
| Uzum Checkout | POST `/api/payments/callbacks/uzum`, JSON wake-up | The wake-up is never proof. Authenticated `getOrderStatus` must match order ID, merchant order, exact amount and completed/refunded/reversed totals |

All proofs are checked before duplicate acknowledgement. Row locks, unique vendor
references, immutable intent fields and the existing ledger transaction provide one
posting, one allocation effect and one outbox event under retries. A redirect, query
parameter, client claim or pending response cannot settle funds.

Payme cancellation of an already credited payment refuses with `-31007`. Refunds
continue through the approved existing finance process; a callback cannot bypass
maker/checker policy or invent settled outgoing cash. This behavior still needs
merchant acceptance during real sandbox verification.

Uzum registration happens only after the order commits. An unknown registration
outcome remains durable, has no invented redirect and is never automatically
re-registered. A later authenticated canonical response can recover the same order.
Known Uzum orders also support scoped refresh and a bounded recovery worker. It uses
`FOR UPDATE SKIP LOCKED`, at most 25 orders per batch, exponential backoff and 12
attempts. Exhausted orders remain observable for review. Disabling the worker does
not alter balances or disable lessons.

The internal acknowledgement is not a fiscal receipt. `fiscal_status` is one of
`not_required`, `pending`, `issued`, `failed`, `manual_review`. It defaults to
`manual_review`; no fiscal integration or legal exemption is claimed.

## Runtime gating

`SELF_SERVICE_PAYMENTS_ENABLED` defaults off in managed environments. The API and
navigation are hidden until activation. Existing Academy availability still applies.
Provider settings are read server-side; secrets are never returned to the browser.

Every provider has an explicit environment (`disabled`, `sandbox`, `live`). Live
checkout requires credentials, a valid HTTPS `PAYMENTS_RETURN_ORIGIN` and the
provider's `*_LIVE_VERIFIED=1` attestation. Sandbox operation is restricted to
non-production environments. Its callbacks can be enabled for verification without
claiming a live integration; public sandbox checkout additionally requires
`*_SANDBOX_VERIFIED=1`. Orders bind their environment permanently.

Required fields:

- Click: `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY`.
- Payme: `PAYME_MERCHANT_ID`, `PAYME_KEY`, `PAYME_LOGIN` (merchant-assigned login).
- Uzum: `UZUM_TERMINAL_ID`, `UZUM_API_KEY`, `UZUM_BASE_URL`, `UZUM_CHECKOUT_ORIGIN`.
  The API base and checkout origin must be assigned/verified by the merchant setup;
  the official Checkout schema does not provide a universal server URL.
- Optional provider `*_MIN_UZS` must be a positive integer. Invalid configuration
  fails closed. Uzum's published maximum is enforced at the tiyin boundary.
- `PAYMENT_RECONCILIATION_ENABLED=1` explicitly enables the single-batch recovery
  command `python -m app.payment_reconciliation`. It is not scheduled automatically.

The operator-only `prepare_provider_sandbox.py` command can create an audited
verification order before sandbox approval, without exposing the method to learners.
It requires an active owner, an active synthetic student, sandbox credentials,
`PAYMENT_SANDBOX_DATABASE_ISOLATED=1`, a non-production runtime, and explicit target
acknowledgement. `PAYMENTS_SANDBOX_DATABASE_URL` is separate from live configuration.
Unverified sandbox orders never become available through the student/guardian UI.

Credentials/configuration flags in isolated tests are synthetic fixtures. A green
protocol test is `LOCALLY_TESTED`, not `SANDBOX_VERIFIED` or `LIVE_VERIFIED`.

## Additive migration and recovery

`services/backend/migrations/20261115200716_academy_self_service_payments.sql` was
created with the migration CLI and retained under the canonical native migration
chain. It has one application path, not a duplicate Supabase migration. Historical
1115–1131 bytes and their production journal are unchanged.

The migration adds two RLS-enabled private tables and rejects direct API-role access.
It seeds no student/payment data and rewrites no financial history. The isolated
upgrade runner is `services/backend/migrate_self_service_payments.py`; its separate
private checksum journal leaves the installed Academy journal untouched. Inspection
is read-only, application requires the exact inspected target label, and the entire
upgrade rolls back on a missing prerequisite. Tests check retry/idempotency, rollback,
RLS and preservation of an existing user.

Rollback means disable the feature/providers/worker and preserve the new financial
records. Never drop payment history or reverse paid money through a schema rollback.
Subsequent corrections require an additive migration/domain reversal. The schema
and module were activated in the [2026-11-17 guarded production release](../verification/PAYMENTS_PRODUCTION_RELEASE_20261117.md).
Merchant credentials and verification flags remain absent, so live payment methods
remain unavailable pending external acceptance.

## Official protocol sources

Reviewed 2026-11-16 (Asia/Tashkent):

- [Click Shop API](https://docs.click.uz/) — the official English Shop API request and
  payment-link pages, including the exact prepare/complete signature inputs.
- [Payme Merchant API](https://developer.help.paycom.uz/protokol-merchant-api/),
  [authorization](https://developer.help.paycom.uz/protokol-merchant-api/skhema-vzaimodeystviya/),
  [merchant methods](https://developer.help.paycom.uz/metody-merchant-api/) and
  [sandbox](https://developer.help.paycom.uz/pesochnitsa/).
  The documented sandbox checkout host is `https://test.paycom.uz`.
- [Uzum Checkout](https://developer.uzumbank.uz/en/checkout/) — official OpenAPI 3.0.2,
  Checkout 1.10.3 schemas. Checkout and the separate in-app Merchant product are not
  interchangeable.
