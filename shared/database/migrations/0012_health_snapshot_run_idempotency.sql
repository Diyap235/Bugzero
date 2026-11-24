BEGIN;

DROP INDEX health_snapshots_profile_revision_unique;

CREATE UNIQUE INDEX health_snapshots_profile_run_unique
    ON health_snapshots (organization_id, repository_id, commit_id, analysis_run_id, profile_id, profile_version)
    WHERE profile_id IS NOT NULL AND analysis_run_id IS NOT NULL;

COMMIT;
