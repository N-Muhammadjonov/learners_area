-- 1119: a separate clearing account for provider money (FIN-10).
--
-- Bank transfers and card/wallet provider settlements both posted to `bank_clearing`, so the
-- journal could not tell them apart. That makes it impossible to reconcile the owner
-- dashboard's per-method collection figures against the ledger, which is the whole point of
-- FIN-10: every reported number must reconcile to an independent source.
--
-- Additive and idempotent: one new account row. No existing row is changed, so history posted
-- to `bank_clearing` stays exactly as it was reported at the time.

INSERT INTO finance_accounts(code, name, kind, normal_side) VALUES
    ('provider_clearing','Payment provider clearing','asset','debit')
ON CONFLICT (code) DO NOTHING;
