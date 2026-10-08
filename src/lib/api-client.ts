import type {
  AcceptedAnalysis,
  ApiReport,
  AnalysisRunStatusResponse,
  ApiRepository,
  FindingDetail,
  FindingRow,
  HealthHistoryEntry,
  RepositoryHistoryEntry,
  RepositoryOverview,
} from '@/domains/product/types';
import {
  AcceptedAnalysisSchema,
  AnalysisRunStatusResponseSchema,
  CreateAnalysisRequestSchema,
  RegisterAccountRequestSchema,
  SignInRequestSchema,
  AuthSessionResponseSchema,
  AuthenticatedSessionResponseSchema,
  LocalRepositoryUploadResponseSchema,
  ReportListResponseSchema,
  RepositorySchema,
} from '@bugzero/contracts';
import { getSession } from './auth/auth-service';

const API_BASE_URL = '/api/bugzero';
const REQUEST_TIMEOUT_MS = 5_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'SERVER_ERROR' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const session = authenticated ? getSession() : null;
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
          : response.status === 404 ? 'NOT_FOUND'
            : response.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR';
      if (code === 'UNAUTHORIZED' && typeof window !== 'undefined' && authenticated) {
        window.dispatchEvent(new Event('bugzero:unauthorized'));
      }
      throw new ApiError(message, response.status, code);
    }
    if (body === null) {
      throw new ApiError('The workspace returned an empty or invalid response', response.status, 'INVALID_RESPONSE');
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
  async login(email: string, password: string) {
    const requestBody = SignInRequestSchema.parse({ email, password });
    const body = await request<unknown>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    }, false);
    return AuthSessionResponseSchema.parse(body);
  },

  async registerAccount(input: {
    displayName: string;
    email: string;
    password: string;
    workspaceName: string;
  }) {
    const requestBody = RegisterAccountRequestSchema.parse(input);
    const body = await request<unknown>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    }, false);
    return AuthSessionResponseSchema.parse(body);
  },

  async getAuthenticatedSession() {
    const body = await request<unknown>('/auth/session');
    return AuthenticatedSessionResponseSchema.parse(body);
  },

  async listRepositories(): Promise<ApiRepository[]> {
    const result = await request<{ repositories: unknown[] }>('/repositories');
    return result.repositories.map((repository) => RepositorySchema.parse(repository));
  },

  async uploadLocalRepository(name: string, archive: File) {
    const response = await request<unknown>('/repositories/local-zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
        'X-Repository-Name': name,
      },
      body: archive,
    }, true, 60_000);
    return LocalRepositoryUploadResponseSchema.parse(response);
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
    return request<unknown>('/analysis', {
      method: 'POST',
      body: JSON.stringify(CreateAnalysisRequestSchema.parse({
        repositoryId,
        commitSha,
        profileId: 'default',
        scope: 'COMMIT',
        changedFiles: [],
        changedEntityIds: [],
      })),
    }, true, 15_000).then((result) => AcceptedAnalysisSchema.parse(result));
  },

  async uploadAndAnalyzeRepository(name: string, archive: File) {
    const upload = await bugzeroApi.uploadLocalRepository(name, archive);
    try {
      const analysis = await bugzeroApi.createAnalysis(upload.repository.id, upload.revision.commitSha);
      return { upload, analysis, analysisError: null };
    } catch (error) {
      return {
        upload,
        analysis: null,
        analysisError: error instanceof Error ? error : new Error('The analysis request could not be completed'),
      };
    }
  },

  getAnalysisStatus(analysisRunId: string): Promise<AnalysisRunStatusResponse> {
    return request<unknown>(`/analysis/${encodeURIComponent(analysisRunId)}`)
      .then((result) => AnalysisRunStatusResponseSchema.parse(result));
  },

  async getRepositoryReports(repositoryId: string): Promise<ApiReport[]> {
    const result = await request<unknown>(`/repositories/${encodeURIComponent(repositoryId)}/reports`);
    return ReportListResponseSchema.parse(result).reports;
  },
};