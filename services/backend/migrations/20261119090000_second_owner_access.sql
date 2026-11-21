ALTER TABLE public.users ADD COLUMN second_owner_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD CONSTRAINT users_second_owner_link_only CHECK (
    NOT second_owner_only OR (
        role = 'student' AND NOT is_owner AND email IS NULL
        AND password_hash IS NULL AND telegram_id IS NULL AND google_sub IS NULL
    )
);

CREATE TABLE public.second_owner_access (
    owner_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    owner_auth_version bigint NOT NULL,
    learner_id uuid UNIQUE REFERENCES public.users(id) ON DELETE SET NULL,
    invite_hash text UNIQUE,
    invite_expires_at timestamptz,
    session_expires_at timestamptz,
    CHECK (owner_id <> learner_id),
    CHECK ((invite_hash IS NULL) = (invite_expires_at IS NULL))
);

ALTER TABLE public.second_owner_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.second_owner_access FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE public.second_owner_access FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE public.second_owner_access FROM authenticated;
    END IF;
END $$;
