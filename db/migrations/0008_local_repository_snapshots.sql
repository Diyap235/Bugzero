BEGIN;

ALTER TABLE repositories
    DROP CONSTRAINT repositories_provider_check,
    ADD CONSTRAINT repositories_provider_check CHECK (provider IN ('GITHUB', 'LOCAL'));

ALTER TABLE repository_files
    ADD COLUMN source_content text;

COMMIT;
