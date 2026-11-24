import type {
  AcceptedAnalysis,
  ApiReport,
  ApiReportDocument,
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
  AcceptOrganizationInvitationRequestSchema,
  AnalysisRunStatusResponseSchema,
  CreateOrganizationInvitationRequestSchema,
  CreateOrganizationInvitationResponseSchema,
  CreateAnalysisRequestSchema,
  ListOrganizationInvitationsResponseSchema,
  RegisterAccountRequestSchema,
  SignInRequestSchema,
  AuthSessionResponseSchema,
  AuthenticatedSessionResponseSchema,
  LocalRepositoryUploadResponseSchema,
  ReportListResponseSchema,
  ReportDocumentResponseSchema,
  RepositorySchema,
} from '@bugzero/contracts';
import type { OrganizationInvitationRole } from '@bugzero/contracts';
import { getSession } from './auth/auth-service';
import {
  clearCachedData,
  invalidateRepositoryData,
  invalidateRepositoryListData,
  getAnalysisRepository,
  loadCachedData,
  registerAnalysisRepository,
} from './data-cache';

const API_BASE_URL = '/api/bugzero';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RESPONSE_TTL_MS = 10_000;
const SECURITY_RESPONSE_TTL_MS = 5_000;
type AnalysisScope = ReturnType<typeof CreateAnalysisRequestSchema.parse>['scope'];

function responseTtl(path: string): number {
  if (path.endsWith('/findings') || path.startsWith('/findings/') || path.endsWith('/health')) {
    return SECURITY_RESPONSE_TTL_MS;
  }
  if (path === '/repositories' || path.startsWith('/repositories/')) return 15_000;
  return DEFAULT_RESPONSE_TTL_MS;
}

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
  cacheResponse = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const session = authenticated ? getSession() : null;
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);
  const load = async (): Promise<T> => {
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
          clearCachedData();
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
  };
  const method = (init.method ?? 'GET').toUpperCase();
  return session && cacheResponse && method === 'GET'
    ? loadCachedData(session.accessToken, `api:${path}`, load, responseTtl(path))
    : load();
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

  async createOrganizationInvitation(input: { email: string; role: OrganizationInvitationRole }) {
    const requestBody = CreateOrganizationInvitationRequestSchema.parse(input);
    const body = await request<unknown>('/organizations/invitations', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    }, true, REQUEST_TIMEOUT_MS, false);
    return CreateOrganizationInvitationResponseSchema.parse(body);
  },

  async listOrganizationInvitations() {
    const body = await request<unknown>('/organizations/invitations', {}, true, REQUEST_TIMEOUT_MS, false);
    return ListOrganizationInvitationsResponseSchema.parse(body).invitations;
  },

  async acceptOrganizationInvitation(input: { organizationId: string; token: string }) {
    const requestBody = AcceptOrganizationInvitationRequestSchema.parse(input);
    const body = await request<unknown>('/organizations/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    }, true, REQUEST_TIMEOUT_MS, false);
    return AuthSessionResponseSchema.parse(body);
  },

  async getAuthenticatedSession() {
    const body = await request<unknown>('/auth/session', {}, true, REQUEST_TIMEOUT_MS, false);
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
    const upload = LocalRepositoryUploadResponseSchema.parse(response);
    const session = getSession();
    if (session) invalidateRepositoryListData(session.accessToken);
    return upload;
  },

  async checkConnection(): Promise<void> {
    await request<{ repositories: ApiRepository[] }>('/repositories');
  },

  getRepository(repositoryId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<RepositoryOverview> {
    return request<RepositoryOverview>(`/repositories/${encodeURIComponent(repositoryId)}`, {}, true, timeoutMs);
  },

  async getRepositoryHistory(repositoryId: string): Promise<RepositoryHistoryEntry[]> {
    const result = await request<{ history: RepositoryHistoryEntry[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/history`,
    );
    return result.history;
  },

  async getRepositoryFindings(repositoryId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<FindingRow[]> {
    const result = await request<{ findings: FindingRow[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/findings`,
      {},
      true,
      timeoutMs,
    );
    return result.findings;
  },

  getFinding(findingId: string): Promise<FindingDetail> {
    return request<FindingDetail>(`/findings/${encodeURIComponent(findingId)}`);
  },

  async getHealthHistory(repositoryId: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<HealthHistoryEntry[]> {
    const result = await request<{ history: HealthHistoryEntry[] }>(
      `/repositories/${encodeURIComponent(repositoryId)}/health`,
      {},
      true,
      timeoutMs,
    );
    return result.history;
  },

  async createAnalysis(
    repositoryId: string,
    commitSha: string,
    scope: AnalysisScope = 'COMMIT',
  ): Promise<AcceptedAnalysis> {
    const result = await request<unknown>('/analysis', {
      method: 'POST',
      body: JSON.stringify(CreateAnalysisRequestSchema.parse({
        repositoryId,
        commitSha,
        profileId: 'default',
        scope,
        changedFiles: [],
        changedEntityIds: [],
      })),
    }, true, 15_000);
    const accepted = AcceptedAnalysisSchema.parse(result);
    const session = getSession();
    if (session) {
      registerAnalysisRepository(session.accessToken, accepted.analysisRunId, repositoryId);
      invalidateRepositoryData(session.accessToken, repositoryId);
    }
    return accepted;
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

  async getAnalysisStatus(analysisRunId: string): Promise<AnalysisRunStatusResponse> {
    const result = await request<unknown>(
      `/analysis/${encodeURIComponent(analysisRunId)}`,
      {},
      true,
      REQUEST_TIMEOUT_MS,
      false,
    );
    const status = AnalysisRunStatusResponseSchema.parse(result);
    const session = getSession();
    if (session && ['COMPLETED', 'PARTIAL', 'FAILED', 'UNAVAILABLE'].includes(status.status)) {
      const repositoryId = getAnalysisRepository(session.accessToken, analysisRunId);
      if (repositoryId) invalidateRepositoryData(session.accessToken, repositoryId);
    }
    return status;
  },

  async getRepositoryReports(repositoryId: string): Promise<ApiReport[]> {
    const result = await request<unknown>(`/repositories/${encodeURIComponent(repositoryId)}/reports`);
    return ReportListResponseSchema.parse(result).reports;
  },

  async generateRepositoryReport(repositoryId: string, analysisRunId: string): Promise<ApiReportDocument> {
    const result = await request<unknown>(`/repositories/${encodeURIComponent(repositoryId)}/reports`, {
      method: 'POST',
      body: JSON.stringify({ analysisRunId }),
    }, true, REQUEST_TIMEOUT_MS, false);
    return ReportDocumentResponseSchema.parse(result).report;
  },

  async getReport(reportId: string): Promise<ApiReportDocument> {
    const result = await request<unknown>(`/reports/${encodeURIComponent(reportId)}`);
    return ReportDocumentResponseSchema.parse(result).report;
  },
};