import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import yauzl from 'yauzl';
import {
  AnalysisRepository,
  authRepository,
  createDatabasePool,
  setTransactionOrganizationContext,
  withOrganizationContext,
} from '@bugzero/database';
import { getRedisUrl } from '@bugzero/config';
import { AnalysisJobProcessor } from '@bugzero/workers/analysis-processor';
import { GroqInvestigator } from '@bugzero/workers/ai/groq';
import { createAnalysisQueue, createAnalysisQueueWorker, enqueueAnalysisJob } from '@bugzero/workers/analysis-queue';
import { createSignedTokenAuthenticator } from '../../src/auth/signed-token.js';
import { createApiServer } from '../../src/server.js';

const enabled = process.env.BUGZERO_LIVE_INTEGRATION === '1';
const issuer = 'bugzero-live-onboarding-test';
const audience = 'bugzero-api';

function signedToken(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], userId: string, organizationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    sub: userId,
    org: organizationId,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 600,
  })).toString('base64url');
  const content = `${header}.${claims}`;
  return `${content}.${sign(null, Buffer.from(content), privateKey).toString('base64url')}`;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeSourceZip(files: Array<{ filePath: string; source: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.filePath, 'utf8');
    const content = Buffer.from(file.source, 'utf8');
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(0x81a40000, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function readSourceZip(archive: Buffer): Promise<Array<{ filePath: string; source: string }>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('Could not open the risky ZIP fixture'));
        return;
      }
      const files: Array<{ filePath: string; source: string }> = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error(`Could not read ${entry.fileName} from the ZIP fixture`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            files.push({
              filePath: entry.fileName,
              source: Buffer.concat(chunks).toString('utf8'),
            });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function waitForRun(
  app: ReturnType<typeof createApiServer>,
  token: string,
  runId: string,
): Promise<{ status: string; job: { status: string } | null }> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: 'GET',
      url: `/analysis/${runId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json() as { status: string; job: { status: string } | null };
    if (result.job && ['COMPLETED', 'FAILED', 'DEAD_LETTER'].includes(result.job.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for analysis run ${runId}`);
}

async function cleanupTenant(pool: ReturnType<typeof createDatabasePool>, organizationId: string, userId: string): Promise<void> {
  await withOrganizationContext(organizationId, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTransactionOrganizationContext(client);
      const immutableRecords = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM evidence WHERE organization_id = $1)
          OR EXISTS (SELECT 1 FROM health_snapshots WHERE organization_id = $1) AS exists`,
        [organizationId],
      );
      if (immutableRecords.rows[0]?.exists) {
        await client.query('ROLLBACK');
        console.info('Live onboarding tenant with immutable analysis records retained; use a disposable database for this test');
        return;
      }
      await client.query(
        'UPDATE findings SET current_occurrence_id = NULL, resolution_evidence_id = NULL WHERE organization_id = $1',
        [organizationId],
      );
      for (const table of [
        'evidence_edges',
        'evidence_nodes',
        'ai_explanations',
        'risk_assessments',
        'evidence',
        'finding_occurrences',
        'findings',
        'health_snapshots',
        'reports',
        'analysis_jobs',
        'code_relationships',
        'code_entities',
        'dependency_edges',
        'dependencies',
        'repository_files',
        'analysis_runs',
        'analysis_profiles',
        'audit_logs',
        'members',
        'repository_commits',
        'repositories',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
      }
      await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Live onboarding cleanup rollback failed for organization ${organizationId}`);
      }
      throw error;
    } finally {
      client.release();
    }
  });
}

test('live account onboarding, local ZIP analysis, and persisted repository history', { skip: !enabled }, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must target the live PostgreSQL test database');
  assert.ok(process.env.REDIS_URL, 'REDIS_URL must target the live Redis-compatible test service');

  const cleanupPool = createDatabasePool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authenticate = createSignedTokenAuthenticator({ publicKey, issuer, audience });
  const queueName = `bugzero-live-onboarding-${crypto.randomUUID()}`;
  const workerRedis = new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
  const publisherRedis = new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
  const queue = createAnalysisQueue(publisherRedis, queueName);
  const analyses = new AnalysisRepository();
  const worker = createAnalysisQueueWorker(
    workerRedis,
    (payload, attempt) => new AnalysisJobProcessor({
      aiInvestigator: new GroqInvestigator({ environment: {} }),
    }).process(payload, attempt),
    queueName,
  );
  const api = createApiServer({
    authenticate,
    queue: {
      async enqueue(payload) {
        await enqueueAnalysisJob(queue, payload);
      },
    },
    auth: {
      issueToken: async (userId, organizationId) => {
        const now = Math.floor(Date.now() / 1000);
        return {
          accessToken: signedToken(privateKey, userId, organizationId),
          issuedAt: now,
          expiresAt: now + 600,
        };
      },
    },
  });
  let userId: string | null = null;
  let organizationId: string | null = null;

  try {
    await worker.waitUntilReady();
    const email = `onboarding-${crypto.randomUUID()}@bugzero.invalid`;
    const registration = await api.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        displayName: 'Live Onboarding User',
        email,
        password: 'live-onboarding-password',
        workspaceName: 'Live Onboarding Workspace',
      },
    });
    assert.equal(registration.statusCode, 201, registration.body);
    const registered = registration.json() as {
      accessToken: string;
      user: { userId: string; email: string; role: string };
    };
    userId = registered.user.userId;
    organizationId = (await authRepository.getAccountByEmail(email))?.default_organization_id ?? null;
    assert.ok(organizationId, 'registration must persist the workspace');
    assert.equal(registered.user.role, 'OWNER');

    const authenticatedSession = await api.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { authorization: `Bearer ${registered.accessToken}` },
    });
    assert.equal(authenticatedSession.statusCode, 200, authenticatedSession.body);
    assert.equal(authenticatedSession.json().workspace.organizationId, organizationId);
    assert.equal(authenticatedSession.json().workspace.name, 'Live Onboarding Workspace');

    const login = await api.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'live-onboarding-password' },
    });
    assert.equal(login.statusCode, 200, login.body);
    const accessToken = (login.json() as { accessToken: string }).accessToken;
    const authorization = { authorization: `Bearer ${accessToken}` };

    const emptyRepositories = await api.inject({ method: 'GET', url: '/repositories', headers: authorization });
    assert.equal(emptyRepositories.statusCode, 200, emptyRepositories.body);
    assert.deepEqual(emptyRepositories.json().repositories, []);

    const riskyFixture = readFileSync(new URL('../../../../tests/fixtures/local-e2e.zip', import.meta.url));
    const fixtureFiles = await readSourceZip(riskyFixture);
    assert.equal(fixtureFiles.length, 1);
    assert.equal(fixtureFiles[0]?.filePath, 'src/vulnerable.ts');
    const files = [
      ...fixtureFiles,
      {
        filePath: 'src/helpers.ts',
        source: 'export function normalizeName(value: string): string { return value.trim(); }',
      },
      {
        filePath: 'src/legacy.js',
        source: 'function formatId(id) { return String(id); }',
      },
      {
        filePath: 'src/profile.py',
        source: `def render_profile(name):
    return "<p>" + name + "</p>"
`,
      },
    ];
    const upload = await api.inject({
      method: 'POST',
      url: '/repositories/local-zip',
      headers: {
        ...authorization,
        'content-type': 'application/zip',
        'x-repository-name': 'Onboarding Smoke Check',
      },
      payload: makeSourceZip(files),
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const uploaded = upload.json() as { repository: { id: string; fullName: string }; revision: { commitSha: string } };
    assert.equal(uploaded.repository.fullName, 'Onboarding Smoke Check');
    assert.match(uploaded.revision.commitSha, /^[a-f0-9]{40}$/);

    const repositoryList = await api.inject({ method: 'GET', url: '/repositories', headers: authorization });
    assert.equal(repositoryList.statusCode, 200, repositoryList.body);
    assert.deepEqual(repositoryList.json().repositories.map((repository: { id: string }) => repository.id), [uploaded.repository.id]);

    const analysis = await api.inject({
      method: 'POST',
      url: '/analysis',
      headers: authorization,
      payload: {
        repositoryId: uploaded.repository.id,
        commitSha: uploaded.revision.commitSha,
        profileId: 'default',
        scope: 'COMMIT',
      },
    });
    assert.equal(analysis.statusCode, 202, analysis.body);
    const accepted = analysis.json() as { analysisRunId: string };
    const completed = await waitForRun(api, accessToken, accepted.analysisRunId);
    assert.equal(completed.job?.status, 'COMPLETED');
    assert.equal(completed.status, 'COMPLETED');
    const persistedRun = await withOrganizationContext(organizationId, () =>
      analyses.getRun(organizationId as string, accepted.analysisRunId));
    assert.ok(persistedRun);
    assert.equal(persistedRun.status, 'COMPLETED');
    const pipeline = persistedRun.coverage.pipeline as Record<string, unknown>;
    assert.equal(pipeline.status, 'COMPLETED');
    assert.equal(pipeline.sourceFiles, 4);
    assert.equal(pipeline.parsedFiles, 4);
    const mlSignals = pipeline.mlSignals as {
      status: string;
      signals: Array<Record<string, unknown> & { modelVersion: string; function: Record<string, unknown> }>;
    };
    assert.equal(mlSignals.status, 'AVAILABLE');
    assert.ok(mlSignals.signals.length > 0, 'Python function should produce a persisted investigative signal');
    assert.ok(mlSignals.signals.some((signal) => signal.modelVersion === 'v1'));
    for (const signal of mlSignals.signals) {
      assert.deepEqual(Object.keys(signal).sort(), ['function', 'label', 'modelVersion', 'score', 'timestamp']);
      assert.equal('authority' in signal, false);
      assert.equal('evidence' in signal, false);
      assert.equal('evidenceId' in signal, false);
      assert.equal('findingId' in signal, false);
      assert.equal('evidenceAuthority' in signal, false);
      assert.equal('evidenceCompleteness' in signal, false);
      assert.equal('evidenceSufficiency' in signal, false);
      assert.equal('confirmed' in signal, false);
      assert.equal('findingConfidenceOverride' in signal, false);
      assert.equal('authority' in signal.function, false);
      assert.equal('evidence' in signal.function, false);
    }

    const findings = await api.inject({
      method: 'GET',
      url: `/repositories/${uploaded.repository.id}/findings`,
      headers: authorization,
    });
    assert.equal(findings.statusCode, 200, findings.body);
    const persistedFindings = findings.json().findings as Array<{ finding: { id: string; ruleId: string } }>;
    assert.ok(persistedFindings.length > 0, 'uploaded vulnerable source must produce real findings');
    const sqlFinding = persistedFindings.find((item) => item.finding.ruleId === 'SECURITY.SQL_INJECTION');
    assert.ok(sqlFinding, 'the ZIP SQL construction must produce the deterministic SQL Injection finding');
    const findingDetail = await api.inject({
      method: 'GET',
      url: `/findings/${sqlFinding.finding.id}`,
      headers: authorization,
    });
    assert.equal(findingDetail.statusCode, 200, findingDetail.body);
    const detail = findingDetail.json() as {
      title: string;
      location: { filePath: string | null; startLine: number | null; endLine: number | null };
      finding: { currentConfidence: string; currentRisk: number };
      occurrence: { assessment: { confidence: string } } | null;
      evidence: { snapshot: { authority: string; completeness: string; sufficiency: string } } | null;
      risk: {
        model_version: string;
        technical_risk: number;
        evidence_authority: string;
        evidence_completeness: string;
        evidence_sufficiency: string;
      } | null;
      risks: Array<{
        model_version: string;
        confidence: string;
        technical_risk: number;
        evidence_authority: string;
        evidence_completeness: string;
        evidence_sufficiency: string;
      }>;
      mlSignalStatus: string;
      mlSignal: Record<string, unknown> | null;
      aiExplanation: { status: string; explanation: string | null } | null;
      recommendedFix: string[] | null;
    };
    assert.equal(detail.title, 'SQL Injection');
    assert.equal(detail.location.filePath, 'src/vulnerable.ts');
    assert.equal(detail.finding.currentConfidence, 'HIGH');
    assert.equal(detail.occurrence?.assessment.confidence, 'HIGH');
    assert.equal(typeof detail.finding.currentRisk, 'number');
    assert.ok(detail.evidence, 'the finding must include persisted evidence');
    assert.equal(detail.evidence.snapshot.authority, 'AUTHORITATIVE');
    assert.equal(detail.evidence.snapshot.completeness, 'COMPLETE');
    assert.equal(detail.evidence.snapshot.sufficiency, 'SUFFICIENT');
    assert.ok(detail.risks.length > 0, 'the finding must include a persisted risk assessment');
    assert.equal(detail.risks[0]?.evidence_authority, 'AUTHORITATIVE');
    assert.equal(detail.risks[0]?.evidence_completeness, 'COMPLETE');
    assert.equal(detail.risks[0]?.evidence_sufficiency, 'SUFFICIENT');
    assert.equal(detail.risks[0]?.model_version, 'bugzero-deterministic-risk-v1');
    assert.equal(detail.risks[0]?.confidence, detail.occurrence?.assessment.confidence);
    assert.equal(detail.risks[0]?.technical_risk, detail.finding.currentRisk);
    assert.equal(detail.risk?.model_version, 'bugzero-deterministic-risk-v1');
    assert.equal(detail.risk?.technical_risk, detail.finding.currentRisk);
    assert.equal(detail.mlSignalStatus, 'AVAILABLE');
    assert.equal(detail.mlSignal, null, 'the separate Python signal must not be attributed to the TypeScript SQL finding');
    assert.equal(detail.aiExplanation, null, 'unconfigured Groq should remain unavailable without blocking persisted finding retrieval');
    assert.equal(detail.recommendedFix, null);
    assert.equal('mlSignals' in detail.finding, false);
    assert.equal('mlSignals' in detail.evidence, false);
    assert.equal('mlSignals' in detail.risks[0]!, false);

    const repositoryDetail = await api.inject({
      method: 'GET',
      url: `/repositories/${uploaded.repository.id}`,
      headers: authorization,
    });
    assert.equal(repositoryDetail.statusCode, 200, repositoryDetail.body);
    assert.equal(repositoryDetail.json().latestRun.id, accepted.analysisRunId);
    assert.ok(repositoryDetail.json().latestHealth);

    const history = await api.inject({
      method: 'GET',
      url: `/repositories/${uploaded.repository.id}/history`,
      headers: authorization,
    });
    assert.equal(history.statusCode, 200, history.body);
    assert.ok(history.json().history.some((entry: { run: { id: string } }) => entry.run.id === accepted.analysisRunId));
  } finally {
    await api.close();
    await worker.close();
    await workerRedis.quit();
    await queue.close();
    await publisherRedis.quit();
    if (userId && organizationId) await cleanupTenant(cleanupPool, organizationId, userId);
    await cleanupPool.end();
  }
});
