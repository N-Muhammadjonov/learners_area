ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_version" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_session_revocations" (
  "token_hash" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_revocations_expiry_idx" ON "auth_session_revocations" ("expires_at");
--> statement-breakpoint
ALTER TABLE "auth_session_revocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- All authority writes, including legacy/retention paths, invalidate atomically.
-- NOTIFY is emitted only when the transaction commits. It remains UI-only:
-- each protected request checks the epoch and exact-session revocation in PG.
CREATE OR REPLACE FUNCTION public.la_invalidate_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    NEW.auth_version := OLD.auth_version + 1;
  ELSIF NEW.auth_version < OLD.auth_version THEN
    RAISE EXCEPTION 'auth_version_must_not_decrease';
  END IF;
  IF NEW.auth_version IS DISTINCT FROM OLD.auth_version THEN
    PERFORM pg_notify('la_access_changed', json_build_object('userId', NEW.id)::text);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS la_users_authority_changed ON "users";
--> statement-breakpoint
CREATE TRIGGER la_users_authority_changed BEFORE UPDATE OF role, account_status, auth_version ON "users"
FOR EACH ROW EXECUTE FUNCTION public.la_invalidate_authority();
