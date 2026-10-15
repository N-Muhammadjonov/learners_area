-- Broadcast only actual role or admission changes. A PostgreSQL NOTIFY is
-- emitted ON COMMIT; a rollback never tells a connected user their access changed.
-- The payload includes a UUID only, not the old/new role or any private data.
-- This is a UX invalidation signal, NEVER an authorization credential.
CREATE OR REPLACE FUNCTION public.learners_area_access_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.account_status IS DISTINCT FROM NEW.account_status THEN
    PERFORM pg_notify('la_access_changed', json_build_object('userId', NEW.id)::text);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_access_changed ON public.users;
CREATE TRIGGER users_access_changed
AFTER UPDATE OF role, account_status ON public.users
FOR EACH ROW EXECUTE FUNCTION public.learners_area_access_changed();
