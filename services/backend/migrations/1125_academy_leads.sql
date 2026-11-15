CREATE TABLE IF NOT EXISTS academy_leads (
    id uuid PRIMARY KEY,
    name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
    email varchar(254),
    phone varchar(16),
    source varchar(120) NOT NULL CHECK (btrim(source) <> ''),
    course_id uuid REFERENCES courses(id),
    assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
    stage varchar(20) NOT NULL DEFAULT 'new'
        CHECK (stage IN ('new','contacted','trial_scheduled','trial_completed','enrolled','lost')),
    follow_up_at timestamptz,
    trial_at timestamptz,
    lost_reason varchar(300),
    student_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    membership_id uuid UNIQUE REFERENCES academy_group_memberships(id) ON DELETE SET NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    create_fingerprint varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    CHECK (email IS NOT NULL OR phone IS NOT NULL),
    CHECK (stage <> 'lost' OR lost_reason IS NOT NULL),
    CHECK (stage NOT IN ('trial_scheduled','trial_completed') OR trial_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_leads_open_email_idx ON academy_leads(email)
    WHERE email IS NOT NULL AND stage NOT IN ('enrolled','lost');
CREATE UNIQUE INDEX IF NOT EXISTS academy_leads_open_phone_idx ON academy_leads(phone)
    WHERE phone IS NOT NULL AND stage NOT IN ('enrolled','lost');
CREATE INDEX IF NOT EXISTS academy_leads_stage_idx ON academy_leads(stage, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS academy_leads_assignee_idx ON academy_leads(assigned_to, follow_up_at)
    WHERE stage NOT IN ('enrolled','lost');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_lead_notes (
    id uuid PRIMARY KEY,
    lead_id uuid NOT NULL REFERENCES academy_leads(id) ON DELETE RESTRICT,
    author_id uuid REFERENCES users(id) ON DELETE SET NULL,
    body varchar(1200) NOT NULL CHECK (btrim(body) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academy_lead_notes_lead_idx ON academy_lead_notes(lead_id, created_at DESC, id);
ALTER TABLE academy_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_lead_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_leads, academy_lead_notes FROM PUBLIC;
DO $lead_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_leads, academy_lead_notes FROM %I', api_role);
        END IF;
    END LOOP;
END $lead_access$;
