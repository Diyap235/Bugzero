BEGIN;

ALTER TABLE ai_explanations
    ADD COLUMN prompt_version text NOT NULL DEFAULT 'legacy-v1',
    ADD COLUMN idempotency_key text,
    ADD COLUMN result jsonb,
    ADD COLUMN error_code text,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT ai_explanations_result_object_check
        CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
    ADD CONSTRAINT ai_explanations_error_code_check
        CHECK (error_code IS NULL OR error_code IN (
            'MISSING_CONFIGURATION',
            'INVALID_CONFIGURATION',
            'TIMEOUT',
            'RATE_LIMITED',
            'PROVIDER_ERROR',
            'INVALID_RESPONSE',
            'CONTEXT_TOO_LARGE'
        ));

CREATE UNIQUE INDEX ai_explanations_occurrence_idempotency_unique
    ON ai_explanations (organization_id, finding_occurrence_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
