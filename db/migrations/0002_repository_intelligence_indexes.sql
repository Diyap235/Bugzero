BEGIN;

CREATE INDEX IF NOT EXISTS idx_code_entities_commit_lookup
    ON code_entities (organization_id, repository_id, commit_id, entity_type, qualified_name);

CREATE INDEX IF NOT EXISTS idx_code_entities_file_lookup
    ON code_entities (organization_id, repository_id, commit_id, file_path, entity_type);

CREATE INDEX IF NOT EXISTS idx_code_relationships_commit_source
    ON code_relationships (organization_id, repository_id, commit_id, source_entity_id, relation);

CREATE INDEX IF NOT EXISTS idx_code_relationships_commit_target
    ON code_relationships (organization_id, repository_id, commit_id, target_entity_id, relation);

CREATE INDEX IF NOT EXISTS idx_code_relationships_commit_kind
    ON code_relationships (organization_id, repository_id, commit_id, relation, resolution);

CREATE INDEX IF NOT EXISTS idx_dependencies_commit_lookup
    ON dependencies (organization_id, repository_id, commit_id, direct, package_name);

CREATE INDEX IF NOT EXISTS idx_dependency_edges_commit_lookup
    ON dependency_edges (organization_id, repository_id, commit_id, from_dependency_id, to_dependency_id, relationship);

COMMIT;
