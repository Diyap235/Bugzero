BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS code_relationships_semantic_identity_unique
    ON code_relationships (
        organization_id,
        repository_id,
        commit_id,
        source_entity_id,
        target_entity_id,
        relation
    );

COMMIT;
