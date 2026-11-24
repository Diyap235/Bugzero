import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWithLanguageAdapter, normalizeLanguage } from '../src/parser/language-adapters.js';

test('normalizeLanguage maps supported file types', () => {
  assert.equal(normalizeLanguage('python'), 'Python');
  assert.equal(normalizeLanguage('javascript'), 'JavaScript');
  assert.equal(normalizeLanguage('TypeScript'), 'TypeScript');
  assert.equal(normalizeLanguage('ruby'), 'UNKNOWN');
});

test('Python parser fully validates a simple function', () => {
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
  assert.deepEqual(result.diagnostics, []);
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

test('Python parser reports syntax errors with source locations', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/invalid.py',
    language: 'Python',
    contentHash: '5'.repeat(64),
    sourceContent: 'def broken():\n    if:\n        pass\n',
  });

  assert.equal(result.status, 'PARTIAL');
  assert.match(result.diagnostics.join(' '), /src\/invalid\.py:2:\d+: Python syntax error: invalid syntax/);
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

test('Python parser fully validates conditionals and loops inside functions', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/loops.py',
    language: 'Python',
    contentHash: '6'.repeat(64),
    sourceContent: [
      'def count(items):',
      '    total = 0',
      '    for item in items:',
      '        if item:',
      '            total += 1',
      '    while total > 10:',
      '        total -= 1',
      '    return total',
    ].join('\n'),
  });

  assert.equal(result.status, 'PARSED');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.entities.find((entity) => entity.name === 'count')?.endLine, 8);
});

test('Python parser fully validates classes, methods, and method parameters', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/greeter.py',
    language: 'Python',
    contentHash: '7'.repeat(64),
    sourceContent: [
      'class Greeter:',
      '    def greet(self, name):',
      "        return f'Hello, {name}'",
    ].join('\n'),
  });
  const greeter = result.entities.find((entity) => entity.name === 'Greeter');
  const greet = result.entities.find((entity) => entity.name === 'greet');
  const parameters = result.entities.filter((entity) =>
    entity.kind === 'PARAMETER' && entity.qualifiedName.startsWith(`${greet?.qualifiedName}.parameter:`));

  assert.equal(result.status, 'PARSED');
  assert.equal(greeter?.kind, 'CLASS');
  assert.equal(greet?.kind, 'METHOD');
  assert.equal(greet?.startLine, 2);
  assert.equal(greet?.endLine, 3);
  assert.deepEqual(parameters.map((parameter) => parameter.name), ['self', 'name']);
  assert.equal(result.relationships.some((relationship) =>
    relationship.sourceEntityId === greeter?.id && relationship.targetEntityId === greet?.id && relationship.kind === 'DECLARES'), true);
});

test('Python parser marks valid but unsupported constructs as partial', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/match.py',
    language: 'Python',
    contentHash: '8'.repeat(64),
    sourceContent: [
      'def choose(value):',
      '    match value:',
      '        case 1:',
      '            return True',
      '        case _:',
      '            return False',
    ].join('\n'),
  });

  assert.equal(result.status, 'PARTIAL');
  assert.match(result.diagnostics.join(' '), /src\/match\.py:2:5: Python Match construct is not fully represented in Code IR/);
  assert.equal(result.entities.some((entity) => entity.name === 'choose'), true);
});

test('parser entity IDs distinguish repeated declarations with the same qualified name', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/duplicate.ts',
    language: 'TypeScript',
    contentHash: '2'.repeat(64),
    sourceContent: 'function target() { return 1; }\nfunction target() { return 2; }',
  });
  const declarations = result.entities.filter((entity) => entity.name === 'target');

  assert.equal(declarations.length, 2);
  assert.notEqual(declarations[0]?.id, declarations[1]?.id);
  assert.equal(new Set(result.entities.map((entity) => entity.id)).size, result.entities.length);
  assert.equal(new Set(result.relationships.map((relationship) => relationship.id)).size, result.relationships.length);
});

test('Python parser preserves source offsets and line numbers for CRLF files', () => {
  const source = 'def first():\r\n    pass\r\n\r\ndef second():\r\n    pass\r\n';
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/windows.py',
    language: 'Python',
    contentHash: '3'.repeat(64),
    sourceContent: source,
  });
  const second = result.entities.find((entity) => entity.name === 'second');

  assert.equal(second?.startLine, 4);
  assert.equal(second?.endLine, 5);
  assert.equal(second?.provenance.sourceStart, source.indexOf('def second'));
  assert.equal(second?.provenance.sourceEnd, source.indexOf('    pass', source.indexOf('def second')) + '    pass'.length);
});

test('Python parser attributes nested function calls to the nested function', () => {
  const result = parseWithLanguageAdapter({
    repositoryId: '11111111-1111-4111-8111-111111111111',
    commitId: '22222222-2222-4222-8222-222222222222',
    filePath: 'src/nested.py',
    language: 'Python',
    contentHash: '4'.repeat(64),
    sourceContent: [
      'def outer():',
      '    def inner():',
      '        target()',
      '    return inner()',
      '',
      'def target():',
      '    pass',
    ].join('\n'),
  });
  const outer = result.entities.find((entity) => entity.name === 'outer');
  const inner = result.entities.find((entity) => entity.name === 'inner');
  const target = result.entities.find((entity) => entity.name === 'target');

  assert.ok(outer && inner && target);
  assert.equal(result.relationships.some((relationship) =>
    relationship.sourceEntityId === outer.id && relationship.targetEntityId === target.id && relationship.kind === 'CALLS'), false);
  assert.equal(result.relationships.some((relationship) =>
    relationship.sourceEntityId === inner.id && relationship.targetEntityId === target.id && relationship.kind === 'CALLS'), true);
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
