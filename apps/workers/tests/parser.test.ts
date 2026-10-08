import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWithLanguageAdapter, normalizeLanguage } from '../src/parser/language-adapters.js';

test('normalizeLanguage maps supported file types', () => {
  assert.equal(normalizeLanguage('python'), 'Python');
  assert.equal(normalizeLanguage('javascript'), 'JavaScript');
  assert.equal(normalizeLanguage('TypeScript'), 'TypeScript');
  assert.equal(normalizeLanguage('ruby'), 'UNKNOWN');
});

test('python adapter produces structured entities and relationships', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/service.py',
    language: 'Python',
    contentHash: 'a'.repeat(64),
    sourceContent: 'def main():\n    return 1\n',
  });

  assert.equal(result.status, 'PARSED');
  assert.equal(result.entityCount > 0, true);
  assert.equal(result.relationshipCount > 0, true);
  assert.equal(result.entities[0].kind, 'MODULE');
});

test('unsupported language does not report success', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/notes.rst',
    language: 'UNKNOWN',
    contentHash: 'b'.repeat(64),
    sourceContent: 'Example text',
  });

  assert.equal(result.status, 'UNSUPPORTED');
  assert.equal(result.entityCount, 0);
});

test('javascript adapter resolves declarations and reads', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/app.js',
    language: 'JavaScript',
    contentHash: 'c'.repeat(64),
    sourceContent: 'function render() { const data = 1; return data; }',
  });

  assert.equal(result.status, 'PARSED');
  assert.equal(result.relationships.some((relationship) => relationship.kind === 'DECLARES'), true);
  assert.equal(result.relationships.some((relationship) => relationship.kind === 'READS'), true);
});

test('TypeScript parser emits source-backed function boundaries, parameters, and exact direct calls', () => {
  const source = [
    'function caller(first: number, second: number, third: number, fourth: number, fifth: number, sixth: number, seventh: number, eighth: number) {',
    '  callee();',
    '}',
    'function callee() {}',
  ].join('\n');
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/service.ts',
    language: 'TypeScript',
    contentHash: 'd'.repeat(64),
    sourceContent: source,
  });
  const caller = result.entities.find((entity) => entity.name === 'caller');
  const parameters = result.entities.filter((entity) => entity.kind === 'PARAMETER' && entity.qualifiedName.startsWith(`${caller?.qualifiedName}.parameter:`));

  assert.equal(result.status, 'PARSED');
  assert.equal(caller?.startLine, 1);
  assert.equal(caller?.endLine, 3);
  assert.equal(parameters.length, 8);
  assert.equal(result.relationships.filter((relationship) => relationship.sourceEntityId === caller?.id && relationship.kind === 'DECLARES').length, 8);
  const callee = result.entities.find((entity) => entity.name === 'callee');
  assert.equal(result.relationships.some((relationship) =>
    relationship.sourceEntityId === caller?.id && relationship.targetEntityId === callee?.id && relationship.kind === 'CALLS' && relationship.resolution === 'EXACT'), true);
});

test('JavaScript parser does not resolve shadowed or ambiguous calls', () => {
  const source = [
    'function target() {}',
    'function one(target) { target(); }',
    'function target() { return; }',
    'function two() { target(); }',
  ].join('\n');
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/calls.js',
    language: 'JavaScript',
    contentHash: 'e'.repeat(64),
    sourceContent: source,
  });
  assert.equal(result.relationships.filter((relationship) => relationship.kind === 'CALLS').length, 0);
});

test('Python parser emits function boundaries, declared parameters, and direct same-file calls', () => {
  const source = [
    'def caller(first, second, third, fourth, fifth, sixth, seventh, eighth):',
    '    callee()',
    '',
    'def callee():',
    '    pass',
  ].join('\n');
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/service.py',
    language: 'Python',
    contentHash: 'f'.repeat(64),
    sourceContent: source,
  });
  const caller = result.entities.find((entity) => entity.name === 'caller');
  const callee = result.entities.find((entity) => entity.name === 'callee');
  const parameters = result.entities.filter((entity) => entity.kind === 'PARAMETER' && entity.qualifiedName.startsWith(`${caller?.qualifiedName}.parameter:`));

  assert.equal(result.status, 'PARSED');
  assert.equal(caller?.startLine, 1);
  assert.equal(caller?.endLine, 2);
  assert.equal(parameters.length, 8);
  assert.equal(result.relationships.some((relationship) =>
    relationship.sourceEntityId === caller?.id && relationship.targetEntityId === callee?.id && relationship.kind === 'CALLS' && relationship.resolution === 'EXACT'), true);
});

test('long function source spans preserve the inclusive threshold boundary', () => {
  const source = ['function longFunction() {', ...Array.from({ length: 98 }, () => '  value();'), '}'].join('\n');
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/long.ts',
    language: 'TypeScript',
    contentHash: '1'.repeat(64),
    sourceContent: source,
  });
  const fn = result.entities.find((entity) => entity.name === 'longFunction');
  assert.equal(fn?.startLine, 1);
  assert.equal(fn?.endLine, 100);
});
