import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';

import type { RepositoryIntelligenceSnapshot } from '../intelligence/types.js';
import type { ResourceBudget, ScopeMode } from './types.js';
import type { SourceAccess } from './source-access.js';

export interface AnalysisScopeDefinition {
  mode: ScopeMode;
  fileIds?: string[];
  entityIds?: string[];
  reason?: string;
  complete?: boolean;
}

export interface AnalyzerContextOptions {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  analysisRunId: string;
  analysisProfileId: string;
  analysisScope: AnalysisScopeDefinition;
  codeIR?: {
    entities: CodeEntityRecord[];
    relationships: CodeRelationshipRecord[];
  };
  repositoryIntelligence?: RepositoryIntelligenceSnapshot;
  sourceAccess: SourceAccess;
  analyzerConfig?: Record<string, unknown>;
  resourceBudget?: Partial<ResourceBudget>;
}

export class AnalyzerContext {
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly commitId: string;
  readonly analysisRunId: string;
  readonly analysisProfileId: string;
  readonly analysisScope: AnalysisScopeDefinition;
  readonly codeIR?: {
    entities: CodeEntityRecord[];
    relationships: CodeRelationshipRecord[];
  };
  readonly repositoryIntelligence?: RepositoryIntelligenceSnapshot;
  readonly sourceAccess: SourceAccess;
  readonly analyzerConfig: Record<string, unknown>;
  readonly resourceBudget: ResourceBudget;

  constructor(options: AnalyzerContextOptions) {
    this.organizationId = options.organizationId;
    this.repositoryId = options.repositoryId;
    this.commitId = options.commitId;
    this.analysisRunId = options.analysisRunId;
    this.analysisProfileId = options.analysisProfileId;
    this.analysisScope = options.analysisScope;
    this.codeIR = options.codeIR;
    this.repositoryIntelligence = options.repositoryIntelligence;
    this.sourceAccess = options.sourceAccess;
    this.analyzerConfig = options.analyzerConfig ?? {};
    this.resourceBudget = {
      maxFiles: options.resourceBudget?.maxFiles ?? Number.MAX_SAFE_INTEGER,
      maxEntities: options.resourceBudget?.maxEntities ?? Number.MAX_SAFE_INTEGER,
      maxDurationMs: options.resourceBudget?.maxDurationMs ?? Number.MAX_SAFE_INTEGER,
    };
  }

  getEntitiesForScope(): CodeEntityRecord[] {
    const mode = this.analysisScope.mode;
    const entities = this.codeIR?.entities ?? this.repositoryIntelligence?.entities ?? [];

    if (mode === 'FULL') {
      return entities;
    }

    if (mode === 'FILE') {
      const selectedFiles = this.analysisScope.fileIds ?? [];
      if (selectedFiles.length === 0) return [];
      return entities.filter((entity) => entity.file_path && selectedFiles.includes(entity.file_path));
    }

    if (mode === 'ENTITY') {
      const selectedEntities = this.analysisScope.entityIds ?? [];
      if (selectedEntities.length === 0) return [];
      return entities.filter((entity) => selectedEntities.includes(entity.id));
    }

    if (mode === 'IMPACTED') {
      const selectedEntities = this.analysisScope.entityIds ?? [];
      const selectedFiles = this.analysisScope.fileIds ?? [];
      if (selectedEntities.length > 0) {
        return entities.filter((entity) => selectedEntities.includes(entity.id));
      }
      if (selectedFiles.length > 0) {
        return entities.filter((entity) => entity.file_path && selectedFiles.includes(entity.file_path));
      }
      return [];
    }

    return entities;
  }

  getFilesForScope(): string[] {
    const files = new Set<string>();
    for (const entity of this.getEntitiesForScope()) {
      if (entity.file_path) {
        files.add(entity.file_path);
      }
    }
    return Array.from(files);
  }
}
