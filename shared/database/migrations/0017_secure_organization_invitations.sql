BEGIN;

CREATE TABLE organization_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) > 0),
    role text NOT NULL CHECK (role IN ('DEVELOPER', 'SECURITY_REVIEWER', 'VIEWER')),
    token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED')),
    expires_at timestamptz NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    accepted_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK ((status = 'ACCEPTED') = (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);

CREATE UNIQUE INDEX organization_invitations_pending_email_unique
    ON organization_invitations (organization_id, email)
    WHERE status = 'PENDING';

CREATE INDEX organization_invitations_organization_created_idx
    ON organization_invitations (organization_id, created_at DESC);

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_invitations_tenant_isolation ON organization_invitations
    USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

COMMIT;
