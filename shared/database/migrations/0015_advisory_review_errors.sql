BEGIN;

ALTER TABLE ai_explanations
    DROP CONSTRAINT ai_explanations_error_code_check,
    ADD CONSTRAINT ai_explanations_error_code_check
        CHECK (error_code IS NULL OR error_code IN (
            'MISSING_CONFIGURATION',
            'INVALID_CONFIGURATION',
            'TIMEOUT',
            'RATE_LIMITED',
            'PROVIDER_ERROR',
            'INVALID_RESPONSE',
            'CONTEXT_TOO_LARGE',
            'INSUFFICIENT_SOURCE'
        ));

COMMIT;
