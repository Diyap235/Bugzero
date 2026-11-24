BEGIN;

ALTER TABLE health_snapshots
    ALTER COLUMN security_score DROP NOT NULL,
    ALTER COLUMN quality_score DROP NOT NULL,
    ALTER COLUMN reliability_score DROP NOT NULL,
    ALTER COLUMN maintainability_score DROP NOT NULL,
    ALTER COLUMN dependency_score DROP NOT NULL,
    ADD COLUMN profile_id text,
    ADD COLUMN profile_version integer,
    ADD COLUMN model_version text,
    ADD COLUMN analysis_run_id uuid,
    ADD COLUMN overall_score numeric(5,2) CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 100),
    ADD COLUMN overall_status text CHECK (
        overall_status IS NULL OR overall_status IN ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL', 'UNKNOWN', 'PARTIAL')
    ),
    ADD COLUMN coverage text CHECK (coverage IS NULL OR coverage IN ('COMPLETE', 'PARTIAL', 'UNKNOWN')),
    ADD COLUMN dimensions jsonb CHECK (dimensions IS NULL OR jsonb_typeof(dimensions) = 'object'),
    ADD COLUMN profile_snapshot jsonb CHECK (profile_snapshot IS NULL OR jsonb_typeof(profile_snapshot) = 'object'),
    ADD COLUMN calculation jsonb CHECK (calculation IS NULL OR jsonb_typeof(calculation) = 'object'),
    ADD COLUMN explanation text;

ALTER TABLE health_snapshots
    ADD CONSTRAINT health_snapshots_profile_identity_check
        CHECK ((profile_id IS NULL AND profile_version IS NULL AND model_version IS NULL AND analysis_run_id IS NULL)
            OR (profile_id IS NOT NULL AND length(profile_id) > 0
                AND profile_version IS NOT NULL AND profile_version > 0
                AND model_version IS NOT NULL AND length(model_version) > 0
                AND analysis_run_id IS NOT NULL)),
    ADD CONSTRAINT health_snapshots_v1_payload_check
        CHECK (profile_id IS NULL OR (
            overall_status IS NOT NULL
            AND coverage IS NOT NULL
            AND dimensions IS NOT NULL
            AND profile_snapshot IS NOT NULL
            AND calculation IS NOT NULL
            AND explanation IS NOT NULL
        )),
    ADD CONSTRAINT health_snapshots_analysis_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX health_snapshots_profile_revision_unique
    ON health_snapshots (organization_id, repository_id, commit_id, profile_id, profile_version)
    WHERE profile_id IS NOT NULL;

CREATE INDEX health_snapshots_profile_history_idx
    ON health_snapshots (organization_id, repository_id, profile_id, profile_version, created_at DESC)
    WHERE profile_id IS NOT NULL;

COMMIT;
