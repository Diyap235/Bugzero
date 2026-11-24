import type { AIRepositoryReviewContext } from '../investigation-types.js';

export interface RepositoryReviewSourceFile {
  path: string;
  content: string;
}

const MAX_FILES = 40;
const MAX_CONTEXT_CHARACTERS = 42_000;
const MAX_FILE_CHARACTERS = 6_000;
const MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'pipfile',
  'pipfile.lock',
]);

function isManifest(filePath: string): boolean {
  return MANIFEST_NAMES.has(filePath.split('/').at(-1)?.toLowerCase() ?? '');
}

function isSafePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.length > 0
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:/.test(normalized)
    && !normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    && !/(?:^|\/)\.env(?:\.|$)|secret|credential|private[-_]?key|(?:^|\/)\.npmrc$/i.test(normalized);
}

function redactSecrets(source: string): string {
  return source
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|client[_-]?secret)\b\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi, '$1"[REDACTED]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '******')
    .replace(/\b(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[REDACTED]@');
}

export function buildRepositoryReviewContext(input: {
  analysisStatus: AIRepositoryReviewContext['analysisStatus'];
  sourceFiles: RepositoryReviewSourceFile[];
  parsedFileCount: number;
}): AIRepositoryReviewContext {
  const eligible: AIRepositoryReviewContext['files'] = input.sourceFiles
    .filter((file) => isSafePath(file.path) && isManifest(file.path))
    .map((file) => ({ filePath: file.path, kind: 'DEPENDENCY_MANIFEST' as const, source: file.content }));
  const knownPaths = new Set(eligible.map((file) => file.filePath));
  for (const file of input.sourceFiles) {
    if (knownPaths.has(file.path) || !isSafePath(file.path)) continue;
    const extension = file.path.split('.').pop()?.toLowerCase();
    if (!['py', 'js', 'jsx', 'ts', 'tsx'].includes(extension ?? '')) continue;
    eligible.push({ filePath: file.path, kind: 'SOURCE', source: file.content });
    knownPaths.add(file.path);
  }
  const sourceFileCount = eligible.filter((file) => file.kind === 'SOURCE').length;
  const selected = eligible.slice(0, MAX_FILES);
  let remaining = MAX_CONTEXT_CHARACTERS;
  const files: AIRepositoryReviewContext['files'] = [];
  for (const file of selected) {
    if (remaining <= 0) break;
    const redactedSource = redactSecrets(file.source);
    const sourceLimit = Math.min(MAX_FILE_CHARACTERS, remaining);
    const source = redactedSource.slice(0, sourceLimit);
    if (source.length === 0) continue;
    files.push({ ...file, source, truncated: source.length < redactedSource.length });
    remaining -= source.length;
  }
  return {
    analysisStatus: input.analysisStatus,
    sourceFileCount,
    parsedFileCount: input.parsedFileCount,
    files,
  };
}
