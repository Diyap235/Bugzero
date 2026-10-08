export type RepositoryProviderKind = 'GITHUB';

export interface ProviderRepository {
  id: string;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  provider: RepositoryProviderKind;
}

export interface ProviderCommit {
  sha: string;
  parentSha: string | null;
  committedAt: string | null;
  authorName: string | null;
  authorEmail: string | null;
  message: string | null;
}

export interface RepositoryProvider {
  getRepository(input: { organizationId: string; repositoryId: string }): Promise<ProviderRepository>;
  getRepositoryByFullName(fullName: string): Promise<ProviderRepository>;
  getDefaultBranch(repository: ProviderRepository): Promise<string>;
  getCommit(repository: ProviderRepository, ref: string): Promise<ProviderCommit>;
}

export interface GitHubRepositoryProviderConfig {
  token?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GitHubRepositoryProvider implements RepositoryProvider {
  constructor(private readonly config: GitHubRepositoryProviderConfig = {}) {}

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  async getRepository(input: { organizationId: string; repositoryId: string }): Promise<ProviderRepository> {
    const repositoryUrl = `${this.config.apiUrl ?? 'https://api.github.com'}/repositories/${input.repositoryId}`;
    const response = await this.fetchImpl(repositoryUrl, {
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(`GitHub repository lookup failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      id?: number | string;
      full_name?: string;
      default_branch?: string;
      clone_url?: string;
      html_url?: string;
    };

    return {
      id: String(payload.id ?? input.repositoryId),
      fullName: payload.full_name ?? input.repositoryId,
      defaultBranch: payload.default_branch ?? 'main',
      cloneUrl: payload.clone_url ?? payload.html_url ?? '',
      provider: 'GITHUB',
    };
  }

  async getRepositoryByFullName(fullName: string): Promise<ProviderRepository> {
    const parts = fullName.split('/');
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]{1,39}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) {
      throw new Error('GitHub repository name is invalid');
    }
    const [owner, repositoryName] = parts;
    const response = await this.fetchImpl(
      `${this.config.apiUrl ?? 'https://api.github.com'}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}`,
      {
        headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : undefined,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`GitHub repository lookup failed: ${response.status}`);
    const payload = (await response.json()) as {
      id?: number | string;
      full_name?: string;
      default_branch?: string;
    };
    if (
      payload.id === undefined
      || typeof payload.full_name !== 'string'
      || typeof payload.default_branch !== 'string'
      || !/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(payload.full_name)
    ) {
      throw new Error('GitHub repository response was incomplete or invalid');
    }
    return {
      id: String(payload.id),
      fullName: payload.full_name,
      defaultBranch: payload.default_branch,
      cloneUrl: `https://github.com/${payload.full_name}.git`,
      provider: 'GITHUB',
    };
  }

  async getDefaultBranch(repository: ProviderRepository): Promise<string> {
    if (!repository.fullName) {
      return 'main';
    }

    const response = await this.fetchImpl(`${this.config.apiUrl ?? 'https://api.github.com'}/repos/${repository.fullName}`, {
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(`GitHub default branch lookup failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { default_branch?: string };
    return payload.default_branch ?? repository.defaultBranch ?? 'main';
  }

  async getCommit(repository: ProviderRepository, ref: string): Promise<ProviderCommit> {
    const response = await this.fetchImpl(`${this.config.apiUrl ?? 'https://api.github.com'}/repos/${repository.fullName}/commits/${encodeURIComponent(ref)}`, {
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(`GitHub commit lookup failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      sha?: string;
      commit?: {
        tree?: { sha?: string };
        author?: { date?: string | null; name?: string | null; email?: string | null };
        committer?: { date?: string | null; name?: string | null; email?: string | null };
        message?: string | null;
      };
      parents?: Array<{ sha?: string }>;
    };

    return {
      sha: payload.sha ?? ref,
      parentSha: payload.parents?.[0]?.sha ?? null,
      committedAt: payload.commit?.author?.date ?? payload.commit?.committer?.date ?? null,
      authorName: payload.commit?.author?.name ?? payload.commit?.committer?.name ?? null,
      authorEmail: payload.commit?.author?.email ?? payload.commit?.committer?.email ?? null,
      message: payload.commit?.message ?? null,
    };
  }
}
