import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  RepositoryIngestionRequest,
  RepositoryIngestionResult,
  RepositoryFileSnapshot,
} from '@bugzero/contracts';
import {
  type RepositoryFileRepository,
  type RepositoryRepository,
  type CommitRepository,
} from '@bugzero/database';

import type { RepositoryProvider, ProviderCommit } from '../providers/github-provider.js';

const execFileAsync = promisify(execFile);

export class IngestionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

export interface IngestionOptions {
  maxFileSizeBytes?: number;
  maxFiles?: number;
  maxTotalBytes?: number;
  workspaceRoot?: string;
}

export function detectLanguageFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const extension = path.posix.extname(normalized);

  switch (extension) {
    case '.py':
      return 'Python';
    case '.js':
    case '.jsx':
      return 'JavaScript';
    case '.ts':
    case '.tsx':
      return 'TypeScript';
    default:
      return 'UNKNOWN';
  }
}

export function normalizeRepositoryRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const safe = path.posix.normalize(normalized);

  if (safe === '.' || safe === '') {
    return '';
  }

  if (safe.startsWith('../') || safe === '..' || safe.includes('..')) {
    throw new IngestionError('UNSAFE_PATH', `Unsafe repository path detected: ${filePath}`, { filePath });
  }

  return safe;
}

export function isGeneratedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const generatedMarkers = ['node_modules/', '__pycache__/', '.venv/', 'venv/', 'dist/', 'build/', 'coverage/', '.next/', '.git/'];

  return generatedMarkers.some((marker) => normalized.includes(marker));
}

export function isExcludedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const excludedRoots = ['.git/', 'node_modules/', '__pycache__/', '.venv/', 'venv/', 'dist/', 'build/', 'coverage/', '.next/'];

  return excludedRoots.some((marker) => normalized === marker || normalized.startsWith(marker));
}

export function hashFileContents(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function calculateLineCount(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  const content = buffer.toString('utf8');
  const lines = content.split(/\r\n|\r|\n/);
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

async function scanRepositoryTree(
  workspaceDir: string,
  options: Required<IngestionOptions>,
): Promise<{ files: RepositoryFileSnapshot[]; skippedFiles: string[]; generatedFiles: number; totalBytes: number }> {
  const files: RepositoryFileSnapshot[] = [];
  const skippedFiles: string[] = [];
  const queue = [workspaceDir];
  let totalBytes = 0;
  let discovered = 0;

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    const entries = await safeReadDir(currentDir);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) {
        continue;
      }

      const relativePath = normalizeRepositoryRelativePath(path.relative(workspaceDir, fullPath));
      if (relativePath === '') {
        continue;
      }

      if (stat.isDirectory()) {
        if (isExcludedPath(relativePath)) {
          continue;
        }

        queue.push(fullPath);
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      discovered += 1;
      if (discovered > options.maxFiles) {
        throw new IngestionError('FILE_LIMIT_EXCEEDED', `Repository file count exceeded the configured maximum (${options.maxFiles}).`, {
          discovered,
          maxFiles: options.maxFiles,
        });
      }

      const buffer = await fs.readFile(fullPath);
      const sizeBytes = buffer.length;
      totalBytes += sizeBytes;
      if (totalBytes > options.maxTotalBytes) {
        throw new IngestionError('SIZE_LIMIT_EXCEEDED', `Repository total size exceeded the configured maximum (${options.maxTotalBytes}).`, {
          discovered,
          totalBytes,
          maxTotalBytes: options.maxTotalBytes,
        });
      }

      if (sizeBytes > options.maxFileSizeBytes) {
        skippedFiles.push(relativePath);
        continue;
      }

      if (isExcludedPath(relativePath)) {
        skippedFiles.push(relativePath);
        continue;
      }

      const isGenerated = isGeneratedFile(relativePath);
      const language = detectLanguageFromPath(relativePath);
      files.push({
        path: relativePath,
        language,
        contentHash: hashFileContents(buffer),
        sizeBytes,
        lineCount: calculateLineCount(buffer),
        isGenerated,
      });
    }
  }

  return {
    files,
    skippedFiles,
    generatedFiles: files.filter((file) => file.isGenerated).length,
    totalBytes,
  };
}

export interface IngestionServiceDependencies {
  provider: RepositoryProvider;
  repositoryRepository: RepositoryRepository;
  commitRepository: CommitRepository;
  repositoryFileRepository: RepositoryFileRepository;
  options?: IngestionOptions;
}

export class IngestionService {
  private readonly options: Required<IngestionOptions>;

  constructor(private readonly dependencies: IngestionServiceDependencies) {
    this.options = {
      maxFileSizeBytes: dependencies.options?.maxFileSizeBytes ?? 10 * 1024 * 1024,
      maxFiles: dependencies.options?.maxFiles ?? 2000,
      maxTotalBytes: dependencies.options?.maxTotalBytes ?? 200 * 1024 * 1024,
      workspaceRoot: dependencies.options?.workspaceRoot ?? os.tmpdir(),
    };
  }

  async ingest(request: RepositoryIngestionRequest): Promise<RepositoryIngestionResult> {
    const startedAt = Date.now();
    const repository = await this.dependencies.repositoryRepository.getById(request.organizationId, request.repositoryId);
    if (!repository) {
      throw new IngestionError('REPOSITORY_NOT_FOUND', `Repository ${request.repositoryId} was not found for organization ${request.organizationId}.`, {
        organizationId: request.organizationId,
        repositoryId: request.repositoryId,
      });
    }

    const providerRepository = await this.dependencies.provider.getRepository({
      organizationId: request.organizationId,
      repositoryId: request.repositoryId,
    });

    const targetRef = request.commitSha ?? request.branch ?? (await this.dependencies.provider.getDefaultBranch(providerRepository));
    const providerCommit = await this.dependencies.provider.getCommit(providerRepository, targetRef);
    const resolvedCommitSha = providerCommit.sha || targetRef;

    const existingCommit = await this.dependencies.commitRepository.getByCommitSha(request.organizationId, request.repositoryId, resolvedCommitSha);
    if (existingCommit) {
      return {
        repositoryId: request.repositoryId,
        commitId: existingCommit.id,
        commitSha: resolvedCommitSha,
        filesDiscovered: 0,
        filesPersisted: 0,
        totalBytes: 0,
        languages: [],
        skippedFiles: [],
        generatedFiles: 0,
        durationMs: Date.now() - startedAt,
        status: 'REUSED',
      };
    }

    const commitRecord = await this.dependencies.commitRepository.create({
      organizationId: request.organizationId,
      repositoryId: request.repositoryId,
      commitSha: resolvedCommitSha,
      parentCommitSha: providerCommit.parentSha,
      committedAt: providerCommit.committedAt,
      indexedAt: new Date().toISOString(),
    });

    const workspaceDir = await fs.mkdtemp(path.join(this.options.workspaceRoot, 'bugzero-ingest-'));
    const cleanup = async (): Promise<void> => {
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } catch {
        // no-op: cleanup is best effort for temp workers
      }
    };

    try {
      const cloneUrl = providerRepository.cloneUrl || repository.clone_url || repository.full_name;
      await gitClone(cloneUrl, workspaceDir);
      await checkoutCommit(workspaceDir, resolvedCommitSha);

      const { files, skippedFiles, generatedFiles, totalBytes } = await scanRepositoryTree(workspaceDir, this.options);

      let persistedFiles = 0;
      const languageSet = new Set<string>();
      for (const file of files) {
        languageSet.add(file.language);
        await this.dependencies.repositoryFileRepository.create({
          organizationId: request.organizationId,
          repositoryId: request.repositoryId,
          commitId: commitRecord.id,
          path: file.path,
          contentSha256: file.contentHash,
          sizeBytes: file.sizeBytes,
          language: file.language === 'UNKNOWN' ? 'UNKNOWN' : file.language,
          objectKey: null,
        });
        persistedFiles += 1;
      }

      return {
        repositoryId: request.repositoryId,
        commitId: commitRecord.id,
        commitSha: resolvedCommitSha,
        filesDiscovered: files.length + skippedFiles.length,
        filesPersisted: persistedFiles,
        totalBytes,
        languages: Array.from(languageSet).sort(),
        skippedFiles,
        generatedFiles,
        durationMs: Date.now() - startedAt,
        status: 'SUCCESS',
      };
    } catch (error) {
      const typedError = error as Error & { code?: string };
      const code = typedError.code ?? 'WORKSPACE_ERROR';
      throw new IngestionError(code, typedError.message ?? 'Repository ingestion failed.', {
        repositoryId: request.repositoryId,
        commitSha: resolvedCommitSha,
      });
    } finally {
      await cleanup();
    }
  }
}

async function gitClone(cloneUrl: string, destination: string): Promise<void> {
  try {
    await execFileAsync('git', ['clone', '--filter=blob:none', '--no-checkout', cloneUrl, destination], { cwd: os.tmpdir() });
  } catch (error) {
    throw new IngestionError('CLONE_FAILED', `Repository clone failed for ${cloneUrl}.`, error);
  }
}

async function checkoutCommit(workspaceDir: string, commitSha: string): Promise<void> {
  try {
    await execFileAsync('git', ['-C', workspaceDir, 'fetch', '--depth', '1', 'origin', commitSha], { cwd: workspaceDir });
    await execFileAsync('git', ['-C', workspaceDir, 'checkout', commitSha], { cwd: workspaceDir });
  } catch (error) {
    throw new IngestionError('CHECKOUT_FAILED', `Unable to checkout commit ${commitSha} in the temporary workspace.`, error);
  }
}

export type ProviderCommitMetadata = ProviderCommit;
