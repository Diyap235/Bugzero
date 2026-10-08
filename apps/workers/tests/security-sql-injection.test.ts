import test from 'node:test';
import assert from 'node:assert/strict';

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
import { sqlInjectionAnalyzer } from '../src/analyzers/security/sql-injection-analyzer.js';
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

test('security rule registry exposes explicit SQL sources and sinks', () => {
  assert.equal(sqlInjectionRule.id, 'SECURITY.SQL_INJECTION');
  assert.equal(sqlInjectionRule.version, '1.0.0');
  assert.equal(sqlInjectionRule.severity, 'HIGH');
  assert.deepEqual(sqlInjectionSourcePatterns.javascript.inputProperties, ['query', 'body', 'params']);
  assert.deepEqual(sqlInjectionSinkPatterns.receiverMethods.cursor, ['execute']);
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
  assert.equal(unsupportedBranch.result.findings.length, 0);
  assert.equal(unsupportedBranch.result.status, 'PARTIAL');
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
