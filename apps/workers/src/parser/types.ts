import type { ParseStatus, CodeEntity, CodeRelationship } from '@bugzero/contracts';

export type SupportedLanguage = 'Python' | 'JavaScript' | 'TypeScript' | 'UNKNOWN';

export interface ParseInput {
  repositoryId: string;
  commitId: string;
  filePath: string;
  language: SupportedLanguage;
  contentHash: string;
  sourceContent: string;
}

export interface CodeEntityDraft {
  id: string;
  repositoryId: string;
  commitId: string;
  filePath: string;
  kind: CodeEntity['kind'];
  name: string;
  qualifiedName: string;
  language: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  sourceFingerprint: string;
  provenance: Record<string, unknown>;
}

export interface CodeRelationshipDraft {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  kind: CodeRelationship['kind'];
  resolution: CodeRelationship['resolution'];
  confidence?: number;
  provenance: Record<string, unknown>;
}

export interface ParsedFileResult {
  status: ParseStatus;
  language: string;
  parserVersion: string;
  irVersion: string;
  durationMs: number;
  entityCount: number;
  relationshipCount: number;
  entities: CodeEntity[];
  relationships: CodeRelationship[];
  diagnostics: string[];
  cacheKey: string;
}

export interface LanguageAdapter {
  language: SupportedLanguage;
  canParse(input: ParseInput): boolean;
  parse(input: ParseInput): ParsedFileResult;
}
