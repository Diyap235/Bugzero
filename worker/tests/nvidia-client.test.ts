import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NvidiaInvestigator,
  selectNvidiaInvestigatorForRepository,
} from '../src/ai/nvidia/nvidia-client.js';
import type { NvidiaCompletionTransport } from '../src/ai/nvidia/nvidia-client.js';
import { buildRepositoryReviewContext } from '../src/ai/nvidia/repository-review-context.js';
import type { AIRepositoryReviewContext } from '../src/ai/investigation-types.js';

const sourceContext: AIRepositoryReviewContext = {
  analysisStatus: 'COMPLETED',
  sourceFileCount: 1,
  parsedFileCount: 1,
  files: [
    { filePath: 'src/service.ts', kind: 'SOURCE', source: 'const value = request.query.id;\ndb.query(value);' },
    { filePath: 'package.json', kind: 'DEPENDENCY_MANIFEST', source: '{\n  "dependencies": {}\n}' },
  ],
};

function validReview() {
  const code = { filePath: 'src/service.ts', line: 1 };
  return {
    dimensions: {
      SECURITY: { score: 65, confidence: 'MEDIUM', explanation: 'Review is supported by source.', evidence: [code] },
      QUALITY: { score: 80, confidence: 'LOW', explanation: 'Review is supported by source.', evidence: [code] },
      MAINTAINABILITY: { score: 77, confidence: 'LOW', explanation: 'Review is supported by source.', evidence: [code] },
      RELIABILITY: { score: 72, confidence: 'LOW', explanation: 'Review is supported by source.', evidence: [code] },
      DEPENDENCIES: {
        score: 91,
        confidence: 'MEDIUM',
        explanation: 'The supplied manifest was reviewed.',
        evidence: [{ filePath: 'package.json', line: 2 }],
      },
    },
    findings: [
      {
        dimension: 'SECURITY',
        title: 'Unparameterized query input',
        severity: 'HIGH',
        filePath: 'src/service.ts',
        startLine: 1,
        endLine: 2,
        explanation: 'The query uses request-derived data.',
        remediation: 'Use a parameterized query.',
      },
      {
        dimension: 'DEPENDENCIES',
        title: 'Unsupported manifest reference',
        severity: 'HIGH',
        filePath: 'missing-package.json',
        startLine: 1,
        endLine: 1,
        explanation: 'This reference was not supplied.',
        remediation: 'Do not accept this unsupported claim.',
      },
    ],
  };
}

function investigator(
  create: NvidiaCompletionTransport['create'],
  environment: Record<string, string | undefined> = { NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
): NvidiaInvestigator {
  return new NvidiaInvestigator({
    environment: { ...environment, BUGZERO_ENABLE_EXTERNAL_AI: 'true' },
    client: { create },
  });
}

test('NVIDIA integration is optional and validates server model configuration', async () => {
  const disabled = new NvidiaInvestigator({ environment: {} });
  assert.equal(disabled.availability, 'MISSING_CONFIGURATION');
  assert.deepEqual(await disabled.reviewRepository(sourceContext), {
    status: 'UNAVAILABLE',
    result: null,
    errorCode: 'MISSING_CONFIGURATION',
  });
  const keyOnly = new NvidiaInvestigator({
    environment: { NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
    fetchImpl: async () => {
      throw new Error('key-only mode must not send a request');
    },
  });
  assert.equal(keyOnly.enabled, false);
  assert.deepEqual(await keyOnly.reviewRepository(sourceContext), {
    status: 'UNAVAILABLE',
    result: null,
    errorCode: 'MISSING_CONFIGURATION',
  });
  let optInCalled = false;
  const optIn = new NvidiaInvestigator({
    environment: {
      BUGZERO_ENABLE_EXTERNAL_AI: 'true',
      NVIDIA_API_KEY: 'server-only',
      NVIDIA_MODEL: 'test-model',
    },
    client: {
      async create() {
        optInCalled = true;
        return {};
      },
    },
  });
  assert.equal(optIn.enabled, true);
  await optIn.reviewRepository(sourceContext);
  assert.equal(optInCalled, true);
  const defaultModel = new NvidiaInvestigator({
    environment: { BUGZERO_ENABLE_EXTERNAL_AI: 'true', NVIDIA_API_KEY: 'server-only' },
    client: { async create() { return {}; } },
  });
  assert.equal(defaultModel.model, 'openai/gpt-oss-20b');

  let called = false;
  const invalid = new NvidiaInvestigator({
    environment: { BUGZERO_ENABLE_EXTERNAL_AI: 'true', NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'invalid\nmodel' },
    client: { async create() { called = true; return {}; } },
  });
  assert.equal((await invalid.reviewRepository(sourceContext)).errorCode, 'INVALID_CONFIGURATION');
  assert.equal(called, false);
});

test('LOCAL repository selection never enables a configured external investigator', async () => {
  let called = false;
  const configured = new NvidiaInvestigator({
    explicitOptIn: true,
    environment: { NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
    fetchImpl: async () => {
      called = true;
      return new Response('', { status: 410 });
    },
  });
  const local = selectNvidiaInvestigatorForRepository('LOCAL', configured);
  assert.equal(local.enabled, false);
  assert.ok(local.reviewRepository);
  assert.deepEqual(await local.reviewRepository(sourceContext), {
    status: 'UNAVAILABLE',
    result: null,
    errorCode: 'MISSING_CONFIGURATION',
  });
  assert.equal(called, false);
});

test('repository review returns cited estimates and discards unsupported citations', async () => {
  let captured: {
    model: string;
    max_tokens: number;
    stream: false;
    messages: Array<{ role: string; content: string }>;
  } | undefined;
  const result = await investigator(async (input) => {
    captured = input;
    return { choices: [{ message: { content: JSON.stringify(validReview()) } }] };
  }).reviewRepository(sourceContext);

  assert.equal(result.status, 'COMPLETED');
  if (result.status !== 'COMPLETED') return;
  assert.equal(result.result.dimensions.SECURITY.score, 65);
  assert.equal(result.result.dimensions.DEPENDENCIES.score, 91);
  assert.equal(result.attempts, 1);
  assert.equal(result.result.findings.length, 1);
  assert.equal(result.result.findings[0]?.filePath, 'src/service.ts');
  assert.equal(captured?.model, 'test-model');
  assert.equal(captured?.max_tokens, 3_000);
  assert.equal(captured?.stream, false);
  assert.match(captured?.messages[1]?.content ?? '', /<BUGZERO_REPOSITORY>/);
  assert.doesNotMatch(JSON.stringify(result), /server-only|test-model|NVIDIA/);
});

test('dependency scores without a supplied manifest citation stay unknown', async () => {
  const result = await investigator(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          ...validReview(),
          dimensions: {
            ...validReview().dimensions,
            DEPENDENCIES: { score: 92, confidence: 'HIGH', explanation: 'No manifest cited.', evidence: [] },
          },
        }),
      },
    }],
  })).reviewRepository({ ...sourceContext, files: [sourceContext.files[0]!] });
  assert.equal(result.status, 'COMPLETED');
  if (result.status === 'COMPLETED') assert.equal(result.result.dimensions.DEPENDENCIES.score, null);
});

test('source context redacts secrets and ranks manifests before bounded source', () => {
  const context = buildRepositoryReviewContext({
    analysisStatus: 'COMPLETED',
    parsedFileCount: 1,
    sourceFiles: [
      { path: 'src/app.ts', content: 'const password = "do-not-send";\n'.repeat(200) },
      { path: 'package.json', content: '{\n  "dependencies": {}\n}' },
      { path: 'src/.env', content: 'API_KEY="do-not-send"' },
    ],
  });
  assert.equal(context.files[0]?.kind, 'DEPENDENCY_MANIFEST');
  assert.equal(context.sourceFileCount, 1);
  assert.equal(context.files.filter((file) => file.kind === 'SOURCE').length, 1);
  assert.equal(context.files.find((file) => file.kind === 'SOURCE')?.truncated, true);
  assert.equal(context.files.some((file) => file.filePath === 'src/.env'), false);
  assert.doesNotMatch(JSON.stringify(context), /do-not-send/);
  assert.ok(JSON.stringify(context).length <= 48_000);
});

test('transient NVIDIA responses are retried once and the credential stays in backend request headers', async () => {
  let attempts = 0;
  let authorization: string | null = null;
  const validExplanation = {
    summary: 'Source reviewed.',
    explanation: 'The supplied finding evidence was examined.',
    attackPath: ['Review the recorded source location.'],
    remediation: ['Apply an appropriate code correction.'],
    confidence: 'MEDIUM',
    reasoningStatus: 'SUPPORTED',
  };
  const service = new NvidiaInvestigator({
    environment: { BUGZERO_ENABLE_EXTERNAL_AI: 'true', NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
    fetchImpl: async (_input, init) => {
      attempts += 1;
      authorization = new Headers(init?.headers).get('authorization');
      if (attempts < 2) return new Response('', { status: 429 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validExplanation) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const outcome = await service.investigate({
    analysisStatus: 'COMPLETED',
    finding: { ruleId: 'RULE', severity: 'MEDIUM', confidence: 'HIGH', filePath: null, startLine: null, endLine: null },
    evidence: { authority: 'AUTHORITATIVE', sufficiency: 'SUFFICIENT', completeness: 'COMPLETE', diagnostics: [], paths: [], nodes: [], edges: [] },
    languages: ['TypeScript'],
    sourceSnippets: [],
  });
  assert.equal(outcome.status, 'COMPLETED');
  assert.equal(attempts, 2);
  assert.equal(authorization, 'Bearer server-only');
  assert.doesNotMatch(JSON.stringify(outcome), /server-only|test-model|NVIDIA/);
});

test('repository review bounds retries for provider connection failures', async () => {
  let attempts = 0;
  const service = new NvidiaInvestigator({
    environment: { BUGZERO_ENABLE_EXTERNAL_AI: 'true', NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
    fetchImpl: async () => {
      attempts += 1;
      throw new TypeError('fetch failed');
    },
  });

  const outcome = await service.reviewRepository(sourceContext);

  assert.equal(attempts, 2);
  assert.equal(outcome.status, 'FAILED');
  if (outcome.status === 'FAILED') {
    assert.equal(outcome.errorCode, 'PROVIDER_ERROR');
    assert.equal(outcome.attempts, 2);
  }
});

test('repository review reports invalid structured output without throwing', async () => {
  const outcome = await investigator(async () => ({
    choices: [{ message: { content: '{"unexpected":true}' } }],
  })).reviewRepository(sourceContext);
  assert.deepEqual(outcome, { status: 'FAILED', result: null, errorCode: 'INVALID_RESPONSE', attempts: 1 });
});

test('repository review retains provider HTTP status without exposing response bodies', async () => {
  const service = new NvidiaInvestigator({
    environment: { BUGZERO_ENABLE_EXTERNAL_AI: 'true', NVIDIA_API_KEY: 'server-only', NVIDIA_MODEL: 'test-model' },
    fetchImpl: async () => new Response('provider details must not be persisted', { status: 410 }),
  });
  assert.deepEqual(await service.reviewRepository(sourceContext), {
    status: 'FAILED',
    result: null,
    errorCode: 'PROVIDER_ERROR',
    providerStatus: 410,
    attempts: 1,
  });
});
