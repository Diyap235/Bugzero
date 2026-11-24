import type { CodeEntityRecord } from '@bugzero/database';

import { AnalyzerContext } from '../../analyzer-context.js';
import { structuralQualityRuleDefaults } from '../../rule-config.js';
import type { Rule } from '../../types.js';
import { createFindingCandidate, getRelationshipCount } from './helpers.js';

export const highParameterCountRule: Rule<CodeEntityRecord, AnalyzerContext> = {
  id: 'HIGH_PARAMETER_COUNT',
  version: '1.0.0',
  name: 'High Parameter Count',
  category: 'STRUCTURAL',
  supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
  evaluate(context, target) {
    if (target.entity_type !== 'FUNCTION' && target.entity_type !== 'METHOD') {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    const parameterCount = getRelationshipCount(context, target, 'DECLARES', 'outgoing', 'PARAMETER');
    const threshold = structuralQualityRuleDefaults.HIGH_PARAMETER_COUNT;
    if (parameterCount <= threshold) {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    return {
      findings: [createFindingCandidate(context, target, this, {
        title: 'Function accepts too many parameters',
        description: 'This function has significantly more parameters than the project threshold and may be hard to reason about.',
        severity: 'MEDIUM',
        evidenceInputs: {
          file: target.file_path,
          function: target.name,
          parameterCount,
          configuredThreshold: threshold,
        },
        fingerprintInputs: { parameterCount, threshold },
      })],
      diagnostics: [],
      unsupported: false,
    };
  },
};
