BEGIN;

CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    display_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'DEVELOPER', 'SECURITY_REVIEWER', 'VIEWER')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, user_id)
);

CREATE TABLE repositories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    provider text NOT NULL CHECK (provider IN ('GITHUB')),
    external_id text NOT NULL,
    full_name text NOT NULL,
    default_branch text NOT NULL,
    clone_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, provider, external_id)
);

CREATE TABLE repository_commits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-fA-F0-9]{40}([a-fA-F0-9]{24})?$'),
    parent_commit_sha text CHECK (parent_commit_sha IS NULL OR parent_commit_sha ~ '^[a-fA-F0-9]{40}([a-fA-F0-9]{24})?$'),
    committed_at timestamptz,
    indexed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, repository_id, id),
    UNIQUE (organization_id, repository_id, commit_sha),
    FOREIGN KEY (organization_id, repository_id)
        REFERENCES repositories (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE repository_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    path text NOT NULL CHECK (length(path) > 0),
    content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-fA-F0-9]{64}$'),
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    language text,
    object_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, commit_id, path),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT
);

CREATE TABLE analysis_profiles (
    id text NOT NULL,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    version text NOT NULL,
    analyzers jsonb NOT NULL CHECK (jsonb_typeof(analyzers) = 'array'),
    max_depth integer CHECK (max_depth IS NULL OR max_depth > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id, version)
);

CREATE TABLE analysis_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    profile_id text NOT NULL,
    profile_version text NOT NULL,
    scope text NOT NULL CHECK (scope IN ('REPOSITORY', 'COMMIT', 'CHANGED_FILES', 'AFFECTED_SYMBOLS', 'PR')),
    status text NOT NULL CHECK (status IN ('NOT_STARTED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'UNAVAILABLE')),
    coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, repository_id, id),
    UNIQUE (organization_id, repository_id, commit_id, id),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, profile_id, profile_version)
        REFERENCES analysis_profiles (organization_id, id, version) ON DELETE RESTRICT
);

CREATE TABLE analysis_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    run_id uuid NOT NULL,
    stage text NOT NULL CHECK (stage IN ('INGESTION', 'PARSING', 'CODE_IR', 'INTELLIGENCE', 'SECURITY_ANALYSIS', 'QUALITY_ANALYSIS', 'DEPENDENCY_ANALYSIS', 'EVIDENCE', 'RISK', 'AI_ENRICHMENT')),
    analyzer text NOT NULL,
    analyzer_type text NOT NULL CHECK (analyzer_type IN ('STRUCTURAL', 'SECURITY', 'TAINT', 'DEPENDENCY', 'QUALITY')),
    scope_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRY', 'DEAD_LETTER', 'CANCELLED')),
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, idempotency_key),
    FOREIGN KEY (organization_id, run_id)
        REFERENCES analysis_runs (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE code_entities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    entity_key text NOT NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('REPOSITORY', 'FILE', 'MODULE', 'CLASS', 'FUNCTION', 'METHOD', 'SYMBOL', 'PARAMETER', 'TYPE', 'CONSTANT')),
    name text NOT NULL,
    qualified_name text,
    file_path text,
    start_line integer CHECK (start_line IS NULL OR start_line > 0),
    end_line integer CHECK (end_line IS NULL OR end_line >= start_line),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, commit_id, id),
    UNIQUE (organization_id, commit_id, entity_key),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT
);

CREATE TABLE code_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    source_entity_id uuid NOT NULL,
    target_entity_id uuid NOT NULL,
    relation text NOT NULL CHECK (relation IN ('IMPORTS', 'DECLARES', 'CALLS', 'REFERENCES', 'READS', 'WRITES', 'RETURNS', 'PASSES_ARGUMENT', 'INHERITS', 'IMPLEMENTS', 'OVERRIDES', 'DEPENDS_ON')),
    resolution text NOT NULL CHECK (resolution IN ('EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN')),
    confidence text CHECK (confidence IS NULL OR confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, commit_id, source_entity_id)
        REFERENCES code_entities (organization_id, commit_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, commit_id, target_entity_id)
        REFERENCES code_entities (organization_id, commit_id, id) ON DELETE RESTRICT
);

CREATE TABLE findings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    rule_id text NOT NULL,
    identity_fingerprint text NOT NULL,
    identity_version text NOT NULL,
    lifecycle text NOT NULL CHECK (lifecycle IN ('OPEN', 'CONFIRMED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED', 'REOPENED')),
    current_occurrence_id uuid,
    resolution_evidence_id uuid,
    current_severity text NOT NULL CHECK (current_severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    current_confidence text NOT NULL CHECK (current_confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    current_risk numeric(5,2) NOT NULL CHECK (current_risk BETWEEN 0 AND 100),
    last_seen_commit_id uuid,
    business_priority text CHECK (business_priority IS NULL OR business_priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    accepted_risk boolean NOT NULL DEFAULT false,
    exception_id uuid,
    disposition_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, repository_id, id),
    UNIQUE (organization_id, repository_id, rule_id, identity_fingerprint),
    FOREIGN KEY (organization_id, repository_id)
        REFERENCES repositories (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, last_seen_commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT,
    CHECK (lifecycle <> 'RESOLVED' OR resolution_evidence_id IS NOT NULL)
);

CREATE TABLE finding_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    finding_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    analysis_run_id uuid NOT NULL,
    rule_id text NOT NULL,
    semantic_target_id text NOT NULL,
    normalized_fingerprint text NOT NULL,
    relationship_fingerprint text,
    file_path text,
    start_line integer CHECK (start_line IS NULL OR start_line > 0),
    end_line integer CHECK (end_line IS NULL OR end_line >= start_line),
    observation text NOT NULL CHECK (observation IN ('DETECTED', 'NOT_DETECTED', 'PARTIALLY_ANALYZED', 'ANALYSIS_INCOMPLETE', 'ANALYSIS_FAILED', 'NOT_APPLICABLE')),
    severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    confidence text NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    evidence_strength text NOT NULL CHECK (evidence_strength IN ('LOW', 'MEDIUM', 'HIGH')),
    exploitability text NOT NULL CHECK (exploitability IN ('LOW', 'MEDIUM', 'HIGH')),
    reachability text NOT NULL CHECK (reachability IN ('LOW', 'MEDIUM', 'HIGH')),
    technical_risk numeric(5,2) NOT NULL CHECK (technical_risk BETWEEN 0 AND 100),
    resolution text NOT NULL CHECK (resolution IN ('EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN')),
    match_result text NOT NULL CHECK (match_result IN ('SAME', 'NEW', 'UNKNOWN')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, finding_id, id),
    UNIQUE (organization_id, repository_id, commit_id, analysis_run_id, finding_id, id),
    UNIQUE (organization_id, finding_id, analysis_run_id),
    FOREIGN KEY (organization_id, repository_id, finding_id)
        REFERENCES findings (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT
);

ALTER TABLE findings
    ADD CONSTRAINT findings_current_occurrence_fk
    FOREIGN KEY (organization_id, id, current_occurrence_id)
    REFERENCES finding_occurrences (organization_id, finding_id, id)
    ON DELETE RESTRICT;

CREATE TABLE evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    finding_id uuid NOT NULL,
    finding_occurrence_id uuid NOT NULL,
    analysis_run_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    authority text NOT NULL CHECK (authority IN ('AUTHORITATIVE', 'INVESTIGATIVE')),
    origin text NOT NULL CHECK (origin IN ('DETERMINISTIC_ANALYZER', 'HEURISTIC', 'AI', 'HUMAN_VALIDATION')),
    sufficiency text NOT NULL CHECK (sufficiency IN ('SUFFICIENT', 'INSUFFICIENT', 'UNKNOWN')),
    complete boolean NOT NULL,
    analyzer_versions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(analyzer_versions) = 'object'),
    paths jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(paths) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, finding_id, id),
    FOREIGN KEY (organization_id, repository_id, finding_id)
        REFERENCES findings (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, finding_id, finding_occurrence_id)
        REFERENCES finding_occurrences (organization_id, finding_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, finding_id, finding_occurrence_id)
        REFERENCES finding_occurrences (organization_id, repository_id, commit_id, analysis_run_id, finding_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT,
    CHECK (complete OR sufficiency <> 'SUFFICIENT'),
    CHECK (origin NOT IN ('AI', 'HEURISTIC') OR authority = 'INVESTIGATIVE'),
    CHECK (authority <> 'AUTHORITATIVE' OR origin IN ('DETERMINISTIC_ANALYZER', 'HUMAN_VALIDATION'))
);

ALTER TABLE findings
    ADD CONSTRAINT findings_resolution_evidence_fk
    FOREIGN KEY (organization_id, id, resolution_evidence_id)
    REFERENCES evidence (organization_id, finding_id, id)
    ON DELETE RESTRICT;

CREATE TABLE evidence_nodes (
    organization_id uuid NOT NULL,
    evidence_id uuid NOT NULL,
    node_key text NOT NULL,
    node_type text NOT NULL CHECK (node_type IN ('SOURCE', 'VARIABLE', 'FUNCTION', 'CALL', 'TRANSFORMATION', 'SANITIZER', 'SINK', 'EXTERNAL_BOUNDARY', 'DATABASE_OPERATION', 'FILE_OPERATION', 'PROCESS_OPERATION')),
    label text NOT NULL,
    file_path text,
    line integer CHECK (line IS NULL OR line > 0),
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
    PRIMARY KEY (organization_id, evidence_id, node_key),
    FOREIGN KEY (organization_id, evidence_id)
        REFERENCES evidence (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE evidence_edges (
    organization_id uuid NOT NULL,
    evidence_id uuid NOT NULL,
    edge_key text NOT NULL,
    from_node_key text NOT NULL,
    to_node_key text NOT NULL,
    relation text NOT NULL,
    resolution text NOT NULL CHECK (resolution IN ('EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN')),
    confidence text NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
    PRIMARY KEY (organization_id, evidence_id, edge_key),
    FOREIGN KEY (organization_id, evidence_id)
        REFERENCES evidence (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, evidence_id, from_node_key)
        REFERENCES evidence_nodes (organization_id, evidence_id, node_key) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, evidence_id, to_node_key)
        REFERENCES evidence_nodes (organization_id, evidence_id, node_key) ON DELETE RESTRICT
);

CREATE TABLE dependencies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    package_manager text NOT NULL,
    package_name text NOT NULL,
    version text,
    manifest_path text NOT NULL,
    direct boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, repository_id, commit_id, id),
    UNIQUE (organization_id, repository_id, commit_id, package_manager, package_name, manifest_path),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT
);

CREATE TABLE dependency_edges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    from_dependency_id uuid NOT NULL,
    to_dependency_id uuid NOT NULL,
    relationship text NOT NULL CHECK (relationship IN ('DEPENDS_ON', 'OPTIONAL_DEPENDENCY', 'PEER_DEPENDENCY')),
    resolution text NOT NULL CHECK (resolution IN ('EXACT', 'INFERRED', 'POSSIBLE', 'UNKNOWN')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, from_dependency_id)
        REFERENCES dependencies (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, to_dependency_id)
        REFERENCES dependencies (organization_id, repository_id, commit_id, id) ON DELETE RESTRICT,
    CHECK (from_dependency_id <> to_dependency_id)
);

CREATE TABLE health_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    security_score numeric(5,2) NOT NULL CHECK (security_score BETWEEN 0 AND 100),
    quality_score numeric(5,2) NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
    reliability_score numeric(5,2) NOT NULL CHECK (reliability_score BETWEEN 0 AND 100),
    maintainability_score numeric(5,2) NOT NULL CHECK (maintainability_score BETWEEN 0 AND 100),
    dependency_score numeric(5,2) NOT NULL CHECK (dependency_score BETWEEN 0 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, repository_id, commit_id)
        REFERENCES repository_commits (organization_id, repository_id, id) ON DELETE RESTRICT
);

CREATE TABLE ai_explanations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    finding_id uuid NOT NULL,
    finding_occurrence_id uuid NOT NULL,
    evidence_id uuid,
    provider text NOT NULL,
    model text NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    content text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, finding_id, finding_occurrence_id)
        REFERENCES finding_occurrences (organization_id, finding_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, finding_id, evidence_id)
        REFERENCES evidence (organization_id, finding_id, id) ON DELETE RESTRICT
);

CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    analysis_run_id uuid NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    format text NOT NULL CHECK (format IN ('JSON', 'PDF', 'HTML')),
    object_key text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, repository_id)
        REFERENCES repositories (organization_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, analysis_run_id)
        REFERENCES analysis_runs (organization_id, repository_id, id) ON DELETE RESTRICT
);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    action text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid,
    previous_state jsonb,
    new_state jsonb,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id)
);

CREATE INDEX repository_commits_repo_time_idx
    ON repository_commits (organization_id, repository_id, created_at DESC);
CREATE INDEX analysis_runs_repo_time_idx
    ON analysis_runs (organization_id, repository_id, created_at DESC);
CREATE INDEX analysis_jobs_status_idx
    ON analysis_jobs (organization_id, status, created_at);
CREATE INDEX code_entities_commit_type_idx
    ON code_entities (organization_id, commit_id, entity_type);
CREATE INDEX code_relationships_commit_source_idx
    ON code_relationships (organization_id, commit_id, source_entity_id);
CREATE INDEX findings_repo_lifecycle_idx
    ON findings (organization_id, repository_id, lifecycle);
CREATE INDEX finding_occurrences_commit_observation_idx
    ON finding_occurrences (organization_id, commit_id, observation);
CREATE INDEX evidence_occurrence_time_idx
    ON evidence (organization_id, finding_occurrence_id, created_at DESC);
CREATE INDEX dependencies_commit_idx
    ON dependencies (organization_id, commit_id);
CREATE INDEX health_snapshots_repo_time_idx
    ON health_snapshots (organization_id, repository_id, created_at DESC);
CREATE INDEX reports_repo_time_idx
    ON reports (organization_id, repository_id, created_at DESC);
CREATE INDEX audit_logs_org_time_idx
    ON audit_logs (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION bugzero_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable; create a new version instead', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER finding_occurrences_immutable
    BEFORE UPDATE OR DELETE ON finding_occurrences
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER evidence_immutable
    BEFORE UPDATE OR DELETE ON evidence
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER evidence_nodes_immutable
    BEFORE UPDATE OR DELETE ON evidence_nodes
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER evidence_edges_immutable
    BEFORE UPDATE OR DELETE ON evidence_edges
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER health_snapshots_immutable
    BEFORE UPDATE OR DELETE ON health_snapshots
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER ai_explanations_immutable
    BEFORE UPDATE OR DELETE ON ai_explanations
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER reports_immutable
    BEFORE UPDATE OR DELETE ON reports
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();
CREATE TRIGGER audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION bugzero_validate_resolution_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    valid_resolution boolean;
BEGIN
    IF NEW.lifecycle <> 'RESOLVED' THEN
        RETURN NEW;
    END IF;

    IF NEW.resolution_evidence_id IS NULL THEN
        RAISE EXCEPTION 'RESOLVED findings require authoritative complete evidence for a NOT_DETECTED occurrence'
            USING ERRCODE = '23514';
    END IF;

    SELECT e.authority = 'AUTHORITATIVE'
       AND e.complete
       AND e.sufficiency = 'SUFFICIENT'
       AND o.observation = 'NOT_DETECTED'
       AND r.status = 'COMPLETED'
      INTO valid_resolution
      FROM evidence e
      JOIN finding_occurrences o
        ON o.organization_id = e.organization_id
       AND o.finding_id = e.finding_id
       AND o.id = e.finding_occurrence_id
      JOIN analysis_runs r
        ON r.organization_id = e.organization_id
       AND r.id = e.analysis_run_id
     WHERE e.organization_id = NEW.organization_id
       AND e.finding_id = NEW.id
       AND e.id = NEW.resolution_evidence_id;

    IF valid_resolution IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Resolution evidence must be authoritative, complete, sufficient, and tied to a completed NOT_DETECTED occurrence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER findings_resolution_evidence_guard
    BEFORE INSERT OR UPDATE OF lifecycle, resolution_evidence_id ON findings
    FOR EACH ROW EXECUTE FUNCTION bugzero_validate_resolution_evidence();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON organizations
    USING (id = nullif(current_setting('app.organization_id', true), '')::uuid)
    WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid);

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'members', 'repositories', 'repository_commits', 'repository_files',
        'analysis_profiles', 'analysis_runs', 'analysis_jobs', 'code_entities',
        'code_relationships', 'findings', 'finding_occurrences', 'evidence',
        'evidence_nodes', 'evidence_edges', 'dependencies', 'dependency_edges',
        'health_snapshots', 'ai_explanations', 'reports', 'audit_logs'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END;
$$;

COMMIT;
