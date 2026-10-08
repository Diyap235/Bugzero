BEGIN;

ALTER TABLE users
    ADD COLUMN password_hash text,
    ADD COLUMN default_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX users_email_case_insensitive_unique
    ON users (lower(email));

COMMIT;
