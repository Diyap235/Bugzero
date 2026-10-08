import type {
  AcceptedAnalysis,
  AnalysisRunStatusResponse,
  ApiRepository,
  FindingDetail,
  FindingRow,
  HealthHistoryEntry,
  RepositoryHistoryEntry,
  RepositoryOverview,
} from '@/domains/product/types';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 5_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'HTTP_ERROR' | 'NETWORK_ERROR',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && 'error' in body
        && typeof body.error === 'string'
        ? body.error
        : `Workspace request failed (${response.status})`;
      const code = response.status === 401 ? 'UNAUTHORIZED'
        : response.status === 403 ? 'FORBIDDEN'
          : response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      throw new ApiError(message, response.status, code);
    }
    if (body === null) {
      throw new ApiError('The workspace returned an empty or invalid response', response.status, 'HTTP_ERROR');
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const detail = controller.signal.aborted
      ? 'The request timed out'
      : error instanceof Error ? error.message : 'The request failed';
    throw new ApiError(`The workspace could not be loaded: ${detail}`, 0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }
}

export const bugzeroApi = {
  async listRepositories(): Promise<ApiRepository[]> {
    const result = await request<{ repositories: ApiRepository[] }>('/repositories');
    return result.repositories;
  },

  async checkConnection(): Promise<void> {
    await request<{ repositories: ApiRepository[] }>('/repositories');
  },

  getRepository(repositoryId: string): Promise<RepositoryOverview> {
    return request<RepositoryOverview>(`/repositories/${encodeURIComponent(repositoryId)}`);
  },

  async getRepositoryHistory(repositoryId: string): Promise<RepositoryHistoryEntry[]> {
    const result = await request<{ history: RepositoryHistoryEntry[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/history`,
    );
    return result.history;
  },

  async getRepositoryFindings(repositoryId: string): Promise<FindingRow[]> {
    const result = await request<{ findings: FindingRow[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/findings`,
    );
    return result.findings;
  },

  getFinding(findingId: string): Promise<FindingDetail> {
    return request<FindingDetail>(`/findings/${encodeURIComponent(findingId)}`);
  },

  async getHealthHistory(repositoryId: string): Promise<HealthHistoryEntry[]> {
    const result = await request<{ history: HealthHistoryEntry[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/health`,
    );
    return result.history;
  },

  createAnalysis(repositoryId: string, commitSha: string): Promise<AcceptedAnalysis> {
    return request<AcceptedAnalysis>('/analysis', {
      method: 'POST',
      body: JSON.stringify({
        repositoryId,
        commitSha,
        profileId: 'default',
        scope: 'COMMIT',
        changedFiles: [],
        changedEntityIds: [],
      }),
    });
  },

  getAnalysisStatus(analysisRunId: string): Promise<AnalysisRunStatusResponse> {
    return request<AnalysisRunStatusResponse>(`/analysis/${encodeURIComponent(analysisRunId)}`);
  },
};