import type { CodeEntityRecord } from '@bugzero/database';

import { AnalyzerContext } from '../../analyzer-context.js';
import type { Rule } from '../../types.js';
import { createFindingCandidate, unsupportedRule } from './helpers.js';

function isClearlyEmpty(language: string | undefined, source: string): boolean {
  if (language?.toLowerCase() === 'python') {
    if (/@abstractmethod\b/.test(source)) return false;
    return /^\s*(?:async\s+)?def\s+[\s\S]*?:\s*(?:#.*)?\r?\n\s+pass\s*(?:#.*)?\s*$/m.test(source);
  }

  if (language?.toLowerCase() === 'javascript' || language?.toLowerCase() === 'typescript') {
    return /\bfunction\b[^{}]*\{\s*\}/.test(source)
      || /(?:^|\n)\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^{}]*\)\s*\{\s*\}/.test(source)
      || /=>\s*\{\s*\}/.test(source);
  }

  return false;
}

export const emptyFunctionRule: Rule<CodeEntityRecord, AnalyzerContext> = {
  id: 'EMPTY_FUNCTION',
  version: '1.0.0',
  name: 'Empty Function',
  category: 'STRUCTURAL',
  supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
  async evaluate(context, target) {
    if (target.entity_type !== 'FUNCTION' && target.entity_type !== 'METHOD') {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    if (target.start_line === null || target.end_line === null || target.end_line < target.start_line || !target.file_path) {
      return unsupportedRule('Function has no valid source location for empty-body verification');
    }

    const metadata = await context.sourceAccess.getSourceMetadata(target.file_path);
    if (!metadata.exists) {
      return unsupportedRule('Source unavailable; empty-body rule skipped to avoid false positives');
    }

    const source = (await context.sourceAccess.getLineRange(target.file_path, target.start_line, target.end_line)).join('\n');
    const language = metadata.language ?? target.file_path.split('.').pop()?.toLowerCase();
    if (!isClearlyEmpty(language, source)) {
      return { findings: [], diagnostics: [], unsupported: false };
    }

    return {
      findings: [createFindingCandidate(context, target, this, {
        title: 'Function is effectively empty',
        description: 'This function contains only an explicit no-op body.',
        severity: 'LOW',
        evidenceInputs: {
          file: target.file_path,
          function: target.name,
          startLine: target.start_line,
          endLine: target.end_line,
          body: source,
        },
        fingerprintInputs: { body: source },
      })],
      diagnostics: [],
      unsupported: false,
    };
  },
};
