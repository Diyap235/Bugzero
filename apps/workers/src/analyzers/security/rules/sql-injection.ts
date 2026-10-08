import type { ConfidenceLevel } from '../../types.js';

export interface SecurityRuleMetadata {
  id: string;
  version: string;
  name: string;
  category: 'SECURITY';
  severity: 'HIGH';
  description: string;
}

export const sqlInjectionRule: SecurityRuleMetadata = {
  id: 'SECURITY.SQL_INJECTION',
  version: '1.0.0',
  name: 'SQL Injection',
  category: 'SECURITY',
  severity: 'HIGH',
  description: 'Untrusted input reaches a SQL execution sink through dynamic SQL without recognized parameter binding.',
};

export const sqlInjectionSourcePatterns = {
  javascript: {
    requestRoots: ['req', 'request'],
    inputProperties: ['query', 'body', 'params'],
  },
  python: {
    requestRoots: ['req', 'request'],
    inputProperties: ['args', 'form', 'json', 'query', 'body', 'params'],
  },
} as const;

export const sqlInjectionSinkPatterns = {
  receiverMethods: {
    db: ['query', 'execute'],
    database: ['query', 'execute'],
    connection: ['query', 'execute'],
    conn: ['query', 'execute'],
    cursor: ['execute'],
  },
} as const;

export function classifySqlInjectionConfidence(exactSource: boolean, exactSink: boolean, completePath: boolean): ConfidenceLevel {
  return exactSource && exactSink && completePath ? 'HIGH' : 'LOW';
}
