BEGIN;

ALTER TABLE finding_occurrences
    DROP CONSTRAINT finding_occurrences_evidence_strength_check,
    DROP CONSTRAINT finding_occurrences_exploitability_check,
    DROP CONSTRAINT finding_occurrences_reachability_check,
    ADD CONSTRAINT finding_occurrences_evidence_strength_check
        CHECK (evidence_strength IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    ADD CONSTRAINT finding_occurrences_exploitability_check
        CHECK (exploitability IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    ADD CONSTRAINT finding_occurrences_reachability_check
        CHECK (reachability IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'));

CREATE UNIQUE INDEX evidence_risk_assessment_reference_unique
    ON evidence (organization_id, finding_id, finding_occurrence_id, id);

CREATE TABLE risk_assessments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    finding_id uuid NOT NULL,
    finding_occurrence_id uuid NOT NULL,
    evidence_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    commit_id uuid NOT NULL,
    analysis_run_id uuid NOT NULL,
    profile_id text NOT NULL CHECK (length(profile_id) > 0),
    profile_version integer NOT NULL CHECK (profile_version > 0),
    model_version text NOT NULL CHECK (length(model_version) > 0),
    severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    confidence text NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
    evidence_strength text NOT NULL CHECK (evidence_strength IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    evidence_authority text NOT NULL CHECK (evidence_authority IN ('AUTHORITATIVE', 'INVESTIGATIVE', 'UNKNOWN')),
    evidence_sufficiency text NOT NULL CHECK (evidence_sufficiency IN ('SUFFICIENT', 'INSUFFICIENT', 'UNKNOWN')),
    evidence_completeness text NOT NULL CHECK (evidence_completeness IN ('COMPLETE', 'PARTIAL', 'INCOMPLETE')),
    reachability text NOT NULL CHECK (reachability IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    exploitability text NOT NULL CHECK (exploitability IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    dependency_exposure text NOT NULL CHECK (dependency_exposure = 'UNKNOWN'),
    affected_module_count integer CHECK (affected_module_count IS NULL OR affected_module_count >= 0),
    technical_risk numeric(5,2) NOT NULL CHECK (technical_risk BETWEEN 0 AND 100),
    risk_band text NOT NULL CHECK (risk_band IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    profile_snapshot jsonb NOT NULL CHECK (jsonb_typeof(profile_snapshot) = 'object'),
    factors jsonb NOT NULL CHECK (jsonb_typeof(factors) = 'object'),
    calculation jsonb NOT NULL CHECK (jsonb_typeof(calculation) = 'object'),
    explanation text NOT NULL CHECK (length(explanation) > 0),
    assessed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, id),
    UNIQUE (organization_id, finding_occurrence_id, profile_id, profile_version),
    FOREIGN KEY (organization_id, repository_id, finding_id)
        REFERENCES findings (organization_id, repository_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, repository_id, commit_id, analysis_run_id, finding_id, finding_occurrence_id)
        REFERENCES finding_occurrences (
            organization_id, repository_id, commit_id, analysis_run_id, finding_id, id
        ) ON DELETE RESTRICT,
    FOREIGN KEY (organization_id, finding_id, finding_occurrence_id, evidence_id)
        REFERENCES evidence (organization_id, finding_id, finding_occurrence_id, id) ON DELETE RESTRICT
);

CREATE INDEX risk_assessments_repository_revision_idx
    ON risk_assessments (organization_id, repository_id, commit_id, assessed_at DESC);

CREATE TRIGGER risk_assessments_immutable
    BEFORE UPDATE OR DELETE ON risk_assessments
    FOR EACH ROW EXECUTE FUNCTION bugzero_reject_immutable_mutation();

COMMIT;
