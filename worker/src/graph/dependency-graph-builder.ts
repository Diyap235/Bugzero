import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';

import {
  codeGraphEntityId,
  codeGraphRelationshipId,
  type CodeGraphScope,
} from './code-graph.repository.js';

export interface DependencySourceFile {
  path: string;
  content: string;
}

export interface DependencyGraphBuildResult {
  entities: CodeEntityRecord[];
  relationships: CodeRelationshipRecord[];
  diagnostics: string[];
  budgetExceeded: boolean;
}

interface DependencyDeclaration {
  packageManager: 'npm' | 'pip';
  packageName: string;
  versionRange: string | null;
  versionConstraints: Array<string | null>;
  extras: string[];
  group: string;
}

const LOCKFILE_NAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'pipfile.lock']);
const UNSUPPORTED_MANIFEST_NAMES = new Set(['pyproject.toml', 'pipfile']);

function packageJsonDependencies(content: string, filePath: string): {
  declarations: DependencyDeclaration[];
  diagnostics: string[];
} {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    return {
      declarations: [],
      diagnostics: [`${filePath}: invalid package.json: ${error instanceof Error ? error.message : 'invalid JSON'}`],
    };
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return { declarations: [], diagnostics: [`${filePath}: package.json must contain a JSON object`] };
  }

  const declarations: DependencyDeclaration[] = [];
  const diagnostics: string[] = [];
  const groups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
  for (const group of groups) {
    const section = (manifest as Record<string, unknown>)[group];
    if (section === undefined) continue;
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      diagnostics.push(`${filePath}: package.json ${group} must be an object`);
      continue;
    }
    for (const [packageName, versionRange] of Object.entries(section)) {
      if (!packageName.trim() || typeof versionRange !== 'string' || !versionRange.trim()) {
        diagnostics.push(`${filePath}: ignored invalid ${group} declaration for ${packageName || '(empty name)'}`);
        continue;
      }
      declarations.push({
        packageManager: 'npm',
        packageName,
        versionRange,
        versionConstraints: [versionRange],
        extras: [],
        group,
      });
    }
  }
  return { declarations, diagnostics };
}

function requirementsDependencies(content: string, filePath: string): {
  declarations: DependencyDeclaration[];
  diagnostics: string[];
} {
  const declarations: DependencyDeclaration[] = [];
  const diagnostics: string[] = [];
  for (const [index, rawLine] of content.split(/\r\n|\r|\n/).entries()) {
    const line = rawLine.split('#', 1)[0]?.trim() ?? '';
    if (!line) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]+)\])?\s*(.*)$/.exec(line);
    const versionRange = match?.[3]?.trim() ?? '';
    if (!match || (versionRange !== '' && !/^(?:===|==|~=|!=|<=|>=|<|>)/.test(versionRange))) {
      diagnostics.push(`${filePath}:${index + 1}: unsupported requirements entry was not added to the dependency graph`);
      continue;
    }
    declarations.push({
      packageManager: 'pip',
      packageName: match[1]!,
      versionRange: versionRange || null,
      versionConstraints: [versionRange || null],
      extras: match[2]?.split(',').map((extra) => extra.trim()).filter(Boolean) ?? [],
      group: 'requirements',
    });
  }
  return { declarations, diagnostics };
}

function deduplicateDeclarations(
  declarations: readonly DependencyDeclaration[],
  filePath: string,
  diagnostics: string[],
): DependencyDeclaration[] {
  const unique = new Map<string, DependencyDeclaration>();
  for (const declaration of declarations) {
    const packageIdentity = declaration.packageManager === 'pip'
      ? declaration.packageName.toLowerCase().replace(/[-_.]+/g, '-')
      : declaration.packageName;
    const key = JSON.stringify([declaration.packageManager, packageIdentity, declaration.group]);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, {
        ...declaration,
        versionConstraints: [...declaration.versionConstraints],
        extras: [...declaration.extras],
      });
      continue;
    }

    const constraints = [...new Set([...existing.versionConstraints, ...declaration.versionConstraints])];
    existing.extras = [...new Set([...existing.extras, ...declaration.extras])];
    if (constraints.length === existing.versionConstraints.length) continue;

    existing.versionConstraints = constraints;
    existing.versionRange = constraints.length === 1 ? constraints[0]! : null;
    if (constraints.length > 1) {
      diagnostics.push(`${filePath}: conflicting version constraints for ${declaration.packageName} in ${declaration.group}; all constraints were preserved without selecting a version`);
    }
  }
  return [...unique.values()];
}

export function buildDependencyGraph(
  scope: CodeGraphScope,
  sourceFiles: readonly DependencySourceFile[],
  maxEntities: number,
  existingEntityIds: ReadonlySet<string> = new Set(),
): DependencyGraphBuildResult {
  if (!Number.isSafeInteger(maxEntities) || maxEntities < 0) {
    throw new Error('Dependency graph entity budget must be a non-negative safe integer');
  }
  const entities: CodeEntityRecord[] = [];
  const relationships: CodeRelationshipRecord[] = [];
  const diagnostics: string[] = [];
  const processedManifestPaths = new Set<string>();
  const knownEntityIds = new Set(existingEntityIds);
  const createdAt = new Date().toISOString();
  let budgetExceeded = false;

  for (const file of sourceFiles) {
    const filePath = file.path.replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!filePath || filePath.startsWith('/') || filePath.split('/').includes('..')) {
      diagnostics.push(`${file.path}: invalid repository-relative dependency manifest path`);
      continue;
    }
    const lowerPath = filePath.toLowerCase();
    const fileName = lowerPath.split('/').at(-1) ?? '';
    if (LOCKFILE_NAMES.has(fileName)) {
      diagnostics.push(`${filePath}: lockfile-resolved and transitive dependencies are not yet modeled`);
      continue;
    }
    if (UNSUPPORTED_MANIFEST_NAMES.has(fileName)) {
      diagnostics.push(`${filePath}: dependency manifest format is not supported and was not modeled`);
      continue;
    }
    const isPackageJson = lowerPath.endsWith('/package.json') || lowerPath === 'package.json';
    const isRequirements = /(?:^|\/)requirements(?:-[^/]+)?\.txt$/.test(lowerPath);
    if (!isPackageJson && !isRequirements) continue;
    if (processedManifestPaths.has(filePath)) {
      diagnostics.push(`${filePath}: duplicate dependency manifest path was ignored`);
      continue;
    }
    processedManifestPaths.add(filePath);

    const parsed = isPackageJson
      ? packageJsonDependencies(file.content, filePath)
      : requirementsDependencies(file.content, filePath);
    diagnostics.push(...parsed.diagnostics);
    const declarations = deduplicateDeclarations(parsed.declarations, filePath, diagnostics);
    const manifestEntityId = codeGraphEntityId(scope, `file:${filePath}`);
    if (!knownEntityIds.has(manifestEntityId)) {
      if (entities.length >= maxEntities) {
        budgetExceeded = true;
        diagnostics.push(`Exceeded maxEntities budget (${maxEntities}); remaining dependency declarations were skipped`);
        break;
      }
      entities.push({
        id: manifestEntityId,
        organization_id: scope.organizationId,
        repository_id: scope.repositoryId,
        commit_id: scope.commitId,
        analysis_run_id: scope.analysisRunId,
        entity_key: `file:${filePath}`,
        entity_type: 'FILE',
        name: filePath.split('/').at(-1) ?? filePath,
        qualified_name: filePath,
        file_path: filePath,
        start_line: 1,
        end_line: file.content.split(/\r\n|\r|\n/).length,
        provenance: { parserVersion: 'dependency-manifest-v1', manifestType: isPackageJson ? 'package.json' : 'requirements.txt' },
        created_at: createdAt,
      });
      knownEntityIds.add(manifestEntityId);
    }

    for (const declaration of declarations) {
      if (entities.length >= maxEntities) {
        budgetExceeded = true;
        diagnostics.push(`Exceeded maxEntities budget (${maxEntities}); remaining dependency declarations were skipped`);
        break;
      }
      const entityKey = `dependency:${filePath}:${declaration.group}:${declaration.packageName}`;
      const dependencyEntityId = codeGraphEntityId(scope, entityKey);
      entities.push({
        id: dependencyEntityId,
        organization_id: scope.organizationId,
        repository_id: scope.repositoryId,
        commit_id: scope.commitId,
        analysis_run_id: scope.analysisRunId,
        entity_key: entityKey,
        entity_type: 'DEPENDENCY',
        name: declaration.packageName,
        qualified_name: `${declaration.packageManager}:${declaration.packageName}${declaration.versionRange ? `@${declaration.versionRange}` : ''}`,
        file_path: filePath,
        start_line: null,
        end_line: null,
        provenance: {
          packageManager: declaration.packageManager,
          versionRange: declaration.versionRange,
          versionConstraints: declaration.versionConstraints,
          extras: declaration.extras,
          dependencyGroup: declaration.group,
          direct: true,
        },
        created_at: createdAt,
      });
      relationships.push({
        id: codeGraphRelationshipId(scope, manifestEntityId, `DEPENDS_ON:${declaration.group}`, dependencyEntityId),
        organization_id: scope.organizationId,
        repository_id: scope.repositoryId,
        commit_id: scope.commitId,
        analysis_run_id: scope.analysisRunId,
        source_entity_id: manifestEntityId,
        target_entity_id: dependencyEntityId,
        relation: 'DEPENDS_ON',
        resolution: 'UNKNOWN',
        confidence: null,
        provenance: {
          manifestPath: filePath,
          dependencyGroup: declaration.group,
          versionRange: declaration.versionRange,
          versionConstraints: declaration.versionConstraints,
          extras: declaration.extras,
          direct: true,
        },
        created_at: createdAt,
      });
    }
    if (budgetExceeded) break;
  }

  return { entities, relationships, diagnostics, budgetExceeded };
}
