import { AnalyzerContext } from '../analyzer-context.js';
import type { Analyzer, AnalyzerResult, FindingCandidate, Rule, ScopeMode } from '../types.js';
import { longFunctionRule } from './rules/long-function.js';
import { highParameterCountRule } from './rules/parameter-count.js';
import { highFanOutRule } from './rules/fan-out.js';
import { highFanInRule } from './rules/fan-in.js';
import { emptyFunctionRule } from './rules/empty-function.js';

export class StructuralQualityAnalyzer implements Analyzer {
  readonly metadata: Analyzer['metadata'] = {
    name: 'structural-quality-analyzer',
    version: '1.0.0',
    type: 'STRUCTURAL',
    supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
    requiredIR: ['semantic-code-ir'],
    supportedScopes: ['FULL', 'FILE', 'ENTITY', 'IMPACTED'] as ScopeMode[],
    resourceCost: 'MEDIUM',
    supportsIncremental: true,
  };

  constructor(private readonly rules: Rule[] = [
    longFunctionRule,
    highParameterCountRule,
    highFanOutRule,
    highFanInRule,
    emptyFunctionRule,
  ]) {}

  async analyze(context: AnalyzerContext): Promise<AnalyzerResult> {
    const start = Date.now();
    const scopedEntities = context.getEntitiesForScope();
    const findings: FindingCandidate[] = [];
    const diagnostics: string[] = [];
    let partial = false;
    if (!context.codeIR && !context.repositoryIntelligence) {
      return {
        status: 'PARTIAL',
        findings,
        diagnostics: ['Semantic Code IR is unavailable; structural analysis was not performed'],
        metrics: {
          durationMs: Date.now() - start,
          filesAnalyzed: 0,
          entitiesAnalyzed: 0,
          rulesExecuted: 0,
          findingsProduced: 0,
        },
      };
    }

    const selectionIsEmpty = context.analysisScope.mode === 'FILE'
      ? (context.analysisScope.fileIds?.length ?? 0) === 0
      : context.analysisScope.mode === 'ENTITY' || context.analysisScope.mode === 'IMPACTED'
        ? context.analysisScope.mode === 'IMPACTED'
          ? (context.analysisScope.entityIds?.length ?? 0) === 0 && (context.analysisScope.fileIds?.length ?? 0) === 0
          : (context.analysisScope.entityIds?.length ?? 0) === 0
        : false;
    if (selectionIsEmpty) {
      diagnostics.push(`${context.analysisScope.mode} scope has no selected targets; no repository-wide fallback was applied`);
      partial = true;
    }

    let filesAnalyzed = 0;
    let entitiesAnalyzed = 0;
    let rulesExecuted = 0;

    const seen = new Set<string>();
    const analyzedFiles = new Set<string>();
    const maxFiles = context.resourceBudget.maxFiles;
    const maxEntities = context.resourceBudget.maxEntities;
    let stop = selectionIsEmpty;

    for (const entity of scopedEntities) {
      const isNewFile = entity.file_path !== null && !analyzedFiles.has(entity.file_path);
      if (entitiesAnalyzed >= maxEntities || (isNewFile && filesAnalyzed >= maxFiles)) {
        diagnostics.push(entitiesAnalyzed >= maxEntities
          ? `Exceeded maxEntities budget (${maxEntities})`
          : `Exceeded maxFiles budget (${maxFiles})`);
        partial = true;
        break;
      }

      if (isNewFile && entity.file_path) {
        analyzedFiles.add(entity.file_path);
        filesAnalyzed += 1;
      }
      entitiesAnalyzed += 1;

      for (const rule of this.rules) {
        if (rulesExecuted > 0 && Date.now() - start >= context.resourceBudget.maxDurationMs) {
          diagnostics.push(`Exceeded maxDurationMs budget (${context.resourceBudget.maxDurationMs})`);
          partial = true;
          stop = true;
          break;
        }

        rulesExecuted += 1;
        const result = await rule.evaluate(context, entity);
        if (result.unsupported) {
          diagnostics.push(`${rule.name}: ${result.diagnostics.join('; ') || 'unsupported for this scope'}`);
          partial = true;
          continue;
        }
        for (const finding of result.findings) {
          const signature = `${finding.ruleId}:${finding.semanticTarget ?? finding.file ?? 'unknown'}:${finding.startLine ?? 'n'}:${finding.endLine ?? 'n'}`;
          if (!seen.has(signature)) {
            seen.add(signature);
            findings.push(finding);
          }
        }

        if (Date.now() - start > context.resourceBudget.maxDurationMs) {
          diagnostics.push(`Exceeded maxDurationMs budget (${context.resourceBudget.maxDurationMs})`);
          partial = true;
          stop = true;
          break;
        }
      }
      if (stop) break;
    }

    const metrics = {
      durationMs: Date.now() - start,
      filesAnalyzed,
      entitiesAnalyzed,
      rulesExecuted,
      findingsProduced: findings.length,
    };

    return {
      status: partial ? 'PARTIAL' : 'COMPLETED',
      findings,
      diagnostics,
      metrics,
    };
  }
}

export const structuralQualityAnalyzer = new StructuralQualityAnalyzer();
