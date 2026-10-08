import { createHash } from 'node:crypto';

import {
  evidenceRepository,
  findingsRepository,
  riskAssessmentRepository,
  type EvidenceRepository,
  type FindingRepository,
  type RiskAssessmentRepository,
  type CodeEntityRecord,
  type CodeRelationshipRecord,
} from '@bugzero/database';

import type { RepositoryIntelligenceSnapshot } from '../intelligence/types.js';
import { structuralQualityAnalyzer } from './structural-quality/analyzer.js';
import { sqlInjectionAnalyzer } from './security/sql-injection-analyzer.js';
import { AnalyzerContext, type AnalysisScopeDefinition } from './analyzer-context.js';
import type { Analyzer, AnalyzerResult, FindingCandidate } from './types.js';
import type { SourceAccess } from './source-access.js';
import { analyzerRegistry, AnalyzerRegistry } from './analyzer-registry.js';
import { buildFindingEvidenceGraph } from '../evidence/finding-evidence.js';
import { defaultEvidenceTraversalLimits } from '../evidence/evidence-path-builder.js';
import { deterministicRiskEngine, type RiskAssessmentInput } from '../risk/risk-engine.js';
import type { HealthAnalyzerStatus, HealthFindingSignal } from '../health/health-engine.js';

export interface AnalyzerExecutionInput {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  analysisProfileId: string;
  analysisProfileVersion: string;
  analysisScope: AnalysisScopeDefinition;
  repositoryIntelligence?: RepositoryIntelligenceSnapshot;
  sourceAccess: SourceAccess;
  resourceBudget?: { maxFiles: number; maxEntities: number; maxDurationMs: number };
  codeIR?: {
    entities: CodeEntityRecord[];
    relationships: CodeRelationshipRecord[];
  };
  language?: string;
}

export class AnalyzerOrchestrator {
  constructor(
    private readonly registry: AnalyzerRegistry = analyzerRegistry,
    private readonly findings: Pick<FindingRepository, 'createOrGet' | 'createOccurrenceIfAbsent' | 'updateCurrentRisk'> = findingsRepository,
    private readonly evidence: Pick<EvidenceRepository, 'createGraph'> = evidenceRepository,
    private readonly riskAssessments: Pick<RiskAssessmentRepository, 'createOrGet'> = riskAssessmentRepository,
  ) {}

  async execute(input: AnalyzerExecutionInput): Promise<{
    results: AnalyzerResult[];
    findingIds: string[];
    evidenceMetrics: {
      snapshots: number;
      nodes: number;
      edges: number;
      paths: number;
      durationMs: number;
      budgetExhausted: boolean;
    };
    riskMetrics: { assessments: number; failures: number };
    healthSignals?: HealthFindingSignal[];
    analyzerCoverage?: { security: HealthAnalyzerStatus; quality: HealthAnalyzerStatus; maintainability: HealthAnalyzerStatus };
  }> {
    if (this.registry === analyzerRegistry && !this.registry.get(structuralQualityAnalyzer.metadata.name)) {
      this.registry.register(structuralQualityAnalyzer);
    }
    if (this.registry === analyzerRegistry && !this.registry.get(sqlInjectionAnalyzer.metadata.name)) {
      this.registry.register(sqlInjectionAnalyzer);
    }

    const analyzers = this.registry.listMatching(input.language ?? 'TypeScript', ['semantic-code-ir'], input.analysisScope.mode);
    const results: AnalyzerResult[] = [];
    const findingIds = new Set<string>();
    const evidenceMetrics = {
      snapshots: 0,
      nodes: 0,
      edges: 0,
      paths: 0,
      durationMs: 0,
      budgetExhausted: false,
    };
    const riskMetrics = { assessments: 0, failures: 0 };
    const healthSignals: HealthFindingSignal[] = [];
    const analyzerCoverage: { security: HealthAnalyzerStatus; quality: HealthAnalyzerStatus; maintainability: HealthAnalyzerStatus } = {
      security: 'UNKNOWN',
      quality: 'UNKNOWN',
      maintainability: 'UNKNOWN',
    };

    for (const analyzer of analyzers) {
      try {
        const context = new AnalyzerContext({
          organizationId: input.organizationId,
          repositoryId: input.repositoryId,
          commitId: input.commitId,
          analysisRunId: input.analysisRunId,
          analysisProfileId: input.analysisProfileId,
          analysisScope: input.analysisScope,
          codeIR: input.codeIR,
          repositoryIntelligence: input.repositoryIntelligence,
          sourceAccess: input.sourceAccess,
          resourceBudget: input.resourceBudget,
        });
        const result = await analyzer.analyze(context);
        let evidenceIncomplete = false;

        for (const candidate of result.findings) {
          const normalized = this.normalizeFindingCandidate(candidate);
          const semanticTarget = normalized.semanticTarget ?? normalized.file;
          const identityFingerprint = this.buildIdentityFingerprint(analyzer, normalized, semanticTarget);
          const findingResult = await this.findings.createOrGet({
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            ruleId: candidate.ruleId,
            identityFingerprint,
            identityVersion: 'bugzero-finding-v1',
            currentSeverity: this.toFindingSeverity(candidate.severity),
            currentConfidence: this.toFindingConfidence(candidate.confidence),
            currentRisk: this.toRisk(candidate.severity),
            lastSeenCommitId: input.commitId,
            businessPriority: null,
          });

          const normalizedFingerprint = this.buildOccurrenceFingerprint(
            input,
            analyzer,
            normalized,
          );
          const evidenceStartedAt = Date.now();
          const graph = buildFindingEvidenceGraph(findingResult.record.id, normalized, {
            ...input.repositoryIntelligence,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            commitId: input.commitId,
            status: input.repositoryIntelligence?.status ?? 'PARTIAL',
            entities: input.repositoryIntelligence?.entities ?? input.codeIR?.entities ?? [],
            relationships: input.repositoryIntelligence?.relationships ?? input.codeIR?.relationships ?? [],
            dependencies: input.repositoryIntelligence?.dependencies ?? [],
            dependencyEdges: input.repositoryIntelligence?.dependencyEdges ?? [],
            entityIndex: input.repositoryIntelligence?.entityIndex ?? new Map(
              (input.codeIR?.entities ?? []).map((entity) => [entity.id, entity]),
            ),
            outgoingRelationships: input.repositoryIntelligence?.outgoingRelationships ?? new Map(),
            incomingRelationships: input.repositoryIntelligence?.incomingRelationships ?? new Map(),
            createdAt: input.repositoryIntelligence?.createdAt ?? new Date().toISOString(),
            irVersion: input.repositoryIntelligence?.irVersion ?? 'unknown',
          });
          const evidenceDurationMs = Date.now() - evidenceStartedAt;
          const budgetExhausted = graph.nodes.length > defaultEvidenceTraversalLimits.maxNodes
            || graph.edges.length > defaultEvidenceTraversalLimits.maxEdges
            || graph.paths.length > defaultEvidenceTraversalLimits.maxPaths
            || evidenceDurationMs > defaultEvidenceTraversalLimits.maxDurationMs;
          if (budgetExhausted) {
            graph.diagnostics.push('Evidence graph resource budget was exceeded');
            graph.completeness = 'PARTIAL';
            graph.sufficiency = 'UNKNOWN';
            graph.nodes = graph.nodes.slice(0, defaultEvidenceTraversalLimits.maxNodes);
            graph.edges = graph.edges.slice(0, defaultEvidenceTraversalLimits.maxEdges);
            graph.paths = graph.paths.slice(0, defaultEvidenceTraversalLimits.maxPaths);
            evidenceMetrics.budgetExhausted = true;
          }
          if (graph.completeness !== 'COMPLETE') evidenceIncomplete = true;
          const riskInput = this.buildRiskInput(candidate, graph);
          const riskAssessment = deterministicRiskEngine.assess(riskInput);
          const occurrenceResult = await this.findings.createOccurrenceIfAbsent({
            organizationId: input.organizationId,
            findingId: findingResult.record.id,
            repositoryId: input.repositoryId,
            commitId: input.commitId,
            analysisRunId: input.analysisRunId,
            ruleId: candidate.ruleId,
            semanticTargetId: semanticTarget ?? 'unknown',
            normalizedFingerprint,
            relationshipFingerprint: null,
            filePath: normalized.file,
            startLine: normalized.startLine,
            endLine: normalized.endLine,
            observation: 'DETECTED',
            severity: this.toFindingSeverity(candidate.severity),
            confidence: this.toFindingConfidence(candidate.confidence),
            evidenceStrength: riskAssessment.evidenceStrength,
            exploitability: riskAssessment.exploitability,
            reachability: riskAssessment.reachability,
            technicalRisk: riskAssessment.technicalRisk,
            resolution: 'EXACT',
            matchResult: semanticTarget
              ? (findingResult.created ? 'NEW' : 'SAME')
              : 'UNKNOWN',
          });
          const persistedGraph = await this.evidence.createGraph({
            snapshot: {
              organizationId: input.organizationId,
              findingId: findingResult.record.id,
              findingOccurrenceId: occurrenceResult.record.id,
              analysisRunId: input.analysisRunId,
              repositoryId: input.repositoryId,
              commitId: input.commitId,
              identityFingerprint: graph.identityFingerprint,
              authority: 'AUTHORITATIVE',
              origin: 'DETERMINISTIC_ANALYZER',
              sufficiency: graph.sufficiency,
              completeness: graph.completeness,
              diagnostics: graph.diagnostics,
              analyzerVersions: {
                [analyzer.metadata.name]: analyzer.metadata.version,
                [candidate.ruleId]: candidate.ruleVersion,
              },
              paths: graph.paths.map((path) => ({ ...path, diagnostics: [...path.diagnostics, ...graph.diagnostics] })),
            },
            nodes: graph.nodes,
            edges: graph.edges,
          });
          if (persistedGraph.created) {
            evidenceMetrics.snapshots += 1;
            evidenceMetrics.nodes += persistedGraph.graph.nodes.length;
            evidenceMetrics.edges += persistedGraph.graph.edges.length;
            evidenceMetrics.paths += persistedGraph.graph.snapshot.paths.length;
          }
          let persistedRisk: Awaited<ReturnType<typeof this.riskAssessments.createOrGet>>['record'] | null = null;
          try {
            const riskResult = await this.riskAssessments.createOrGet({
              organizationId: input.organizationId,
              findingId: findingResult.record.id,
              findingOccurrenceId: occurrenceResult.record.id,
              evidenceId: persistedGraph.graph.snapshot.id,
              repositoryId: input.repositoryId,
              commitId: input.commitId,
              analysisRunId: input.analysisRunId,
              profileId: riskAssessment.profileId,
              profileVersion: riskAssessment.profileVersion,
              modelVersion: riskAssessment.modelVersion,
              severity: riskAssessment.severity,
              confidence: riskAssessment.confidence,
              evidenceStrength: riskAssessment.evidenceStrength,
              evidenceAuthority: riskAssessment.evidenceAuthority,
              evidenceSufficiency: riskAssessment.evidenceSufficiency,
              evidenceCompleteness: riskAssessment.evidenceCompleteness,
              reachability: riskAssessment.reachability,
              exploitability: riskAssessment.exploitability,
              dependencyExposure: riskAssessment.dependencyExposure,
              affectedModuleCount: riskAssessment.affectedModuleCount,
              technicalRisk: riskAssessment.technicalRisk,
              riskBand: riskAssessment.riskBand,
              profileSnapshot: { ...riskAssessment.profileSnapshot },
              factors: { ...riskAssessment.factors },
              calculation: { ...riskAssessment.calculation },
              explanation: riskAssessment.explanation,
            });
            riskMetrics.assessments += 1;
            persistedRisk = riskResult.record;
          } catch (error) {
            riskMetrics.failures += 1;
            evidenceIncomplete = true;
            result.diagnostics.push(
              `Risk assessment persistence failed for finding ${findingResult.record.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
          }
          if (persistedRisk) {
            try {
              await this.findings.updateCurrentRisk(
                input.organizationId,
                findingResult.record.id,
                persistedRisk.technical_risk,
              );
            } catch (error) {
              riskMetrics.failures += 1;
              evidenceIncomplete = true;
              result.diagnostics.push(
                `Current risk projection update failed for finding ${findingResult.record.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
              );
            }
          }
          const persistedRuleId = findingResult.record.rule_id;
          healthSignals.push({
            findingId: findingResult.record.id,
            occurrenceId: occurrenceResult.record.id,
            ruleId: persistedRuleId,
            category: persistedRuleId.startsWith('SECURITY.')
              ? 'SECURITY'
              : ['LONG_FUNCTION', 'HIGH_PARAMETER_COUNT', 'HIGH_FAN_OUT', 'HIGH_FAN_IN'].includes(persistedRuleId)
                ? 'MAINTAINABILITY'
                : 'QUALITY',
            severity: occurrenceResult.record.severity,
            confidence: occurrenceResult.record.confidence,
            technicalRisk: persistedRisk ? Number(persistedRisk.technical_risk) : null,
            riskBand: persistedRisk?.risk_band ?? null,
            evidenceAuthority: persistedGraph.graph.snapshot.authority,
            evidenceCompleteness: persistedGraph.graph.snapshot.completeness,
          });
          evidenceMetrics.durationMs += evidenceDurationMs;
          findingIds.add(findingResult.record.id);
        }

        const finalResult: AnalyzerResult = evidenceIncomplete
          ? {
            ...result,
            status: result.status === 'FAILED' ? 'FAILED' : 'PARTIAL',
            diagnostics: riskMetrics.failures > 0
              ? result.diagnostics
              : [...result.diagnostics, 'One or more finding evidence snapshots are partial or incomplete'],
          }
          : result;
        results.push(finalResult);
        const coverageKey = analyzer.metadata.type === 'SECURITY' ? 'security'
          : analyzer.metadata.type === 'QUALITY' || analyzer.metadata.type === 'STRUCTURAL' ? 'quality'
            : null;
        if (coverageKey) {
          const previous = analyzerCoverage[coverageKey];
          analyzerCoverage[coverageKey] = previous === 'FAILED' || finalResult.status === 'FAILED'
            ? 'FAILED'
            : previous === 'PARTIAL' || finalResult.status === 'PARTIAL'
              ? 'PARTIAL'
              : 'COMPLETED';
          if (coverageKey === 'quality') analyzerCoverage.maintainability = analyzerCoverage.quality;
        }
      } catch (error) {
        results.push({
          status: 'FAILED',
          findings: [],
          diagnostics: [`${analyzer.metadata.name}: ${error instanceof Error ? error.message : 'Analyzer execution or persistence failed'}`],
          metrics: {
            durationMs: 0,
            filesAnalyzed: 0,
            entitiesAnalyzed: 0,
            rulesExecuted: 0,
            findingsProduced: 0,
          },
        });
        const coverageKey = analyzer.metadata.type === 'SECURITY' ? 'security'
          : analyzer.metadata.type === 'QUALITY' || analyzer.metadata.type === 'STRUCTURAL' ? 'quality'
            : null;
        if (coverageKey) {
          analyzerCoverage[coverageKey] = 'FAILED';
          if (coverageKey === 'quality') analyzerCoverage.maintainability = 'FAILED';
        }
      }
    }

    return {
      results,
      findingIds: Array.from(findingIds),
      evidenceMetrics,
      riskMetrics,
      healthSignals,
      analyzerCoverage,
    };
  }

  private buildRiskInput(
    candidate: FindingCandidate,
    evidence: ReturnType<typeof buildFindingEvidenceGraph>,
  ): RiskAssessmentInput {
    const evidenceStrength = evidence.nodes.length === 0
      ? 'UNKNOWN'
      : evidence.completeness === 'COMPLETE' && evidence.sufficiency === 'SUFFICIENT'
        ? 'HIGH'
        : 'LOW';
    return {
      severity: this.toFindingSeverity(candidate.severity),
      confidence: this.toFindingConfidence(candidate.confidence),
      evidenceStrength,
      evidenceAuthority: 'AUTHORITATIVE',
      evidenceSufficiency: evidence.sufficiency,
      evidenceCompleteness: evidence.completeness,
      reachability: 'UNKNOWN',
      exploitability: 'UNKNOWN',
    };
  }

  private normalizeFindingCandidate(candidate: FindingCandidate): FindingCandidate {
    return {
      ...candidate,
      file: candidate.file ?? null,
      startLine: candidate.startLine ?? null,
      endLine: candidate.endLine ?? null,
      semanticTarget: candidate.semanticTarget ?? candidate.file ?? null,
      evidenceInputs: candidate.evidenceInputs ?? {},
      fingerprintInputs: candidate.fingerprintInputs ?? {},
    };
  }

  private buildIdentityFingerprint(analyzer: Analyzer, candidate: FindingCandidate, semanticTarget: string | null): string {
    return this.hash({
      version: 'bugzero-finding-v1',
      analyzer: analyzer.metadata.name,
      analyzerVersion: analyzer.metadata.version,
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
      semanticTarget,
    });
  }

  private buildOccurrenceFingerprint(input: AnalyzerExecutionInput, analyzer: Analyzer, candidate: FindingCandidate): string {
    const scope = input.analysisScope;
    return this.hash({
      version: 'bugzero-occurrence-v1',
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      commitId: input.commitId,
      analysisProfileId: input.analysisProfileId,
      analysisProfileVersion: input.analysisProfileVersion,
      analyzer: analyzer.metadata.name,
      analyzerVersion: analyzer.metadata.version,
      scope: {
        mode: scope.mode,
        fileIds: Array.from(new Set(scope.fileIds ?? [])).sort(),
        entityIds: Array.from(new Set(scope.entityIds ?? [])).sort(),
      },
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
      semanticTarget: candidate.semanticTarget,
      fingerprintInputs: candidate.fingerprintInputs,
      evidenceInputs: candidate.evidenceInputs,
    });
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(this.stableSerialize(value)).digest('hex');
  }

  private stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableSerialize(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableSerialize(record[key])}`);
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

  private toFindingSeverity(level: string): 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    switch (level) {
      case 'CRITICAL': return 'CRITICAL';
      case 'HIGH': return 'HIGH';
      case 'MEDIUM': return 'MEDIUM';
      case 'LOW': return 'LOW';
      default: return 'INFO';
    }
  }

  private toFindingConfidence(level: string): 'LOW' | 'MEDIUM' | 'HIGH' {
    switch (level) {
      case 'HIGH': return 'HIGH';
      case 'MEDIUM': return 'MEDIUM';
      default: return 'LOW';
    }
  }

  private toRisk(level: string): number {
    switch (level) {
      case 'CRITICAL': return 90;
      case 'HIGH': return 75;
      case 'MEDIUM': return 55;
      case 'LOW': return 30;
      default: return 10;
    }
  }
}

export const analyzerOrchestrator = new AnalyzerOrchestrator();
