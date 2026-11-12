-- 0092: account-scoped gift artwork, owner fulfillment and auditable coin refunds.
-- Existing purchases were completed before this migration; new purchases explicitly request pending.
ALTER TABLE coin_gifts ADD COLUMN IF NOT EXISTS image_data text;
DO $
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'coin_gifts_image_size'
                     AND conrelid = 'coin_gifts'::regclass) THEN
        ALTER TABLE coin_gifts ADD CONSTRAINT coin_gifts_image_size
            CHECK (image_data IS NULL OR char_length(image_data) <= 230000);
    END IF;
END $;

ALTER TABLE coin_gift_purchases ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'fulfilled';
ALTER TABLE coin_gift_purchases ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE coin_gift_purchases ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
DO $
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'coin_purchase_status_valid'
                     AND conrelid = 'coin_gift_purchases'::regclass) THEN
        ALTER TABLE coin_gift_purchases ADD CONSTRAINT coin_purchase_status_valid
            CHECK (status IN ('pending', 'fulfilled', 'rejected'));
    END IF;
END $;
ALTER TABLE coin_gift_purchases DROP CONSTRAINT IF EXISTS coin_gift_purchases_user_id_gift_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS coin_gift_one_active_purchase
    ON coin_gift_purchases(user_id, gift_id) WHERE status IN ('pending','fulfilled');
CREATE INDEX IF NOT EXISTS coin_gift_purchases_status
    ON coin_gift_purchases(status, purchased_at DESC);

CREATE TABLE IF NOT EXISTS coin_gift_refunds (
    purchase_id uuid PRIMARY KEY REFERENCES coin_gift_purchases(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coins integer NOT NULL CHECK (coins > 0),
    refunded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_gift_refunds_user ON coin_gift_refunds(user_id);
ALTER TABLE coin_gift_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coin_gift_refunds FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON coin_gift_refunds FROM %I',api_role);
        END IF;
    END LOOP;
END $$;
