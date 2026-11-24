export interface DependencyRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  package_manager: string;
  package_name: string;
  version: string | null;
  manifest_path: string;
  direct: boolean;
  created_at: string;
}

export interface DependencyEdgeRecord {
  id: string;
  organization_id: string;
  repository_id: string;
  commit_id: string;
  from_dependency_id: string;
  to_dependency_id: string;
  relationship: 'DEPENDS_ON' | 'OPTIONAL_DEPENDENCY' | 'PEER_DEPENDENCY';
  resolution: 'EXACT' | 'INFERRED' | 'POSSIBLE' | 'UNKNOWN';
  created_at: string;
}
