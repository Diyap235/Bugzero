BEGIN;

ALTER TABLE analysis_jobs
    ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 3,
    ADD COLUMN lease_owner uuid,
    ADD COLUMN lease_expires_at timestamptz,
    ADD COLUMN last_error text,
    ADD CONSTRAINT analysis_jobs_max_attempts_positive CHECK (max_attempts > 0),
    ADD CONSTRAINT analysis_jobs_lease_pair CHECK (
        (lease_owner IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    );

CREATE INDEX analysis_jobs_ready_queue_idx
    ON analysis_jobs (available_at, created_at, id)
    WHERE status IN ('QUEUED', 'RETRY');

CREATE INDEX analysis_jobs_expired_lease_idx
    ON analysis_jobs (lease_expires_at, created_at, id)
    WHERE status = 'RUNNING';

CREATE POLICY analysis_jobs_worker_queue_access ON analysis_jobs
    USING (
        organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
        OR session_user = 'bugzero_queue_worker'
    )
    WITH CHECK (
        organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
        OR session_user = 'bugzero_queue_worker'
    );

DO $migration$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bugzero_queue_worker') THEN
        EXECUTE 'GRANT SELECT, UPDATE ON analysis_jobs TO bugzero_queue_worker';
    END IF;
END;
$migration$;

ALTER TABLE code_entities
    ADD COLUMN analysis_run_id uuid,
    ADD CONSTRAINT code_entities_analysis_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT code_entities_run_identity_unique
        UNIQUE (organization_id, repository_id, commit_id, analysis_run_id, id);

ALTER TABLE code_entities
    DROP CONSTRAINT code_entities_organization_id_commit_id_entity_key_key,
    DROP CONSTRAINT code_entities_entity_type_check,
    ADD CONSTRAINT code_entities_entity_type_check CHECK (
        entity_type IN (
            'REPOSITORY', 'FILE', 'MODULE', 'CLASS', 'FUNCTION', 'METHOD',
            'SYMBOL', 'PARAMETER', 'TYPE', 'CONSTANT', 'DEPENDENCY'
        )
    );

CREATE UNIQUE INDEX code_entities_run_entity_key_unique
    ON code_entities (organization_id, repository_id, commit_id, analysis_run_id, entity_key)
    WHERE analysis_run_id IS NOT NULL;

ALTER TABLE code_relationships
    ADD COLUMN analysis_run_id uuid,
    ADD CONSTRAINT code_relationships_analysis_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT code_relationships_source_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, source_entity_id)
        REFERENCES code_entities (organization_id, repository_id, commit_id, analysis_run_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT code_relationships_target_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, target_entity_id)
        REFERENCES code_entities (organization_id, repository_id, commit_id, analysis_run_id, id) ON DELETE RESTRICT;

DROP INDEX code_relationships_semantic_identity_unique;

ALTER TABLE code_relationships
    DROP CONSTRAINT code_relationships_relation_check,
    ADD CONSTRAINT code_relationships_relation_check CHECK (
        relation IN (
            'IMPORTS', 'DECLARES', 'CALLS', 'REFERENCES', 'READS', 'WRITES',
            'RETURNS', 'PASSES_ARGUMENT', 'INHERITS', 'IMPLEMENTS',
            'OVERRIDES', 'DEPENDS_ON'
        )
    );

CREATE UNIQUE INDEX code_relationships_run_identity_unique
    ON code_relationships (
        organization_id, repository_id, commit_id, analysis_run_id,
        source_entity_id, target_entity_id, relation
    )
    WHERE analysis_run_id IS NOT NULL;

CREATE INDEX code_entities_run_scope_idx
    ON code_entities (organization_id, repository_id, commit_id, analysis_run_id, entity_type, file_path);

CREATE INDEX code_relationships_run_source_idx
    ON code_relationships (organization_id, repository_id, commit_id, analysis_run_id, source_entity_id, relation);

CREATE INDEX code_relationships_run_target_idx
    ON code_relationships (organization_id, repository_id, commit_id, analysis_run_id, target_entity_id, relation);

ALTER TABLE dependencies
    ADD COLUMN analysis_run_id uuid,
    ADD COLUMN dependency_group text NOT NULL DEFAULT 'legacy',
    ADD CONSTRAINT dependencies_analysis_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT;

DO $migration$
DECLARE
    legacy_unique_name text;
BEGIN
    SELECT constraint_row.conname
      INTO legacy_unique_name
      FROM pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'dependencies'::regclass
       AND constraint_row.contype = 'u'
       AND pg_get_constraintdef(constraint_row.oid) =
           'UNIQUE (organization_id, repository_id, commit_id, package_manager, package_name, manifest_path)';

    IF legacy_unique_name IS NULL THEN
        RAISE EXCEPTION 'Expected legacy dependency uniqueness constraint was not found';
    END IF;

    EXECUTE format('ALTER TABLE dependencies DROP CONSTRAINT %I', legacy_unique_name);
END;
$migration$;

CREATE UNIQUE INDEX dependencies_run_identity_unique
    ON dependencies (
        organization_id, repository_id, commit_id, analysis_run_id,
        package_manager, package_name, manifest_path, dependency_group
    )
    WHERE analysis_run_id IS NOT NULL;

ALTER TABLE dependencies
    ADD CONSTRAINT dependencies_run_identity_id_unique
        UNIQUE (organization_id, repository_id, commit_id, analysis_run_id, id);

CREATE INDEX dependencies_run_scope_idx
    ON dependencies (organization_id, repository_id, commit_id, analysis_run_id, package_manager, package_name);

ALTER TABLE dependency_edges
    ADD COLUMN analysis_run_id uuid,
    ADD CONSTRAINT dependency_edges_analysis_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT dependency_edges_from_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, from_dependency_id)
        REFERENCES dependencies (organization_id, repository_id, commit_id, analysis_run_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT dependency_edges_to_run_fk
        FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, to_dependency_id)
        REFERENCES dependencies (organization_id, repository_id, commit_id, analysis_run_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX dependency_edges_run_identity_unique
    ON dependency_edges (
        organization_id, repository_id, commit_id, analysis_run_id,
        from_dependency_id, to_dependency_id, relationship
    )
    WHERE analysis_run_id IS NOT NULL;

CREATE TABLE data_flow_edges (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    analysis_run_id uuid NOT NULL,
    source_entity_id uuid NOT NULL,
    target_entity_id uuid NOT NULL,
    rule_id text NOT NULL,
    evidence_path_id text NOT NULL,
    resolution text NOT NULL CHECK (resolution IN ('EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN')),
    confidence text CHECK (confidence IS NULL OR confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (
        organization_id, repository_id, commit_id, analysis_run_id,
        source_entity_id, target_entity_id, rule_id, evidence_path_id
    ),
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, source_entity_id)
        REFERENCES code_entities (organization_id, repository_id, commit_id, analysis_run_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, target_entity_id)
        REFERENCES code_entities (organization_id, repository_id, commit_id, analysis_run_id, id) ON DELETE RESTRICT
);

ALTER TABLE data_flow_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_flow_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_flow_edges
    USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE INDEX data_flow_edges_run_source_idx
    ON data_flow_edges (organization_id, repository_id, commit_id, analysis_run_id, source_entity_id);

CREATE INDEX data_flow_edges_run_target_idx
    ON data_flow_edges (organization_id, repository_id, commit_id, analysis_run_id, target_entity_id);

COMMIT;
