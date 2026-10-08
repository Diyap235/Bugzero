BEGIN;

ALTER TABLE evidence
    ADD COLUMN identity_fingerprint text,
    ADD COLUMN completeness text NOT NULL DEFAULT 'COMPLETE'
        CHECK (completeness IN ('COMPLETE', 'PARTIAL', 'INCOMPLETE')),
    ADD COLUMN diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(diagnostics) = 'array');

UPDATE evidence
SET identity_fingerprint = md5(
    organization_id::text || ':' || finding_occurrence_id::text || ':' || id::text
)
WHERE identity_fingerprint IS NULL;

ALTER TABLE evidence
    ALTER COLUMN identity_fingerprint SET NOT NULL,
    ADD CONSTRAINT evidence_completeness_sufficiency_check
        CHECK (completeness = 'COMPLETE' OR sufficiency <> 'SUFFICIENT'),
    ADD CONSTRAINT evidence_complete_flag_check
        CHECK (complete = (completeness = 'COMPLETE'));

CREATE UNIQUE INDEX evidence_occurrence_identity_unique
    ON evidence (organization_id, finding_occurrence_id, identity_fingerprint);

ALTER TABLE evidence_nodes
    DROP CONSTRAINT IF EXISTS evidence_nodes_node_type_check,
    ADD COLUMN end_line integer CHECK (end_line IS NULL OR end_line >= line),
    ADD COLUMN start_column integer CHECK (start_column IS NULL OR start_column > 0),
    ADD COLUMN end_column integer CHECK (end_column IS NULL OR end_column > 0),
    ADD CONSTRAINT evidence_nodes_node_type_check
        CHECK (node_type IN (
            'REPOSITORY', 'FILE', 'MODULE', 'CLASS', 'FUNCTION', 'METHOD',
            'PARAMETER', 'VARIABLE', 'DEPENDENCY', 'CALL', 'TRANSFORMATION',
            'SANITIZER', 'SINK', 'EXTERNAL_BOUNDARY', 'DATABASE_OPERATION',
            'FILE_OPERATION', 'PROCESS_OPERATION', 'SOURCE', 'UNKNOWN'
        ));

CREATE INDEX evidence_finding_revision_idx
    ON evidence (organization_id, finding_id, repository_id, commit_id, analysis_run_id);

COMMIT;
