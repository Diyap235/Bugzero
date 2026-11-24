export type CodeEntityType =
  | 'REPOSITORY'
  | 'FILE'
  | 'MODULE'
  | 'CLASS'
  | 'FUNCTION'
  | 'METHOD'
  | 'SYMBOL'
  | 'PARAMETER'
  | 'TYPE'
  | 'CONSTANT'
  | 'DEPENDENCY';

export interface CodeEntityRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id?: string;
  entity_key: string;
  entity_type: CodeEntityType;
  name: string;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  provenance: Record<string, unknown>;
  created_at: string;
}

export interface CodeRelationshipRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  analysis_run_id?: string;
  source_entity_id: string;
  target_entity_id: string;
  relation:
    | 'IMPORTS'
    | 'DECLARES'
    | 'CALLS'
    | 'REFERENCES'
    | 'READS'
    | 'WRITES'
    | 'RETURNS'
    | 'PASSES_ARGUMENT'
    | 'INHERITS'
    | 'IMPLEMENTS'
    | 'OVERRIDES'
    | 'DEPENDS_ON'
    | 'DATA_FLOWS_TO';
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  provenance: Record<string, unknown>;
  created_at: string;
}
