import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type {
  CodeEntityRecord,
  CodeRelationshipRecord,
  CreateFindingInput,
  CreateFindingOccurrenceInput,
  CreateOrGetResult,
  Finding,
  FindingOccurrence,
} from '@bugzero/database';
import { EvidenceRepository } from '@bugzero/database';

import { AnalyzerContext } from '../src/analyzers/analyzer-context.js';
import { AnalyzerOrchestrator } from '../src/analyzers/analyzer-orchestrator.js';
import { AnalyzerRegistry } from '../src/analyzers/analyzer-registry.js';
import { InMemorySourceAccess } from '../src/analyzers/source-access.js';
import { resolveRelativeImportPath, sqlInjectionAnalyzer } from '../src/analyzers/security/sql-injection-analyzer.js';
import { sqlInjectionRule, sqlInjectionSourcePatterns, sqlInjectionSinkPatterns } from '../src/analyzers/security/rules/sql-injection.js';
import type { AnalyzerContext as AnalyzerContextType } from '../src/analyzers/analyzer-context.js';
import type { RepositoryIntelligenceSnapshot } from '../src/intelligence/types.js';
import { MemoryEvidenceRepository } from './support/memory-evidence.js';
import { MemoryRiskAssessmentRepository } from './support/memory-risk-assessments.js';
import { parseWithLanguageAdapter, normalizeLanguage } from '../src/parser/language-adapters.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const repositoryId = '22222222-2222-4222-8222-222222222222';
const commitId = '33333333-3333-4333-8333-333333333333';

interface Fixture {
  context: AnalyzerContextType;
  intelligence: RepositoryIntelligenceSnapshot;
}

function makeFixture(
  source: string,
  filePath = 'src/app.ts',
  dropCalls = false,
  resourceBudget?: { maxFiles: number; maxEntities: number; maxDurationMs: number },
  fixtureCommitId = commitId,
): Fixture {
  const language = normalizeLanguage(filePath.endsWith('.py') ? 'Python' : filePath.endsWith('.js') ? 'JavaScript' : 'TypeScript');
  const parsed = parseWithLanguageAdapter({
    repositoryId,
    commitId: fixtureCommitId,
    filePath,
    language,
    contentHash: 'fixture-hash',
    sourceContent: source,
  });
  const entities: CodeEntityRecord[] = parsed.entities.map((entity) => ({
    id: entity.id,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: fixtureCommitId,
    entity_key: entity.id,
    entity_type: entity.kind === 'VARIABLE' ? 'SYMBOL'
      : entity.kind === 'INTERFACE' ? 'TYPE'
        : entity.kind === 'NAMESPACE' ? 'MODULE'
          : entity.kind,
    name: entity.name,
    qualified_name: entity.qualifiedName,
    file_path: entity.filePath,
    start_line: entity.startLine,
    end_line: entity.endLine,
    provenance: entity.provenance,
    created_at: '',
  }));
  const relationships: CodeRelationshipRecord[] = parsed.relationships
    .filter((relationship) => !dropCalls || relationship.kind !== 'CALLS')
    .map((relationship) => ({
      id: relationship.id,
      organization_id: organizationId,
      repository_id: repositoryId,
      commit_id: fixtureCommitId,
      source_entity_id: relationship.sourceEntityId,
      target_entity_id: relationship.targetEntityId,
      relation: relationship.kind,
      resolution: relationship.resolution,
      confidence: 'HIGH',
      provenance: relationship.provenance,
      created_at: '',
    }));
  const entityIndex = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoingRelationships = new Map<string, CodeRelationshipRecord[]>();
  const incomingRelationships = new Map<string, CodeRelationshipRecord[]>();
  for (const relationship of relationships) {
    outgoingRelationships.set(relationship.source_entity_id, [
      ...(outgoingRelationships.get(relationship.source_entity_id) ?? []),
      relationship,
    ]);
    incomingRelationships.set(relationship.target_entity_id, [
      ...(incomingRelationships.get(relationship.target_entity_id) ?? []),
      relationship,
    ]);
  }
  const intelligence: RepositoryIntelligenceSnapshot = {
    organizationId,
    repositoryId,
    commitId: fixtureCommitId,
    status: 'COMPLETE',
    entities,
    relationships,
    dependencies: [],
    dependencyRelationships: [],
    dependencyEdges: [],
    entityIndex,
    outgoingRelationships,
    incomingRelationships,
    createdAt: '',
    irVersion: parsed.irVersion,
  };
  const sourceAccess = new InMemorySourceAccess(new Map([[filePath, source]]));
  return {
    intelligence,
    context: new AnalyzerContext({
      organizationId,
      repositoryId,
      commitId,
      analysisRunId: '44444444-4444-4444-8444-444444444444',
      analysisProfileId: 'profile-1',
      analysisScope: { mode: 'FULL' },
      codeIR: { entities, relationships },
      repositoryIntelligence: intelligence,
      sourceAccess,
      resourceBudget,
    }),
  };
}

function makeMultiFileFixture(sources: Record<string, string>): Fixture {
  const parsedFiles = Object.entries(sources).map(([filePath, sourceContent]) => {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const language = normalizeLanguage(extension === 'py' ? 'Python'
      : extension === 'js' || extension === 'jsx' ? 'JavaScript' : 'TypeScript');
    return {
      filePath,
      sourceContent,
      parsed: parseWithLanguageAdapter({
        repositoryId,
        commitId,
        filePath,
        language,
        contentHash: `fixture:${filePath}`,
        sourceContent,
      }),
    };
  });
  const entities: CodeEntityRecord[] = parsedFiles.flatMap(({ parsed }) => parsed.entities.map((entity) => ({
    id: entity.id,
    organization_id: organizationId,
    repository_id: repositoryId,
    commit_id: commitId,
    entity_key: entity.id,
    entity_type: entity.kind === 'VARIABLE' ? 'SYMBOL'
      : entity.kind === 'INTERFACE' ? 'TYPE'
        : entity.kind === 'NAMESPACE' ? 'MODULE'
          : entity.kind,
    name: entity.name,
    qualified_name: entity.qualifiedName,
    file_path: entity.filePath,
    start_line: entity.startLine,
    end_line: entity.endLine,
    provenance: entity.provenance,
    created_at: '',
  })));
  const relationships: CodeRelationshipRecord[] = parsedFiles.flatMap(({ parsed }) =>
    parsed.relationships.map((relationship) => ({
      id: relationship.id,
      organization_id: organizationId,
      repository_id: repositoryId,
      commit_id: commitId,
      source_entity_id: relationship.sourceEntityId,
      target_entity_id: relationship.targetEntityId,
      relation: relationship.kind,
      resolution: relationship.resolution,
      confidence: 'HIGH',
      provenance: relationship.provenance,
      created_at: '',
    })));
  const entityIndex = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoingRelationships = new Map<string, CodeRelationshipRecord[]>();
  const incomingRelationships = new Map<string, CodeRelationshipRecord[]>();
  for (const relationship of relationships) {
    outgoingRelationships.set(relationship.source_entity_id, [
      ...(outgoingRelationships.get(relationship.source_entity_id) ?? []),
      relationship,
    ]);
    incomingRelationships.set(relationship.target_entity_id, [
      ...(incomingRelationships.get(relationship.target_entity_id) ?? []),
      relationship,
    ]);
  }
  const intelligence: RepositoryIntelligenceSnapshot = {
    organizationId,
    repositoryId,
    commitId,
    status: 'COMPLETE',
    entities,
    relationships,
    dependencies: [],
    dependencyRelationships: [],
    dependencyEdges: [],
    entityIndex,
    outgoingRelationships,
    incomingRelationships,
    createdAt: '',
    irVersion: parsedFiles[0]?.parsed.irVersion ?? 'bugzero-ir-v2',
  };
  const sourceAccess = new InMemorySourceAccess(new Map(parsedFiles.map(({ filePath, sourceContent }) => [filePath, sourceContent])));
  return {
    intelligence,
    context: new AnalyzerContext({
      organizationId,
      repositoryId,
      commitId,
      analysisRunId: '44444444-4444-4444-8444-444444444444',
      analysisProfileId: 'profile-1',
      analysisScope: { mode: 'FULL' },
      codeIR: { entities, relationships },
      repositoryIntelligence: intelligence,
      sourceAccess,
    }),
  };
}

class MemoryFindings {
  readonly findings = new Map<string, Finding>();
  readonly occurrences = new Map<string, FindingOccurrence>();

  async createOrGet(input: CreateFindingInput): Promise<CreateOrGetResult<Finding>> {
    const key = `${input.organizationId}|${input.repositoryId}|${input.ruleId}|${input.identityFingerprint}`;
    const existing = this.findings.get(key);
    if (existing) return { record: existing, created: false };
    const record: Finding = {
      id: `finding-${this.findings.size + 1}`,
      organization_id: input.organizationId,
      repository_id: input.repositoryId,
      rule_id: input.ruleId,
      identity_fingerprint: input.identityFingerprint,
      identity_version: input.identityVersion,
      lifecycle: 'OPEN',
      current_occurrence_id: null,
      resolution_evidence_id: null,
      current_severity: input.currentSeverity,
      current_confidence: input.currentConfidence,
      current_risk: input.currentRisk,
      last_seen_commit_id: input.lastSeenCommitId ?? null,
      business_priority: null,
      accepted_risk: false,
      exception_id: null,
      disposition_reason: null,
      created_at: '',
      updated_at: '',
    };
    this.findings.set(key, record);
    return { record, created: true };
  }

  async createOccurrenceIfAbsent(input: CreateFindingOccurrenceInput): Promise<CreateOrGetResult<FindingOccurrence>> {
    const key = `${input.organizationId}|${input.findingId}|${input.commitId}|${input.normalizedFingerprint}`;
    const existing = this.occurrences.get(key);
    if (existing) return { record: existing, created: false };
    const record: FindingOccurrence = {
      id: `occurrence-${this.occurrences.size + 1}`,
      organization_id: input.organizationId,
      finding_id: input.findingId,
      repository_id: input.repositoryId,
      commit_id: input.commitId,
      analysis_run_id: input.analysisRunId,
      rule_id: input.ruleId,
      semantic_target_id: input.semanticTargetId,
      normalized_fingerprint: input.normalizedFingerprint,
      relationship_fingerprint: input.relationshipFingerprint ?? null,
      file_path: input.filePath ?? null,
      start_line: input.startLine ?? null,
      end_line: input.endLine ?? null,
      observation: input.observation,
      severity: input.severity,
      confidence: input.confidence,
      evidence_strength: input.evidenceStrength,
      exploitability: input.exploitability,
      reachability: input.reachability,
      technical_risk: input.technicalRisk,
      resolution: input.resolution,
      match_result: input.matchResult,
      created_at: '',
    };
    this.occurrences.set(key, record);
    return { record, created: true };
  }

  async updateCurrentRisk(_organizationId: string, findingId: string, currentRisk: number): Promise<void> {
    const finding = [...this.findings.values()].find((item) => item.id === findingId);
    if (!finding) throw new Error('Finding not found');
    finding.current_risk = currentRisk;
  }
}

async function run(
  source: string,
  filePath?: string,
  dropCalls = false,
  resourceBudget?: { maxFiles: number; maxEntities: number; maxDurationMs: number },
) {
  const fixture = makeFixture(source, filePath, dropCalls, resourceBudget);
  const result = await sqlInjectionAnalyzer.analyze(fixture.context);
  return { ...fixture, result };
}

async function runFiles(sources: Record<string, string>) {
  const fixture = makeMultiFileFixture(sources);
  const result = await sqlInjectionAnalyzer.analyze(fixture.context);
  return { ...fixture, result };
}

function addScopedFile(fixture: Fixture, filePath: string): AnalyzerContext {
  const template = fixture.intelligence.entities[0];
  if (!template) throw new Error('Fixture must contain at least one entity');
  const entity: CodeEntityRecord = {
    ...template,
    id: `synthetic:${filePath}`,
    entity_key: `synthetic:${filePath}`,
    entity_type: 'MODULE',
    name: filePath,
    qualified_name: filePath,
    file_path: filePath,
    start_line: 1,
    end_line: 1,
  };
  const entities = [...fixture.intelligence.entities, entity];
  const intelligence = {
    ...fixture.intelligence,
    entities,
    entityIndex: new Map(entities.map((item) => [item.id, item])),
  };
  return new AnalyzerContext({
    organizationId: fixture.context.organizationId,
    repositoryId: fixture.context.repositoryId,
    commitId: fixture.context.commitId,
    analysisRunId: fixture.context.analysisRunId,
    analysisProfileId: fixture.context.analysisProfileId,
    analysisScope: fixture.context.analysisScope,
    codeIR: {
      entities,
      relationships: fixture.context.codeIR?.relationships ?? [],
    },
    repositoryIntelligence: intelligence,
    sourceAccess: fixture.context.sourceAccess,
    analyzerConfig: fixture.context.analyzerConfig,
    resourceBudget: fixture.context.resourceBudget,
  });
}

test('security rule registry exposes explicit SQL sources and sinks', () => {
  assert.equal(sqlInjectionRule.id, 'SECURITY.SQL_INJECTION');
  assert.equal(sqlInjectionRule.version, '1.0.0');
  assert.equal(sqlInjectionRule.severity, 'HIGH');
  assert.deepEqual(sqlInjectionSourcePatterns.javascript.inputProperties, ['query', 'body', 'params']);
  assert.deepEqual(sqlInjectionSinkPatterns.receiverMethods.cursor, ['execute']);
});

test('unsupported files do not make SQL security analysis partial', async () => {
  const fixture = makeFixture('export function read() { return "ok"; }');
  const result = await sqlInjectionAnalyzer.analyze(addScopedFile(fixture, 'package.json'));
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.diagnostics, []);
});

test('missing supported source files keep SQL security analysis partial', async () => {
  const fixture = makeFixture('export function read() { return "ok"; }');
  const result = await sqlInjectionAnalyzer.analyze(addScopedFile(fixture, 'src/missing.ts'));
  assert.equal(result.status, 'PARTIAL');
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes('source is unavailable')));
});

test('resolves supported relative import extensions and index files within the snapshot', () => {
  const cases = [
    ['./foo', ['src/foo.ts'], 'src/foo.ts'],
    ['./foo.ts', ['src/foo.ts'], 'src/foo.ts'],
    ['./foo.tsx', ['src/foo.tsx'], 'src/foo.tsx'],
    ['./foo.js', ['src/foo.js'], 'src/foo.js'],
    ['./foo.jsx', ['src/foo.jsx'], 'src/foo.jsx'],
    ['./foo', ['src/foo/index.ts'], 'src/foo/index.ts'],
    ['./foo', ['src/foo/index.js'], 'src/foo/index.js'],
    ['../shared/foo', ['shared/foo.js'], 'shared/foo.js'],
  ] as const;
  for (const [specifier, availableFiles, expected] of cases) {
    assert.equal(resolveRelativeImportPath('src/index.ts', specifier, availableFiles), expected);
  }
  assert.equal(resolveRelativeImportPath('src/index.ts', '../../../outside.ts', ['outside.ts']), null);
  assert.equal(resolveRelativeImportPath('src/index.ts', 'typescript', ['src/typescript.ts']), null);
});

test('finds SQL injection through local assignment with a complete authoritative taint path', async () => {
  const { result } = await run(`
function handler(req) {
  const sourceId = req.query.id;
  const id = sourceId;
  const sql = "SELECT * FROM users WHERE id=" + id;
  db.query(sql);
}`);
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.ok(finding);
  assert.equal(finding.ruleId, 'SECURITY.SQL_INJECTION');
  assert.equal(finding.severity, 'HIGH');
  assert.equal(finding.category, 'SECURITY');
  assert.equal(finding.evidenceGraph?.completeness, 'COMPLETE');
  assert.equal(finding.evidenceGraph?.sufficiency, 'SUFFICIENT');
  assert.ok(finding.evidenceGraph?.nodes.some((node) => node.nodeType === 'SOURCE'));
  assert.ok(finding.evidenceGraph?.nodes.some((node) => node.nodeType === 'SINK'));
  assert.ok((finding.evidenceGraph?.edges.length ?? 0) >= 3);
  assert.ok(finding.evidenceGraph?.paths[0]?.nodeIds.length);
  assert.ok(finding.evidenceGraph?.nodes.every((node) => node.attributes.provenance === 'SECURITY_ANALYZER'));
});

test('recognizes SQL statements after leading comments when building dynamic queries', async () => {
  const { result } = await run(`
function handler(req) {
  const id = req.query.id;
  const sql = "/* user lookup */ SELECT * FROM users WHERE id=" + id;
  db.query(sql);
}`);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
});

test('marks unresolved SQL variables partial instead of treating them as safe', async () => {
  const { result } = await run(`
function handler() {
  return db.query(sql);
}`);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.includes('UNRESOLVED_SOURCE')));

  const unknownCall = await run(`
function handler() {
  const id = readInput();
  return db.query("SELECT * FROM users WHERE id=" + id);
}`);
  assert.equal(unknownCall.result.status, 'PARTIAL');
  assert.equal(unknownCall.result.findings.length, 0);
  assert.ok(unknownCall.result.diagnostics.some((diagnostic) =>
    diagnostic.includes('UNRESOLVED_SOURCE')));
});

test('preserves string-conversion taint and unknown helper uncertainty', async () => {
  const converted = await run(`
function handler(req) {
  const id = String(req.query.id);
  return db.query("SELECT * FROM users WHERE id=" + id);
}`);
  assert.equal(converted.result.status, 'COMPLETED');
  assert.equal(converted.result.findings.length, 1);

  const unknownSource = await run(`
function handler(ctx) {
  return db.query(buildQuery(ctx.request.body.id));
}`);
  assert.equal(unknownSource.result.status, 'PARTIAL');
  assert.equal(unknownSource.result.findings.length, 0);
  assert.ok(unknownSource.result.diagnostics.some((diagnostic) =>
    diagnostic.includes('UNRESOLVED_SOURCE')));

  const taggedQuery = await run(`
function handler(req) {
  prisma.$queryRaw\`SELECT * FROM users WHERE id=\${req.query.id}\`;
}`);
  assert.equal(taggedQuery.result.status, 'PARTIAL');
  assert.equal(taggedQuery.result.findings.length, 0);
  assert.match(taggedQuery.result.diagnostics.join(' '), /unsupported expression/i);
});

test('preserves request taint through nullish and logical fallback expressions', async () => {
  const nullishFallback = await run(`
function handler(req) {
  const id = req.query.id ?? "";
  return db.query("SELECT * FROM users WHERE id = " + id);
}`);
  assert.equal(nullishFallback.result.findings.length, 1);
  assert.equal(nullishFallback.result.status, 'COMPLETED');
  assert.ok(nullishFallback.result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'req.query.id'));

  const logicalFallback = await run(`
function handler(req) {
  const id = req.query.id || "";
  return db.query("SELECT * FROM users WHERE id = " + id);
}`, 'src/app.js');
  assert.equal(logicalFallback.result.findings.length, 1);
  assert.equal(logicalFallback.result.status, 'COMPLETED');
  assert.ok(logicalFallback.result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'req.query.id'));
});

test('preserves request taint through four TypeScript and JavaScript fallback forms', async () => {
  const cases = [
    {
      filePath: 'src/nullish.ts',
      source: `function handler(req) {
  const id = req.query.id ?? "";
  return db.query("SELECT * FROM users WHERE id=" + id);
}`,
    },
    {
      filePath: 'src/or.ts',
      source: `function handler(request) {
  const id = request.body.id || "default";
  return db.query("SELECT * FROM users WHERE id=" + id);
}`,
    },
    {
      filePath: 'src/nullish.js',
      source: `function handler(req) {
  const id = req.params.id ?? req.query.id;
  return db.query("SELECT * FROM users WHERE id=" + id);
}`,
    },
    {
      filePath: 'src/or.js',
      source: `function handler(request) {
  const id = request.query.id || request.body.id;
  return db.query("SELECT * FROM users WHERE id=" + id);
}`,
    },
  ];

  for (const fixture of cases) {
    const { result } = await run(fixture.source, fixture.filePath);
    assert.equal(result.status, 'COMPLETED', fixture.filePath);
    assert.equal(result.findings.length, 1, fixture.filePath);
    assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) => node.nodeType === 'SOURCE'), fixture.filePath);
  }
});

test('preserves taint from either branch of a conditional SQL expression', async () => {
  const { result } = await run(`
function handler(req, flag) {
  const query = flag
    ? "SELECT 1"
    : "SELECT * FROM users WHERE id = " + req.query.id;
  return db.query(query);
}`);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'req.query.id'));
});

test('keeps dynamic SQL with unproven function-parameter sources explicitly partial', async () => {
  const { result } = await run(`
type Db = { query: (sql: string) => unknown };
export function findByName(db: Db, name: string, tenant: string) {
  const sql = "SELECT * FROM users WHERE name = '" + name + "' AND tenant = '" + tenant + "'";
  return db.query(sql);
}`);
  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'PARTIAL');
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes('UNRESOLVED_SOURCE')));
});

test('propagates taint through a relative named import to a real SQL sink', async () => {
  const { result } = await runFiles({
    'src/index.ts': `import { getUser } from './database';

export function handleRequest(req: any) {
  return getUser(req.query.id);
}`,
    'src/database.ts': `export function getUser(userId: string) {
  const query = \`SELECT * FROM users WHERE id = \${userId}\`;
  return db.query(query);
}`,
  });
  assert.equal(result.status, 'COMPLETED', result.diagnostics.join(' | '));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');
  assert.equal(result.findings[0]?.evidenceGraph?.sufficiency, 'SUFFICIENT');
  assert.equal(result.findings[0]?.evidenceGraph?.completeness, 'COMPLETE');
  assert.ok(result.findings[0]?.evidenceGraph?.edges.some((edge) => edge.relation === 'PASSES_ARGUMENT'));
});

test('proves taint through static CommonJS requires, exports, SQL construction, and db.query', async () => {
  const { result } = await runFiles({
    'src/index.js': `const { getUser } = require("./database");
const { runReport } = require("./reports");

function main(req) {
  const userId = req.query.userId;
  const user = getUser(userId);
  const report = req.query.report;
  const result = runReport(report);
  return { user, result };
}

module.exports = { main };`,
    'src/database.js': `function executeQuery(db, query) {
  return db.query(query);
}

function getUser(userId) {
  const query = "SELECT * FROM users WHERE id = " + userId;
  return executeQuery(global.db, query);
}

module.exports = { getUser };`,
    'src/reports.js': `const { exec } = require("child_process");

function runReport(reportName) {
  return exec("generate-report " + reportName);
}

module.exports = { runReport };`,
    'src/utils.js': `function formatUser(user) {
  if (!user) return "Unknown user";
  return \`\${user.id}: \${user.name}\`;
}

module.exports = { formatUser };`,
  });
  assert.equal(result.status, 'COMPLETED', result.diagnostics.join(' | '));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');
  assert.equal(result.findings[0]?.confidence, 'HIGH');
  assert.equal(result.findings[0]?.evidenceGraph?.completeness, 'COMPLETE');
  assert.equal(result.findings[0]?.evidenceGraph?.sufficiency, 'SUFFICIENT');
  const evidence = result.findings[0]?.evidenceGraph;
  assert.ok(evidence);
  assert.ok(evidence.nodes.some((node) => node.nodeType === 'SOURCE' && node.label === 'req.query.userId'));
  assert.ok(evidence.nodes.some((node) => node.nodeType === 'TRANSFORMATION' && node.label === 'Dynamic SQL construction'));
  assert.ok(evidence.nodes.some((node) => node.nodeType === 'SINK' && node.label === 'db.query'));
  assert.ok(evidence.nodes.every((node) => node.attributes.authority === 'AUTHORITATIVE'));
  assert.ok(evidence.edges.every((edge) => edge.resolution === 'EXACT'));
  assert.ok(evidence.edges.some((edge) => edge.relation === 'PASSES_ARGUMENT'));
  assert.ok(evidence.edges.some((edge) => edge.relation === 'REACHES_SQL_SINK'));
  assert.doesNotMatch(result.diagnostics.join(' '), /UNRESOLVED_REFERENCE/);
});

test('resolves the uploaded TEST flow but does not treat a non-sink helper as SQL Injection', async () => {
  const { result } = await runFiles({
    'src/index.ts': `import { getUser } from './database';

export function handleRequest(req: any) {
  const userId = req.query.id;
  return getUser(userId);
}`,
    'src/database.ts': `export function getUser(userId: string) {
  const query = \`SELECT * FROM users WHERE id = \${userId}\`;
  return executeQuery(query);
}

function executeQuery(query: string) {
  return { query };
}`,
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.some((finding) => finding.ruleId === 'SECURITY.SQL_INJECTION'), false);
  assert.doesNotMatch(result.diagnostics.join(' '), /unresolved call/i);
});

test('an unresolved non-SQL flow does not make the analyzer partial, but unresolved SQL flow does', async () => {
  const unrelatedFlow = await runFiles({
    'src/index.ts': `import { missing } from './missing';

export function handleRequest(req: any) {
  return missing(req.query.id);
}`,
  });
  assert.equal(unrelatedFlow.result.findings.length, 0);
  assert.equal(unrelatedFlow.result.status, 'COMPLETED');

  const unresolvedSqlFlow = await runFiles({
    'src/index.ts': `import { missing } from './missing';

export function handleRequest(req: any) {
  return db.query("SELECT * FROM users WHERE id=" + missing(req.query.id));
}`,
  });
  assert.equal(unresolvedSqlFlow.result.findings.length, 0);
  assert.equal(unresolvedSqlFlow.result.status, 'PARTIAL');
  assert.match(unresolvedSqlFlow.result.diagnostics.join(' '), /UNRESOLVED_REFERENCE/i);

  const untainted = await runFiles({
    'src/index.ts': `import { missing } from './missing';

export function handleRequest() {
  return missing('static');
}`,
  });
  assert.equal(untainted.result.findings.length, 0);
  assert.equal(untainted.result.status, 'COMPLETED');
});

test('propagates taint through exact call, parameter, and return relationships', async () => {
  const { result } = await run(`
function buildQuery(id) {
  return \`SELECT * FROM users WHERE id=\${id}\`;
}

function handler(req) {
  return db.query(buildQuery(req.query.id));
}`);
  assert.equal(result.findings.length, 1);
  const graph = result.findings[0]?.evidenceGraph;
  assert.ok(graph);
  assert.equal(graph.edges.every((edge) => edge.resolution === 'EXACT'), true);
  assert.ok(graph.edges.some((edge) => edge.relation === 'PASSES_ARGUMENT'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'RETURNS'));
  assert.ok(graph.edges.some((edge) => edge.relation === 'REACHES_SQL_SINK'));
});

test('does not report parameterized, static, or non-tainted SQL', async () => {
  const fixtures = [
    `function handler(req) {
  const id = req.query.id;
  db.query("SELECT * FROM users WHERE id = ?", [id]);
}`,
    `function handler() {
  const sql = "SELECT * FROM users WHERE id=1";
  db.query(sql);
}`,
    `function handler() {
  const id = 42;
  db.query("SELECT * FROM users WHERE id=" + id);
}`,
  ];
  for (const source of fixtures) {
    const { result } = await run(source);
    assert.equal(result.findings.length, 0);
  }
});

test('parameterized SQL placeholders stay safe while a dynamic query in the same handler is reported', async () => {
  const { result } = await run(`
function handler(req) {
  const id = req.query.id;
  db.query("SELECT * FROM users WHERE id = $1", [id]);
  db.execute("SELECT * FROM users WHERE id = ?", [id]);
  connection.query("SELECT * FROM users WHERE id = :id", { id });
  db.query("SELECT * FROM users WHERE id = " + id);
}`);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SINK' && node.label === 'db.query'));
});

test('detects untrusted dynamic table and ORDER BY identifiers in supported languages', async () => {
  const concatenatedTable = await run(`
function handler(req) {
  const table = req.params.table;
  const sql = "SELECT * FROM " + table;
  db.query(sql);
}`);
  assert.equal(concatenatedTable.result.status, 'COMPLETED');
  assert.equal(concatenatedTable.result.findings.length, 1);

  const interpolatedOrderBy = await run(`
function handler(req) {
  const column = req.query.sort;
  db.query(\`SELECT * FROM users ORDER BY \${column}\`);
}`);
  assert.equal(interpolatedOrderBy.result.status, 'COMPLETED');
  assert.equal(interpolatedOrderBy.result.findings.length, 1);

  const pythonTable = await run(`def handler(request):
    table = request.args.get("table")
    query = "SELECT * FROM " + table
    cursor.execute(query)
`, 'src/app.py');
  assert.equal(pythonTable.result.status, 'COMPLETED');
  assert.equal(pythonTable.result.findings.length, 1);
});

test('finds SQL sinks inside conditional and loop bodies while marking control flow partial', async () => {
  const conditional = await run(`
function handler(req, enabled) {
  if (enabled) {
    db.query("SELECT * FROM users WHERE id=" + req.query.id);
  }
}`);
  assert.equal(conditional.result.findings.length, 1);
  assert.equal(conditional.result.status, 'PARTIAL');

  const loop = await run(`
function handler(req, enabled) {
  while (enabled) {
    pool.query("SELECT * FROM users WHERE id=" + req.query.id);
    break;
  }
}`, 'src/app.js');
  assert.equal(loop.result.findings.length, 1);
  assert.equal(loop.result.status, 'PARTIAL');

  const helperReturn = await run(`
function buildQuery(req, enabled) {
  if (enabled) {
    return "SELECT * FROM users WHERE id=" + req.query.id;
  }
  return "SELECT * FROM users";
}
function handler(req) {
  return db.query(buildQuery(req, true));
}`);
  assert.equal(helperReturn.result.findings.length, 1);
  assert.equal(helperReturn.result.status, 'PARTIAL');

  const switchFlow = await run(`
function handler(req, mode) {
  switch (mode) {
    case "user":
      db.query("SELECT * FROM users WHERE id=" + req.query.id);
      break;
    default:
      break;
  }
}`);
  assert.equal(switchFlow.result.findings.length, 1);
  assert.equal(switchFlow.result.status, 'PARTIAL');

  const tryFlow = await run(`
function handler(req) {
  try {
    db.query("SELECT * FROM users WHERE id=" + req.query.id);
  } catch (error) {
    throw error;
  }
}`);
  assert.equal(tryFlow.result.findings.length, 1);
  assert.equal(tryFlow.result.status, 'PARTIAL');
});

test('recognizes dynamic procedural and privilege SQL statements', async () => {
  const { result } = await run(`
function handler(req) {
  const procedure = req.query.procedure;
  db.query("CALL " + procedure);
}`);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');

  const privilege = await run(`
function handler(req) {
  db.query("GRANT " + req.query.privilege + " ON users TO reporting");
}`);
  assert.equal(privilege.result.findings.length, 1);
});

test('recognizes common node-postgres pool and client SQL sinks', async () => {
  const { result } = await run(`
function handler(req) {
  const id = req.query.id;
  pool.query("SELECT * FROM users WHERE id=" + id);
  client.query("SELECT * FROM users WHERE id=" + id);
}`);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((finding) => finding.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SINK' && ['pool.query', 'client.query'].includes(node.label))));
});

test('analyzes node-postgres QueryConfig text as the SQL sink input', async () => {
  const { result } = await run(`
function handler(req) {
  const id = req.query.id;
  db.query({ text: "SELECT * FROM users WHERE id=" + id, values: [] });
  const sql = "SELECT * FROM users WHERE id=" + id;
  pool.query({ text: sql, values: [] });
  const text = sql;
  pool.query({ text });
  pool.query({ text: "SELECT * FROM users WHERE id = $1", values: [id] });
}`);
  assert.equal(result.findings.length, 3);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings[0]?.evidenceGraph?.nodes.find((node) => node.nodeType === 'SINK')?.label, 'db.query');
  assert.equal(result.findings[1]?.evidenceGraph?.nodes.find((node) => node.nodeType === 'SINK')?.label, 'pool.query');
  assert.equal(result.findings[2]?.evidenceGraph?.nodes.find((node) => node.nodeType === 'SINK')?.label, 'pool.query');
});

test('TypeScript reassignment to a constant clears previously tainted data', async () => {
  const { result } = await run(`
function handler(req) {
  let id = req.query.id;
  id = "constant";
  db.query("SELECT * FROM users WHERE id = " + id);
}`);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 0);
});

test('request-object aliases retain source taint through a SQL sink', async () => {
  const { result } = await run(`
function handler(req) {
  const input = req;
  const id = input.query.id;
  db.query("SELECT * FROM users WHERE id = " + id);
}`);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'req.query.id'));
});

test('destructured request input retains source taint through a SQL sink', async () => {
  const { result } = await run(`
function handler(req) {
  const { id } = req.query;
  db.query("SELECT * FROM users WHERE id = " + id);
}`);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'req.query'));
});

test('aliased named imports preserve taint through a helper flow', async () => {
  const { result } = await runFiles({
    'src/index.ts': `import { getUser as lookup } from './database';

export function handleRequest(req: any) {
  return lookup(req.query.id);
}`,
    'src/database.ts': `export function getUser(userId: string) {
  const query = \`SELECT * FROM users WHERE id = \${userId}\`;
  return db.query(query);
}`,
  });
  assert.equal(result.status, 'COMPLETED', result.diagnostics.join(' | '));
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.edges.some((edge) =>
    edge.relation === 'PASSES_ARGUMENT'));
});

test('helper-flow evidence identifies the exact source and sink files and lines', async () => {
  const { result } = await runFiles({
    'src/index.ts': `import { getUser } from './database';

export function handleRequest(req: any) {
  return getUser(req.query.id);
}`,
    'src/database.ts': `export function getUser(userId: string) {
  const query = \`SELECT * FROM users WHERE id = \${userId}\`;
  return db.query(query);
}`,
  });
  assert.equal(result.findings.length, 1);
  const graph = result.findings[0]?.evidenceGraph;
  assert.ok(graph);
  const source = graph.nodes.find((node) => node.nodeType === 'SOURCE');
  const sink = graph.nodes.find((node) => node.nodeType === 'SINK');
  assert.ok(source);
  assert.ok(sink);
  assert.equal(source.label, 'req.query.id');
  assert.equal(source.filePath, 'src/index.ts');
  assert.equal(source.line, 4);
  assert.equal(sink.label, 'db.query');
  assert.equal(sink.filePath, 'src/database.ts');
  assert.equal(sink.line, 3);
  const path = graph.paths[0];
  assert.ok(path);
  assert.ok(path.nodeIds.indexOf(source.nodeKey) < path.nodeIds.indexOf(sink.nodeKey));
});

test('branch reassignment keeps a possible SQL injection but marks analysis partial', async () => {
  const { result } = await run(`
function handler(req) {
  let id = req.query.id;
  if (req.query.useSafeValue) {
    id = "constant";
  }
  db.query("SELECT * FROM users WHERE id = " + id);
}`);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 1);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.includes('Conditional control flow may affect SQL taint')));
});

test('does not treat a locally shadowed request-like object as a source', async () => {
  const { result } = await run(`
function handler() {
  const req = { query: { id: 123 } };
  const sql = "SELECT * FROM users WHERE id=" + req.query.id;
  db.query(sql);
}`);
  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'COMPLETED');
});

test('does not trust generic escape helpers and marks the unverified flow partial', async () => {
  const { result } = await run(`
function handler(req) {
  const sql = "SELECT * FROM users WHERE id=" + escape(req.query.id);
  db.query(sql);
}`);
  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'PARTIAL');
  assert.match(result.diagnostics.join(' '), /unresolved call/i);
});

test('supports JavaScript sinks and does not classify an arbitrary query-named function as a SQL sink', async () => {
  const positive = await run(`
function handler(request) {
  const id = request.body.id;
  database.execute("SELECT * FROM users WHERE id=" + id);
}`, 'src/app.js');
  assert.equal(positive.result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');

  const negative = await run(`
function handler(request) {
  const id = request.params.id;
  query("SELECT * FROM users WHERE id=" + id);
}`, 'src/app.js');
  assert.equal(negative.result.findings.length, 0);
});

test('does not classify ordinary query/execute calls or unsupported branch flow as vulnerabilities', async () => {
  const ordinaryCalls = await run(`
function handler(req) {
  const id = req.query.id;
  const sql = "SELECT * FROM users WHERE id=" + id;
  queue.query(sql);
  queue.execute(sql);
}`, 'src/app.js');
  assert.equal(ordinaryCalls.result.findings.length, 0);
  assert.equal(ordinaryCalls.result.status, 'PARTIAL');

  const unsupportedBranch = await run(`
function handler(req) {
  const id = req.query.id;
  if (id) {
    db.query("SELECT * FROM users WHERE id=" + id);
  }
}`);
  assert.equal(unsupportedBranch.result.findings.length, 1);
  assert.equal(unsupportedBranch.result.status, 'PARTIAL');
  assert.match(unsupportedBranch.result.diagnostics.join(' '), /conditional control flow/i);

  const unsupportedObjectProperty = await run(`
function handler(req) {
  const id = req.query.id;
  const query = { text: "SELECT * FROM users WHERE id=" + id };
  db.query(query.text);
}`);
  assert.equal(unsupportedObjectProperty.result.findings.length, 0);
  assert.equal(unsupportedObjectProperty.result.status, 'PARTIAL');
});

test('unresolved helper calls remain partial and do not create a vulnerability finding', async () => {
  const { result } = await run(`
function buildQuery(id) {
  return \`SELECT * FROM users WHERE id=\${id}\`;
}
function handler(req) {
  return db.query(buildQuery(req.query.id));
}`, undefined, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'PARTIAL');
  assert.match(result.diagnostics.join(' '), /unresolved call/i);
});

test('taint call cycles terminate and remain partial', async () => {
  const { result } = await run(`
function first(value) { return second(value); }
function second(value) { return first(value); }
function handler(req) { return db.query(first(req.query.id)); }
`);
  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'PARTIAL');
  assert.match(result.diagnostics.join(' '), /cycle|depth/i);
});

test('supports bounded Python assignment/concatenation/cursor execution patterns', async () => {
  const { result } = await run(`
def handler(request):
    user_id = request.args["id"]
    query = "SELECT * FROM users WHERE id=" + user_id
    cursor.execute(query)
`, 'src/app.py');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');
  assert.equal(result.findings[0]?.evidenceGraph?.sufficiency, 'SUFFICIENT');

  const directSink = await run(`
def handler(request):
    user_id = request.args["id"]
    cursor.execute("SELECT * FROM users WHERE id=" + user_id)
    cursor.execute(f"SELECT * FROM users WHERE id={user_id}")
`, 'src/direct.py');
  assert.equal(directSink.result.findings.length, 2);
  assert.equal(directSink.result.status, 'COMPLETED');
});

test('detects supported Python SQL injection at module scope', async () => {
  const { result } = await run(`user_id = request.args.get("id")
query = "SELECT * FROM users WHERE id = " + user_id
db.execute(query)
`, 'src/app.py');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'request.args'));
});

test('detects the supported Python request.get and string-cast SQL concatenation pattern', async () => {
  const cases = [
    `def get_user(cursor, request):
    user_id = request.args.get("id")
    query = "SELECT * FROM users WHERE id = " + str(user_id)
    return cursor.execute(query)`,
    `def fetch(cursor, request):
    # This comment does not make the query safe.
    record_id = request.args.get("id")
    sql = "SELECT * FROM records WHERE id = " + str(record_id)
    return cursor.execute(sql)`,
  ];

  for (const source of cases) {
    const { result } = await run(source, 'src/query.py');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');
  }
});

test('detects Python SQL injection through f-strings and bounded concatenation expressions', async () => {
  const cases = [
    {
      name: 'case_002_python_sqli_fstring.py',
      status: 'COMPLETED',
    },
    {
      name: 'case_012_python_sqli_execute_variable.py',
      status: 'PARTIAL',
    },
    {
      name: 'case_013_python_sqli_multiline.py',
      status: 'COMPLETED',
    },
    {
      name: 'case_041_python_nested_sqli.py',
      status: 'COMPLETED',
    },
  ];

  for (const fixture of cases) {
    const source = await readFile(
      new URL(`../../bugzero-50-file-audit-fixture/cases/${fixture.name}`, import.meta.url),
      'utf8',
    );
    const { result } = await run(source, `src/${fixture.name}`);
    assert.equal(result.status, fixture.status, fixture.name);
    assert.equal(result.findings.length, 1, fixture.name);
    assert.equal(result.findings[0]?.ruleId, 'SECURITY.SQL_INJECTION');
    assert.equal(result.findings[0]?.evidenceGraph?.completeness, 'COMPLETE');
    assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
      node.nodeType === 'SOURCE' && node.attributes.provenance === 'SECURITY_ANALYZER'));
    if (fixture.status === 'PARTIAL') {
      assert.match(result.diagnostics.join(' '), /return propagation is not supported/i);
    }
    if (fixture.name === 'case_041_python_nested_sqli.py') {
      assert.ok(result.findings[0]?.evidenceGraph?.edges.some((edge) => edge.relation === 'PASSES_ARGUMENT'));
    }
  }
});

test('matches every strictly labeled SQL injection fixture case', async () => {
  const cases = [
    { name: 'case_001_python_sqli_concat.py', status: 'COMPLETED', findings: 1 },
    { name: 'case_002_python_sqli_fstring.py', status: 'COMPLETED', findings: 1 },
    { name: 'case_003_python_sqli_safe.py', status: 'COMPLETED', findings: 0 },
    { name: 'case_004_python_sqli_constant.py', status: 'COMPLETED', findings: 0 },
    { name: 'case_012_python_sqli_execute_variable.py', status: 'PARTIAL', findings: 1 },
    { name: 'case_013_python_sqli_multiline.py', status: 'COMPLETED', findings: 1 },
    { name: 'case_017_ts_sqli_concat.ts', status: 'COMPLETED', findings: 1 },
    { name: 'case_018_ts_sqli_safe.ts', status: 'COMPLETED', findings: 0 },
    { name: 'case_044_python_safe_constant_query.py', status: 'COMPLETED', findings: 0 },
  ] as const;

  for (const fixture of cases) {
    const source = await readFile(
      new URL(`../../bugzero-50-file-audit-fixture/cases/${fixture.name}`, import.meta.url),
      'utf8',
    );
    const { result } = await run(source, `src/${fixture.name}`);
    assert.equal(result.status, fixture.status, fixture.name);
    assert.equal(result.findings.length, fixture.findings, fixture.name);
    for (const finding of result.findings) {
      assert.equal(finding.ruleId, 'SECURITY.SQL_INJECTION');
      assert.equal(finding.evidenceGraph?.completeness, 'COMPLETE');
      assert.equal(finding.evidenceGraph?.sufficiency, 'SUFFICIENT');
      assert.ok(finding.evidenceGraph?.nodes.some((node) =>
        node.nodeType === 'SOURCE' && node.attributes.provenance === 'SECURITY_ANALYZER'));
    }
  }
});

test('propagates Python request taint through an exactly called nested helper', async () => {
  const { result } = await run(`def handler(cursor, request):
    def query_for(value):
        sql = "SELECT * FROM inventory WHERE sku = " + str(value)
        return cursor.execute(sql)
    return query_for(request.args.get("sku"))`, 'src/query.py');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.attributes.provenance === 'SECURITY_ANALYZER'));
  assert.ok(result.findings[0]?.evidenceGraph?.edges.some((edge) => edge.relation === 'PASSES_ARGUMENT'));
});

test('clears Python taint when a variable is overwritten with a constant', async () => {
  const { result } = await run(`def handler(request):
    user_id = request.args.get("id")
    user_id = "constant"
    query = "SELECT * FROM users WHERE id = " + user_id
    cursor.execute(query)
`, 'src/app.py');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 0);
});

test('preserves Python taint across a conditional constant reassignment and reports partial analysis', async () => {
  const { result } = await run(`def handler(request):
    user_id = request.args.get("id")
    if request.args.get("use_safe_value"):
        user_id = "constant"
    query = "SELECT * FROM users WHERE id = " + user_id
    cursor.execute(query)
`, 'src/app.py');
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 1);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.includes('conditional assignment may affect SQL taint')));
});

test('tracks a Python request-object alias into a SQL sink', async () => {
  const { result } = await run(`def handler(request):
    input = request
    user_id = input.args.get("id")
    query = "SELECT * FROM users WHERE id = " + user_id
    cursor.execute(query)
`, 'src/app.py');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'input.args'));
});

test('marks conditional Python request-object aliases partial while preserving possible findings', async () => {
  const { result } = await run(`def handler(request):
    input = None
    if use_external_input:
        input = request
    user_id = input.args.get("id")
    query = "SELECT * FROM users WHERE id = " + user_id
    cursor.execute(query)
`, 'src/app.py');
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 1);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.includes('conditional assignment may affect SQL taint')));
});

test('keeps unsupported Python transformations explicitly partial without findings', async () => {
  const cases = [
    `def search_user(cursor, request):
    term = request.args.get("q")
    query = f"SELECT * FROM users WHERE name = '{normalize(term)}'"
    return cursor.execute(query)`,
    `def search_user(cursor, request):
    term = request.args.get("q")
    query = "SELECT * FROM users WHERE name = '" + normalize(term) + "'"
    return cursor.execute(query)`,
  ];

  for (const source of cases) {
    const { result } = await run(source, 'src/query.py');
    assert.equal(result.findings.length, 0);
    assert.equal(result.status, 'PARTIAL', source);
    assert.ok(result.diagnostics.length > 0);
  }
});

test('does not report Python parameter binding', async () => {
  const { result } = await run(`
def handler(request):
    user_id = request.args["id"]
    cursor.execute(
        "SELECT * FROM users WHERE id=%s",
        (user_id,)
    )
`, 'src/app.py');
  assert.equal(result.findings.length, 0);
  assert.equal(result.status, 'COMPLETED');
});

test('recognizes returned Python parameterized and constant SQL as safe', async () => {
  const parameterized = await run(`def get_user(cursor, user_id):
    return cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
`, 'src/app.py');
  assert.equal(parameterized.result.findings.length, 0);
  assert.equal(parameterized.result.status, 'COMPLETED');

  const constant = await run(`def get_active_users(cursor):
    return cursor.execute("SELECT * FROM users WHERE active = 1")
`, 'src/app.py');
  assert.equal(constant.result.findings.length, 0);
  assert.equal(constant.result.status, 'COMPLETED');
});

test('detects concatenated SQL from Python function parameters and accepts a parameterized query variable', async () => {
  const vulnerable = await run(`def get_user_vulnerable(cursor, user_id):
    query = "SELECT * FROM users WHERE id = '" + user_id + "'"
    return cursor.execute(query)
`, 'src/sql_injection_test.py');
  assert.equal(vulnerable.result.status, 'COMPLETED');
  assert.equal(vulnerable.result.findings.length, 1);
  assert.ok(vulnerable.result.findings[0]?.evidenceGraph?.nodes.some((node) =>
    node.nodeType === 'SOURCE' && node.label === 'parameter:user_id'));

  const safe = await run(`def get_user_safe(cursor, user_id):
    query = "SELECT * FROM users WHERE id = ?"
    return cursor.execute(query, (user_id,))
`, 'src/sql_injection_test.py');
  assert.equal(safe.result.status, 'COMPLETED');
  assert.equal(safe.result.findings.length, 0);
  assert.deepEqual(safe.result.diagnostics, []);
});

test('handles Python SQL sinks nested in return expressions without tainting unrelated returns', async () => {
  const { result } = await run(`def get_user_vulnerable(cursor, user_id):
    query = "SELECT * FROM users WHERE id = '" + user_id + "'"
    return (cursor.execute(query))

def get_user_safe(cursor, user_id):
    query = "SELECT * FROM users WHERE id = ?"
    return (cursor.execute(query, (user_id,)))

def echo(value):
    return value
`, 'src/sql_injection_test.py');

  assert.equal(result.status, 'COMPLETED', result.diagnostics.join(' | '));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.startLine, 3);
  assert.match(result.findings[0]?.semanticTarget ?? '', /get_user_vulnerable/);
  assert.equal(result.findings[0]?.evidenceGraph?.nodes.filter((node) => node.nodeType === 'SINK').length, 1);
});

test('resolves function-parameter taint through a SQL prefix variable and validates bindings', async () => {
  const vulnerable = await run(`def get_user(cursor, user_id):
    sql_prefix = "SELECT * FROM users WHERE id = '"
    query = sql_prefix + user_id + "'"
    return cursor.execute(query)
`, 'src/sql_injection_test.py');
  assert.equal(vulnerable.result.status, 'COMPLETED', vulnerable.result.diagnostics.join(' | '));
  assert.equal(vulnerable.result.findings.length, 1);

  const unsupportedBinding = await run(`def get_user(cursor, user_id):
    query = "SELECT * FROM users WHERE id = ?"
    return cursor.execute(query, user_id)
`, 'src/sql_injection_test.py');
  assert.equal(unsupportedBinding.result.findings.length, 0);
  assert.equal(unsupportedBinding.result.status, 'PARTIAL');
  assert.ok(unsupportedBinding.result.diagnostics.length > 0);

  const missingBinding = await run(`def get_user(cursor):
    return cursor.execute("SELECT * FROM users WHERE id = ?")
`, 'src/sql_injection_test.py');
  assert.equal(missingBinding.result.findings.length, 0);
  assert.equal(missingBinding.result.status, 'PARTIAL');
});

test('reports multiple Python SQL sinks once each with their own source lines', async () => {
  const { result } = await run(`def lookup(cursor, user_id):
    first = "SELECT * FROM users WHERE id = '" + user_id + "'"
    cursor.execute(first)
    second = f"SELECT * FROM users WHERE id = '{user_id}'"
    return cursor.execute(second)
`, 'src/sql_injection_test.py');
  assert.equal(result.status, 'COMPLETED', result.diagnostics.join(' | '));
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings.map((item) => item.startLine), [3, 5]);
  assert.equal(
    result.findings.reduce((count, item) =>
      count + (item.evidenceGraph?.nodes.filter((node) => node.nodeType === 'SINK').length ?? 0), 0),
    2,
  );
});

test('keeps unresolved Python SQL query construction partial', async () => {
  const { result } = await run(`def get_user(cursor, user_id):
    query = "SELECT * FROM users WHERE id = ?"
    query = build_query(user_id)
    return cursor.execute(query, (user_id,))
`, 'src/sql_injection_test.py');
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test('resource budgets return PARTIAL and preserve bounded candidate results', async () => {
  const noFiles = await run('function handler(req) { db.query(req.query.id); }', undefined, false, {
    maxFiles: 0,
    maxEntities: 100,
    maxDurationMs: 60_000,
  });
  assert.equal(noFiles.result.status, 'PARTIAL');
  assert.match(noFiles.result.diagnostics.join(' '), /maxFiles/);

  const entityLimited = await run('function handler(req) { db.query(req.query.id); }', undefined, false, {
    maxFiles: 10,
    maxEntities: 1,
    maxDurationMs: 60_000,
  });
  assert.equal(entityLimited.result.status, 'PARTIAL');
  assert.match(entityLimited.result.diagnostics.join(' '), /maxEntities/);

  const durationLimited = await run('function handler(req) { db.query(req.query.id); }', undefined, false, {
    maxFiles: 10,
    maxEntities: 100,
    maxDurationMs: 0,
  });
  assert.equal(durationLimited.result.status, 'PARTIAL');
  assert.match(durationLimited.result.diagnostics.join(' '), /maxDurationMs/);

  const calls = Array.from({ length: 101 }, (_, index) =>
    `  db.query("SELECT * FROM users WHERE id=" + id); // sink ${index}`).join('\n');
  const taintLimited = await run(`
function handler(req) {
  const id = req.query.id;
${calls}
}`);
  assert.equal(taintLimited.result.status, 'PARTIAL');
  assert.equal(taintLimited.result.findings.length, 100);
  assert.match(taintLimited.result.diagnostics.join(' '), /taint graph budget/);
});

test('persists and replays SQL injection finding and evidence through the existing orchestrator', async () => {
  const source = `
function handler(req) {
  const id = req.query.id;
  const sql = "SELECT * FROM users WHERE id=" + id;
  db.query(sql);
}`;
  const fixture = makeFixture(source);
  const findings = new MemoryFindings();
  const evidence = new MemoryEvidenceRepository();
  const risks = new MemoryRiskAssessmentRepository();
  const registry = new AnalyzerRegistry();
  registry.register(sqlInjectionAnalyzer);
  const orchestrator = new AnalyzerOrchestrator(
    registry,
    findings,
    evidence,
    risks,
  );
  const input = {
    organizationId,
    repositoryId,
    commitId,
    analysisRunId: '44444444-4444-4444-8444-444444444444',
    analysisProfileId: 'profile-1',
    analysisProfileVersion: '1',
    analysisScope: { mode: 'FULL' as const },
    repositoryIntelligence: fixture.intelligence,
    codeIR: { entities: fixture.intelligence.entities, relationships: fixture.intelligence.relationships },
    sourceAccess: fixture.context.sourceAccess,
    language: 'TypeScript',
  };
  await orchestrator.execute(input);
  await orchestrator.execute(input);
  assert.equal(findings.findings.size, 1);
  assert.equal(findings.occurrences.size, 1);
  assert.equal(evidence.graphs.size, 1);
  assert.equal(risks.assessments.size, 1);
  const graph = [...evidence.graphs.values()][0];
  assert.ok(graph);
  assert.equal(graph.snapshot.authority, 'AUTHORITATIVE');
  assert.equal(graph.snapshot.sufficiency, 'SUFFICIENT');
  assert.equal(graph.snapshot.completeness, 'COMPLETE');
  assert.ok(graph.nodes.some((node) => node.node_type === 'SOURCE'));
  assert.ok(graph.nodes.some((node) => node.node_type === 'SINK'));
  assert.ok(graph.nodes.every((node) => node.attributes.provenance === 'SECURITY_ANALYZER'));
  assert.ok(graph.edges.every((edge) => edge.resolution === 'EXACT'));
  assert.equal(graph.snapshot.paths.length, 1);
  const firstRisk = [...risks.assessments.values()][0];
  assert.ok(firstRisk);
  assert.equal(firstRisk.profile_id, 'default-v1');
  assert.equal(firstRisk.profile_version, 1);
  assert.equal(firstRisk.evidence_id, graph.snapshot.id);
  assert.equal(firstRisk.evidence_authority, 'AUTHORITATIVE');
  assert.equal(firstRisk.evidence_sufficiency, 'SUFFICIENT');
  assert.equal(firstRisk.evidence_completeness, 'COMPLETE');
  assert.equal(firstRisk.reachability, 'UNKNOWN');
  assert.equal(firstRisk.exploitability, 'UNKNOWN');
  assert.equal(firstRisk.dependency_exposure, 'UNKNOWN');

  const nextCommitId = '66666666-6666-4666-8666-666666666666';
  const nextFixture = makeFixture(source, 'src/app.ts', false, undefined, nextCommitId);
  const nextInput = {
    ...input,
    commitId: nextCommitId,
    repositoryIntelligence: nextFixture.intelligence,
    codeIR: {
      entities: nextFixture.intelligence.entities,
      relationships: nextFixture.intelligence.relationships,
    },
    sourceAccess: nextFixture.context.sourceAccess,
  };
  await orchestrator.execute(nextInput);
  assert.equal(findings.findings.size, 1);
  assert.equal(findings.occurrences.size, 2);
  assert.equal(evidence.graphs.size, 2);
  assert.equal(risks.assessments.size, 2);
  assert.ok([...evidence.graphs.values()].some((entry) => entry.snapshot.commit_id === commitId));
  assert.ok([...evidence.graphs.values()].some((entry) => entry.snapshot.commit_id === nextCommitId));
  assert.equal(graph.snapshot.commit_id, commitId);

  await orchestrator.execute(nextInput);
  assert.equal(findings.occurrences.size, 2);
  assert.equal(evidence.graphs.size, 2);
  assert.equal(risks.assessments.size, 2);
});

test('evidence retrieval remains organization-scoped for security snapshots', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      return { rows: [] };
    },
  } as unknown as ConstructorParameters<typeof EvidenceRepository>[0];
  const repository = new EvidenceRepository(pool);
  assert.equal(await repository.getSnapshot('org-a', 'evidence-owned-by-org-b'), null);
  await repository.listForOccurrence('org-a', 'occurrence-owned-by-org-b');
  await repository.getEvidenceForFinding('org-a', 'finding-owned-by-org-b');
  await repository.getNodesForFinding('org-a', 'finding-owned-by-org-b');
  await repository.getEdgesForFinding('org-a', 'finding-owned-by-org-b');
  await repository.getPath('org-a', 'evidence-owned-by-org-b', 'path-b');
  assert.equal(queries.length, 6);
  assert.equal(queries.every((query) =>
    query.values[0] === 'org-a'
    && /(?:organization_id|e\.organization_id)\s*=\s*\$1/i.test(query.text)), true);
});
