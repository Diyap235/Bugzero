import type { CodeEntityRecord } from '@bugzero/database';

import { AnalyzerContext } from '../../analyzer-context.js';
import { structuralQualityRuleDefaults } from '../../rule-config.js';
import type { Rule } from '../../types.js';
import { createFindingCandidate, getRelationshipCount } from './helpers.js';

export const highFanInRule: Rule<CodeEntityRecord, AnalyzerContext> = {
  id: 'HIGH_FAN_IN',
  version: '1.0.0',
  name: 'High Fan In',
  category: 'STRUCTURAL',
  supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
  evaluate(context, target) {
    if (target.entity_type !== 'FUNCTION' && target.entity_type !== 'METHOD' && target.entity_type !== 'CLASS') {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    const fanIn = getRelationshipCount(context, target, 'CALLS', 'incoming');
    const threshold = structuralQualityRuleDefaults.HIGH_FAN_IN;
    if (fanIn <= threshold) {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    return {
      findings: [createFindingCandidate(context, target, this, {
        title: 'Entity has high fan-in',
        description: 'This entity is relied on by many call sites, which can make change impact broader than expected.',
        severity: 'MEDIUM',
        evidenceInputs: {
          file: target.file_path,
          entity: target.name,
          fanIn,
          configuredThreshold: threshold,
        },
        fingerprintInputs: { fanIn, threshold },
      })],
      diagnostics: [],
      unsupported: false,
    };
  },
};
