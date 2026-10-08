import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateLineCount,
  detectLanguageFromPath,
  hashFileContents,
  isGeneratedFile,
  normalizeRepositoryRelativePath,
} from '../src/jobs/ingest-repository.js';

test('detectLanguageFromPath identifies supported extensions', () => {
  assert.equal(detectLanguageFromPath('src/app.py'), 'Python');
  assert.equal(detectLanguageFromPath('src/app.js'), 'JavaScript');
  assert.equal(detectLanguageFromPath('src/app.tsx'), 'TypeScript');
  assert.equal(detectLanguageFromPath('README.md'), 'UNKNOWN');
});

test('isGeneratedFile flags obvious generated output', () => {
  assert.equal(isGeneratedFile('dist/index.js'), true);
  assert.equal(isGeneratedFile('src/app.ts'), false);
  assert.equal(isGeneratedFile('node_modules/package/index.js'), true);
});

test('normalizeRepositoryRelativePath strips unsafe separators', () => {
  assert.equal(normalizeRepositoryRelativePath('src\\app\\main.ts'), 'src/app/main.ts');
  assert.equal(normalizeRepositoryRelativePath('./src/app.ts'), 'src/app.ts');
  assert.throws(() => normalizeRepositoryRelativePath('../secret.txt'));
});

test('hashFileContents returns sha256 digests and calculates line counts', () => {
  const buffer = Buffer.from('alpha\nbeta\n');
  assert.equal(hashFileContents(buffer), 'e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee');
  assert.equal(calculateLineCount(buffer), 2);
});
