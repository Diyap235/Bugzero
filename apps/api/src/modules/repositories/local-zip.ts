import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MemberRepository, RepositoryRepository } from '@bugzero/database';
import { LocalRepositoryUploadResponseSchema } from '@bugzero/contracts';
import type { AuthenticatedAnalysisPrincipal } from '../analysis/routes.js';
import yauzl from 'yauzl';

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2_000;
const MAX_SOURCE_FILE_BYTES = 1_000_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

interface LocalSourceFile {
  path: string;
  content: string;
  contentSha256: string;
  sizeBytes: number;
  language: string;
}

interface LocalZipDependencies {
  authenticate(request: FastifyRequest): Promise<AuthenticatedAnalysisPrincipal | null>;
  members: Pick<MemberRepository, 'getMembership'>;
  repositories: Pick<RepositoryRepository, 'createWithCommitAndFiles'>;
}

class InvalidLocalArchiveError extends Error {}

function languageForPath(filePath: string): string | null {
  switch (path.posix.extname(filePath).toLowerCase()) {
    case '.py': return 'Python';
    case '.js':
    case '.jsx': return 'JavaScript';
    case '.ts':
    case '.tsx': return 'TypeScript';
    default: return null;
  }
}

function toIsoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function validateArchivePath(fileName: string): string {
  if (
    fileName.length === 0
    || fileName.length > 200
    || fileName.startsWith('/')
    || fileName.includes('\\')
    || fileName.includes('\0')
    || /^[a-zA-Z]:/.test(fileName)
    || fileName.split('/').some((part) =>
      part.length > 100 || part === '' || part === '.' || part === '..'
      || /[<>:"|?*]/.test(part)
      || /[. ]$/.test(part)
      || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part))
  ) {
    throw new InvalidLocalArchiveError('The ZIP contains an unsafe file path');
  }
  return fileName;
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new InvalidLocalArchiveError('The ZIP contains an unreadable file'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_SOURCE_FILE_BYTES) {
          stream.destroy(new InvalidLocalArchiveError('A file exceeds the upload size limit'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (streamError: Error) => reject(streamError));
      stream.on('end', () => resolve(Buffer.concat(chunks, size)));
    });
  });
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

async function parseLocalArchive(archive: Buffer): Promise<LocalSourceFile[]> {
  if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new InvalidLocalArchiveError('The ZIP archive is empty or exceeds the upload size limit');
  }

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, {
      lazyEntries: true,
      autoClose: true,
      strictFileNames: false,
    }, (openError, zip) => {
      if (openError || !zip) {
        reject(new InvalidLocalArchiveError('The uploaded file is not a valid ZIP archive'));
        return;
      }

      const files: LocalSourceFile[] = [];
      const seenPaths = new Map<string, 'file' | 'directory'>();
      let entryCount = 0;
      let declaredTotalBytes = 0;
      let actualTotalBytes = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };

      zip.on('error', () => fail(new InvalidLocalArchiveError('The ZIP archive could not be read')));
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (files.length === 0) {
          reject(new InvalidLocalArchiveError('The ZIP must contain at least one supported source file'));
        } else {
          resolve(files);
        }
      });
      zip.on('entry', (entry) => {
        void (async () => {
          entryCount += 1;
          if (entryCount > MAX_ENTRY_COUNT) {
            throw new InvalidLocalArchiveError('The ZIP contains too many files');
          }
          if (entry.generalPurposeBitFlag & 0x1) {
            throw new InvalidLocalArchiveError('Encrypted ZIP entries are not supported');
          }
          const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
          const isDirectory = entry.fileName.endsWith('/');
          if (
            fileType === 0xa000
            || (fileType !== 0 && fileType !== (isDirectory ? 0x4000 : 0x8000))
          ) throw new InvalidLocalArchiveError('Unsupported ZIP entry types are not accepted');
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
            throw new InvalidLocalArchiveError('The ZIP contains invalid file metadata');
          }
          if (isDirectory && (entry.uncompressedSize !== 0 || entry.compressedSize !== 0)) {
            throw new InvalidLocalArchiveError('The ZIP contains invalid directory data');
          }
          declaredTotalBytes += entry.uncompressedSize;
          if (declaredTotalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
            throw new InvalidLocalArchiveError('The ZIP expands beyond the total upload size limit');
          }

          const entryPath = validateArchivePath(isDirectory ? entry.fileName.slice(0, -1) : entry.fileName);
          const foldedPath = entryPath.toLowerCase();
          const entryKind = isDirectory ? 'directory' : 'file';
          const existingKind = seenPaths.get(foldedPath);
          if (existingKind || [...seenPaths].some(([seenPath, kind]) =>
            kind === 'file' && foldedPath.startsWith(`${seenPath}/`)
            || entryKind === 'file' && seenPath.startsWith(`${foldedPath}/`))) {
            throw new InvalidLocalArchiveError('The ZIP contains duplicate or conflicting file paths');
          }
          for (const parent of foldedPath.split('/').slice(0, -1).reduce<string[]>((parents, _part, index, parts) => {
            parents.push(parts.slice(0, index + 1).join('/'));
            return parents;
          }, [])) {
            if (seenPaths.get(parent) === 'file') {
              throw new InvalidLocalArchiveError('The ZIP contains conflicting file and directory paths');
            }
          }
          seenPaths.set(foldedPath, entryKind);

          if (!isDirectory) {
            if (entry.uncompressedSize > MAX_SOURCE_FILE_BYTES) {
              throw new InvalidLocalArchiveError('A file exceeds the upload size limit');
            }
            const bytes = await readEntry(zip, entry);
            actualTotalBytes += bytes.length;
            if (
              bytes.length !== entry.uncompressedSize
              || actualTotalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES
              || crc32(bytes) !== entry.crc32
            ) {
              throw new InvalidLocalArchiveError('The ZIP contains corrupted or invalid file data');
            }

            const language = languageForPath(entryPath);
            const excluded = entryPath.split('/').some((part) =>
              ['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', 'coverage', '.next'].includes(part.toLowerCase()));
            if (language && !excluded) {
              if (bytes.includes(0)) {
                throw new InvalidLocalArchiveError('Source files must contain valid UTF-8 text');
              }
              let content: string;
              try {
                content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
              } catch {
                throw new InvalidLocalArchiveError('Source files must contain valid UTF-8 text');
              }
              files.push({
                path: entryPath,
                content,
                contentSha256: createHash('sha256').update(bytes).digest('hex'),
                sizeBytes: bytes.length,
                language,
              });
            }
          }
          zip.readEntry();
        })().catch((error: unknown) => {
          fail(error instanceof InvalidLocalArchiveError
            ? error
            : new InvalidLocalArchiveError('The ZIP contains an unreadable file'));
        });
      });
      zip.readEntry();
    });
  });
}

async function createGitSnapshot(files: LocalSourceFile[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bugzero-local-zip-'));
  const configPath = path.join(root, 'empty-git-config');
  try {
    const worktree = path.join(root, 'repository');
    await fs.mkdir(worktree);
    await fs.writeFile(configPath, '');
    for (const file of files) {
      const destination = path.join(worktree, ...file.path.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.content, { flag: 'wx' });
    }

    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: configPath,
      GIT_CONFIG_SYSTEM: configPath,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '0',
      HOME: root,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00+00:00',
      GIT_COMMITTER_DATE: '2000-01-01T00:00:00+00:00',
      TZ: 'UTC',
    };
    await execFileAsync('git', ['init', '--quiet', '--template='], { cwd: worktree, env, timeout: 15_000 });
    await execFileAsync('git', ['add', '--all'], { cwd: worktree, env, timeout: 15_000 });
    await execFileAsync('git', [
      '-c', 'user.name=BugZero Local Import',
      '-c', 'user.email=local-import@bugzero.invalid',
      '-c', `core.hooksPath=${path.join(root, 'empty-hooks')}`,
      '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'Import local ZIP snapshot', '--no-gpg-sign',
    ], { cwd: worktree, env, timeout: 15_000 });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktree, env, timeout: 15_000 });
    return stdout.trim();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function toRepository(repository: Awaited<ReturnType<RepositoryRepository['createWithCommitAndFiles']>>['repository']) {
  return {
    id: repository.id,
    organizationId: repository.organization_id,
    provider: repository.provider,
    externalId: repository.external_id,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
    cloneUrl: repository.clone_url,
    createdAt: toIsoDate(repository.created_at),
    updatedAt: toIsoDate(repository.updated_at),
  };
}

function toRevision(commit: Awaited<ReturnType<RepositoryRepository['createWithCommitAndFiles']>>['commit']) {
  return {
    id: commit.id,
    organizationId: commit.organization_id,
    repositoryId: commit.repository_id,
    commitSha: commit.commit_sha,
    parentCommitSha: commit.parent_commit_sha,
    createdAt: toIsoDate(commit.created_at),
    indexedAt: commit.indexed_at === null ? null : toIsoDate(commit.indexed_at),
  };
}

export function registerLocalZipRepositoryRoute(server: FastifyInstance, dependencies: LocalZipDependencies): void {
  server.post<{ Body: Buffer; Headers: { 'x-repository-name'?: string } }>(
    '/repositories/local-zip',
    async (request, reply) => {
      const principal = await dependencies.authenticate(request);
      if (!principal) return reply.code(401).send({ error: 'Authentication required' });
      const member = await dependencies.members.getMembership(principal.organizationId, principal.userId);
      if (!member) return reply.code(403).send({ error: 'Organization membership required' });
      if (!['OWNER', 'ADMIN', 'DEVELOPER'].includes(member.role)) {
        return reply.code(403).send({ error: 'Insufficient role to upload a repository' });
      }

      const name = request.headers['x-repository-name']?.trim();
      if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
        return reply.code(400).send({ error: 'A valid repository name is required' });
      }
      const externalId = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
      if (!externalId) return reply.code(400).send({ error: 'The repository name must contain a letter or number' });

      let files: LocalSourceFile[];
      try {
        files = await parseLocalArchive(request.body);
      } catch (error) {
        if (error instanceof InvalidLocalArchiveError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }

      const commitSha = await createGitSnapshot(files);
      const timestamp = new Date().toISOString();
      const registered = await dependencies.repositories.createWithCommitAndFiles({
        organizationId: principal.organizationId,
        provider: 'LOCAL',
        externalId,
        fullName: name,
        defaultBranch: 'main',
        cloneUrl: `local://${externalId}`,
        commitSha,
        committedAt: timestamp,
        indexedAt: timestamp,
        files: files.map(({ path: filePath, contentSha256, sizeBytes, language, content: sourceContent }) => ({
          path: filePath,
          contentSha256,
          sizeBytes,
          language,
          sourceContent,
        })),
      });

      const response = LocalRepositoryUploadResponseSchema.parse({
        repository: toRepository(registered.repository),
        revision: toRevision(registered.commit),
        filesPersisted: files.length,
        totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
        languages: [...new Set(files.map((file) => file.language))].sort(),
      });
      return reply.code(201).send(response);
    },
  );
}
