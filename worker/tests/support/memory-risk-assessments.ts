import type {
  CreateOrGetRiskAssessmentResult,
  CreateRiskAssessmentInput,
  RiskAssessmentRecord,
} from '@bugzero/database';

export class MemoryRiskAssessmentRepository {
  readonly assessments = new Map<string, RiskAssessmentRecord>();

  async createOrGet(input: CreateRiskAssessmentInput): Promise<CreateOrGetRiskAssessmentResult> {
    const key = `${input.organizationId}|${input.findingOccurrenceId}|${input.profileId}|${input.profileVersion}`;
    const existing = this.assessments.get(key);
    if (existing) return { record: existing, created: false };
    const record: RiskAssessmentRecord = {
      id: `risk-${this.assessments.size + 1}`,
      organization_id: input.organizationId,
      finding_id: input.findingId,
      finding_occurrence_id: input.findingOccurrenceId,
      evidence_id: input.evidenceId,
      repository_id: input.repositoryId,
      commit_id: input.commitId,
      analysis_run_id: input.analysisRunId,
      profile_id: input.profileId,
      profile_version: input.profileVersion,
      model_version: input.modelVersion,
      severity: input.severity,
      confidence: input.confidence,
      evidence_strength: input.evidenceStrength,
      evidence_authority: input.evidenceAuthority,
      evidence_sufficiency: input.evidenceSufficiency,
      evidence_completeness: input.evidenceCompleteness,
      reachability: input.reachability,
      exploitability: input.exploitability,
      dependency_exposure: input.dependencyExposure,
      affected_module_count: input.affectedModuleCount,
      technical_risk: input.technicalRisk,
      risk_band: input.riskBand,
      profile_snapshot: input.profileSnapshot,
      factors: input.factors,
      calculation: input.calculation,
      explanation: input.explanation,
      assessed_at: new Date(0).toISOString(),
    };
    this.assessments.set(key, record);
    return { record, created: true };
  }
}
