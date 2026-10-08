import assert from 'node:assert/strict';
import test from 'node:test';

import { GroqInvestigator } from '../src/ai/groq/groq-client.js';
import type { GroqCompletionTransport } from '../src/ai/groq/groq-client.js';
import type { AIInvestigationContext } from '../src/ai/groq/groq-types.js';

const validResult = {
  summary: 'A deterministic finding was reviewed.',
  explanation: 'The supplied evidence connects the finding to a source location.',
  attackPath: ['Review the source location in the finding.'],
  remediation: ['Inspect and correct the reported code.'],
  confidence: 'MEDIUM',
  reasoningStatus: 'SUPPORTED',
};

function context(overrides: Partial<AIInvestigationContext> = {}): AIInvestigationContext {
  return {
    analysisStatus: 'COMPLETED',
    finding: {
      ruleId: 'TEST_RULE',
      severity: 'MEDIUM',
      confidence: 'HIGH',
      filePath: 'src/example.ts',
      startLine: 4,
      endLine: 4,
    },
    evidence: {
      authority: 'AUTHORITATIVE',
      sufficiency: 'SUFFICIENT',
      completeness: 'COMPLETE',
      diagnostics: [],
      paths: [],
      nodes: [],
      edges: [],
    },
    languages: ['TypeScript'],
    sourceSnippets: [],
    ...overrides,
  };
}

function investigator(
  create: GroqCompletionTransport['create'],
): GroqInvestigator {
  return new GroqInvestigator({
    environment: { GROQ_API_KEY: 'test-only', GROQ_MODEL: 'test-model' },
    client: { create },
  });
}

test('Groq investigator remains optional without an API key', async () => {
  const result = await new GroqInvestigator({ environment: {} }).investigate(context());
  assert.deepEqual(result, {
    status: 'UNAVAILABLE',
    result: null,
    errorCode: 'MISSING_CONFIGURATION',
  });
});

test('Groq investigator rejects invalid configuration without calling the provider', async () => {
  let called = false;
  const invalid = new GroqInvestigator({
    environment: { GROQ_MODEL: 'invalid\nmodel' },
    client: {
      async create() {
        called = true;
        return {};
      },
    },
  });
  const result = await invalid.investigate(context());
  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'INVALID_CONFIGURATION');
  assert.equal(called, false);
});

test('Groq investigator requests bounded JSON and validates a structured response', async () => {
  let captured: { model: string; messages: Array<{ role: string; content: string }>; max_tokens: number } | undefined;
  const service = new GroqInvestigator({
    environment: { GROQ_API_KEY: 'test-only', GROQ_MODEL: 'test-model' },
    client: {
      async create(input) {
        captured = input;
        return { choices: [{ message: { content: JSON.stringify(validResult) } }] };
      },
    },
  });
  const result = await service.investigate(context());
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.result, validResult);
  assert.equal(captured?.model, 'test-model');
  assert.equal(captured?.max_tokens, 1200);
  assert.equal(captured?.messages[1]?.content.startsWith('<BUGZERO_EVIDENCE>\n'), true);
  assert.equal(captured?.messages[1]?.content.endsWith('\n</BUGZERO_EVIDENCE>'), true);
});

test('Groq investigator rejects malformed JSON and schema-invalid responses', async (t) => {
  for (const content of ['not-json', JSON.stringify({ ...validResult, extra: 'not allowed' })]) {
    await t.test(content, async () => {
      const result = await investigator(async () => ({
        choices: [{ message: { content } }],
      })).investigate(context());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'INVALID_RESPONSE');
    });
  }
});

test('Groq investigator maps timeout, rate limit, and provider errors safely', async (t) => {
  const cases: Array<{ name: string; error: Error & { status?: number }; expected: string }> = [
    { name: 'timeout', error: Object.assign(new Error('request aborted'), { name: 'AbortError' }), expected: 'TIMEOUT' },
    { name: 'rate limit', error: Object.assign(new Error('too many requests'), { status: 429 }), expected: 'RATE_LIMITED' },
    { name: 'provider', error: new Error('provider detail must not be returned'), expected: 'PROVIDER_ERROR' },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const result = await investigator(async () => {
        throw item.error;
      }).investigate(context());
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, item.expected);
      assert.equal(JSON.stringify(result).includes('provider detail'), false);
    });
  }
});

test('Groq investigator rejects context above the configured bound before provider invocation', async () => {
  let called = false;
  const result = await investigator(async () => {
    called = true;
    return { choices: [{ message: { content: JSON.stringify(validResult) } }] };
  }).investigate(context({
    sourceSnippets: [{ filePath: 'src/large.ts', startLine: 1, source: 'x'.repeat(20_001) }],
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.errorCode, 'CONTEXT_TOO_LARGE');
  assert.equal(called, false);
});

test('Groq cannot make incomplete or unresolved evidence look sufficient', async () => {
  const result = await investigator(async () => ({
    choices: [{ message: { content: JSON.stringify(validResult) } }],
  })).investigate(context({
    analysisStatus: 'PARTIAL',
    evidence: {
      authority: 'INVESTIGATIVE',
      sufficiency: 'UNKNOWN',
      completeness: 'INCOMPLETE',
      diagnostics: ['Unresolved call'],
      paths: [],
      nodes: [],
      edges: [],
    },
  }));
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.result.reasoningStatus, 'INSUFFICIENT_EVIDENCE');
});
