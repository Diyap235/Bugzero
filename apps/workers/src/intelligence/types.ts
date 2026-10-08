import type { CodeEntityRecord, CodeRelationshipRecord, DependencyRecord, DependencyEdgeRecord } from '@bugzero/database';

export type RepositoryIntelligenceStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED';

export interface RepositoryIntelligenceSnapshot {
  organizationId: string;
  repositoryId: string;
  commitId: string;
  status: RepositoryIntelligenceStatus;
  entities: CodeEntityRecord[];
  relationships: CodeRelationshipRecord[];
  dependencies: DependencyRecord[];
  dependencyEdges: DependencyEdgeRecord[];
  entityIndex: Map<string, CodeEntityRecord>;
  outgoingRelationships: Map<string, CodeRelationshipRecord[]>;
  incomingRelationships: Map<string, CodeRelationshipRecord[]>;
  createdAt: string;
  irVersion: string;
}

export interface RepositoryIntelligenceBuildOptions {
  irVersion?: string;
  maxEntityCount?: number;
}

export interface DependencyRelationship {
  dependencyId: string;
  packageName: string;
  relationship: 'DIRECT' | 'TRANSITIVE';
  direct: boolean;
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
}
