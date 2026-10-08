import type {
  CreateOrGetHealthSnapshotInput,
  CreateOrGetHealthSnapshotResult,
  HealthSnapshot,
} from '@bugzero/database';

export class MemoryHealthRepository {
  readonly snapshots = new Map<string, HealthSnapshot>();

  async createOrGetSnapshot(input: CreateOrGetHealthSnapshotInput): Promise<CreateOrGetHealthSnapshotResult> {
    const key = `${input.organizationId}|${input.repositoryId}|${input.commitId}|${input.profileId}|${input.profileVersion}`;
    const existing = this.snapshots.get(key);
    if (existing) return { record: existing, created: false };
    const record: HealthSnapshot = {
      id: `health-${this.snapshots.size + 1}`,
      organization_id: input.organizationId,
      repository_id: input.repositoryId,
      commit_id: input.commitId,
      analysis_run_id: input.analysisRunId,
      profile_id: input.profileId,
      profile_version: input.profileVersion,
      model_version: input.modelVersion,
      overall_score: input.overallScore,
      overall_status: input.overallStatus,
      coverage: input.coverage,
      dimensions: input.dimensions,
      profile_snapshot: input.profileSnapshot,
      calculation: input.calculation,
      explanation: input.explanation,
      security_score: input.securityScore,
      quality_score: input.qualityScore,
      reliability_score: input.reliabilityScore,
      maintainability_score: input.maintainabilityScore,
      dependency_score: input.dependencyScore,
      created_at: new Date(0).toISOString(),
    };
    this.snapshots.set(key, record);
    return { record, created: true };
  }
}
