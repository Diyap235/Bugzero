import type { CodeEntityRecord } from '@bugzero/database';

import { AnalyzerContext } from '../../analyzer-context.js';
import { structuralQualityRuleDefaults } from '../../rule-config.js';
import type { Rule } from '../../types.js';
import { createFindingCandidate, getRelationshipCount } from './helpers.js';

export const highFanOutRule: Rule<CodeEntityRecord, AnalyzerContext> = {
  id: 'HIGH_FAN_OUT',
  version: '1.0.0',
  name: 'High Fan Out',
  category: 'STRUCTURAL',
  supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
  evaluate(context, target) {
    if (target.entity_type !== 'FUNCTION' && target.entity_type !== 'METHOD' && target.entity_type !== 'CLASS') {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    const fanOut = getRelationshipCount(context, target, 'CALLS', 'outgoing');
    const threshold = structuralQualityRuleDefaults.HIGH_FAN_OUT;
    if (fanOut <= threshold) {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    return {
      findings: [createFindingCandidate(context, target, this, {
        title: 'Entity has high fan-out',
        description: 'This entity depends on many other symbols, which may increase coupling and reduce maintainability.',
        severity: 'MEDIUM',
        evidenceInputs: {
          file: target.file_path,
          entity: target.name,
          fanOut,
          configuredThreshold: threshold,
        },
        fingerprintInputs: { fanOut, threshold },
      })],
      diagnostics: [],
      unsupported: false,
    };
  },
};
