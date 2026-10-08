BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS finding_occurrences_replay_identity_unique
    ON finding_occurrences (
        organization_id,
        finding_id,
        commit_id,
        normalized_fingerprint
    );

COMMIT;
