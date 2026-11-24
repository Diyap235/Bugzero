import type { CodeEntityRecord } from '@bugzero/database';

import { AnalyzerContext } from '../../analyzer-context.js';
import { structuralQualityRuleDefaults } from '../../rule-config.js';
import type { Rule } from '../../types.js';
import { createFindingCandidate, unsupportedRule } from './helpers.js';

export const longFunctionRule: Rule<CodeEntityRecord, AnalyzerContext> = {
  id: 'LONG_FUNCTION',
  version: '1.0.0',
  name: 'Long Function',
  category: 'STRUCTURAL',
  supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
  evaluate(context, target) {
    if (target.entity_type !== 'FUNCTION' && target.entity_type !== 'METHOD') {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    const start = target.start_line;
    const end = target.end_line;
    if (start === null || end === null || end < start) {
      return unsupportedRule('Function has no valid source line boundaries');
    }

    const measuredLineCount = end - start + 1;
    const threshold = structuralQualityRuleDefaults.LONG_FUNCTION_LINES;
    if (measuredLineCount <= threshold) {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    return {
      findings: [createFindingCandidate(context, target, this, {
        title: 'Function exceeds recommended length',
        description: 'The function exceeds the configured long-function threshold and may be difficult to review or maintain.',
        severity: 'LOW',
        evidenceInputs: {
          file: target.file_path,
          function: target.name,
          startLine: start,
          endLine: end,
          measuredLineCount,
          configuredThreshold: threshold,
        },
        fingerprintInputs: { measuredLineCount, threshold },
      })],
      diagnostics: [],
      unsupported: false,
    };
  },
};
