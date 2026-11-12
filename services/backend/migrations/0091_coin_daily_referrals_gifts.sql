-- 0091: additive, account-scoped Coin Economy claims, first-time referrals, gift catalogue.
-- Existing points/stars, rewards, leaderboards and historical completions are untouched.
-- Extend the single-award ceiling so +7 daily and +10 verified friend awards fit the existing ledger.
ALTER TABLE coin_ledger DROP CONSTRAINT IF EXISTS coin_ledger_coins_check;
ALTER TABLE coin_ledger ADD CONSTRAINT coin_ledger_coins_check CHECK (coins BETWEEN 1 AND 10);

CREATE TABLE IF NOT EXISTS coin_daily_claims (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_date date NOT NULL,
    streak_day smallint NOT NULL CHECK (streak_day BETWEEN 1 AND 7),
    coins smallint NOT NULL CHECK (coins = streak_day),
    claimed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, claim_date)
);
CREATE INDEX IF NOT EXISTS coin_daily_claims_latest ON coin_daily_claims (user_id, claim_date DESC);

CREATE TABLE IF NOT EXISTS coin_referral_codes (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code varchar(24) NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{24}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS coin_referrals (
    invitee_telegram_id varchar(40) PRIMARY KEY,
    inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    invited_at timestamptz NOT NULL DEFAULT now(),
    awarded_at timestamptz,
    CONSTRAINT coin_referral_ident_check CHECK (invitee_telegram_id ~ '^[0-9]{4,20}$'),
    CONSTRAINT coin_referral_award_check CHECK (
        (awarded_at IS NULL AND invitee_user_id IS NULL)
        OR (awarded_at IS NOT NULL AND invitee_user_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS coin_referrals_inviter ON coin_referrals (inviter_id, awarded_at);

CREATE TABLE IF NOT EXISTS coin_gifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_key varchar(64) NOT NULL UNIQUE CHECK (item_key ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    title_uz varchar(120) NOT NULL,
    title_en varchar(120) NOT NULL,
    description_uz varchar(500) NOT NULL DEFAULT '',
    description_en varchar(500) NOT NULL DEFAULT '',
    category varchar(24) NOT NULL CHECK (category IN ('badge','frame','theme','study_tool')),
    cost_coins integer NOT NULL CHECK (cost_coins BETWEEN 1 AND 10000),
    stock_remaining integer CHECK (stock_remaining >= 0),
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_gifts_active ON coin_gifts (is_active, category, item_key);

CREATE TABLE IF NOT EXISTS coin_gift_purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gift_id uuid NOT NULL REFERENCES coin_gifts(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    title_uz varchar(120) NOT NULL,
    title_en varchar(120) NOT NULL,
    cost_coins integer NOT NULL CHECK (cost_coins > 0),
    purchased_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, request_id),
    UNIQUE (user_id, gift_id)
);
CREATE INDEX IF NOT EXISTS coin_gift_purchases_user ON coin_gift_purchases (user_id, purchased_at DESC);

ALTER TABLE coin_daily_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_gift_purchases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON coin_daily_claims, coin_referral_codes, coin_referrals, coin_gifts, coin_gift_purchases FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON coin_daily_claims, coin_referral_codes, coin_referrals, coin_gifts, coin_gift_purchases FROM %I', role_name);
        END IF;
    END LOOP;
END $$;
