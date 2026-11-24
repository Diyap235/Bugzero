import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { bugzeroApi, ApiError } from "../src/lib/api-client";
import { clearSession, setSession } from "../src/lib/auth/auth-service";
import {
  clearCachedData,
  getCachedData,
  getStaleCachedData,
  invalidateCachedData,
  invalidatePageData,
  invalidateRepositoryData,
  invalidateRepositoryListData,
  loadCachedData,
  setCachedData,
} from "../src/lib/data-cache";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const storage = new Map<string, string>();
const events: string[] = [];
const sessionStorageMock: Storage = {
  get length() { return storage.size; },
  clear() { storage.clear(); },
  getItem(key) { return storage.get(key) ?? null; },
  key(index) { return [...storage.keys()][index] ?? null; },
  removeItem(key) { storage.delete(key); },
  setItem(key, value) { storage.set(key, String(value)); },
};

function installWindow(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: sessionStorageMock,
      dispatchEvent(event: Event) {
        events.push(event.type);
        return true;
      },
    },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCachedData();
  storage.clear();
  events.length = 0;
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("login uses the backend endpoint without forwarding a previous token", async () => {
  installWindow();
  setSession({
    accessToken: "header.old-token.signature",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "old@bugzero.dev", role: "DEVELOPER" },
  });
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      accessToken: "header.verified-token.signature",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_000_900,
      user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "DEVELOPER" },
    });
  };

  const session = await bugzeroApi.login("member@bugzero.dev", "local-password");

  assert.equal(request?.url, "http://localhost/api/bugzero/auth/login");
  assert.equal(request?.headers.has("Authorization"), false);
  assert.deepEqual(await request?.json(), { email: "member@bugzero.dev", password: "local-password" });
  assert.equal(session.user.role, "DEVELOPER");
});

test("registration creates an account and workspace without forwarding a previous token", async () => {
  installWindow();
  setSession({
    accessToken: "header.old-token.signature",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "old@bugzero.dev", role: "OWNER" },
  });
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      accessToken: "header.new-token.signature",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
    });
  };

  const result = await bugzeroApi.registerAccount({
    displayName: "New Member",
    email: "member@bugzero.dev",
    password: "abcd",
    workspaceName: "Example Workspace",
  });

  assert.equal(request?.url, "http://localhost/api/bugzero/auth/signup");
  assert.equal(request?.headers.has("Authorization"), false);
  assert.deepEqual(await request?.json(), {
    displayName: "New Member",
    email: "member@bugzero.dev",
    password: "abcd",
    workspaceName: "Example Workspace",
  });
  assert.equal(result.user.role, "OWNER");
});

test("registration rejects three-character passwords and accepts four and twelve characters", async () => {
  installWindow();
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json({
      accessToken: "header.new-token.signature",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
    });
  };
  const registration = {
    displayName: "New Member",
    email: "member@bugzero.dev",
    workspaceName: "Example Workspace",
  };

  await assert.rejects(bugzeroApi.registerAccount({ ...registration, password: "abc" }));
  assert.equal(requestCount, 0);
  await bugzeroApi.registerAccount({ ...registration, password: "abcd" });
  await bugzeroApi.registerAccount({ ...registration, password: "abcdefghijkl" });
  assert.equal(requestCount, 2);
});

test("invitation creation is authenticated and listing never returns a token", async () => {
  installWindow();
  setSession({
    accessToken: "header.manager-token.signature",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "owner@bugzero.dev", role: "OWNER" },
  });
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    requests.push(request);
    if (request.method === "POST") {
      return Response.json({
        invitation: {
          id: "44444444-4444-4444-8444-444444444444",
          organizationId: "11111111-1111-4111-8111-111111111111",
          email: "invitee@bugzero.dev",
          role: "DEVELOPER",
          status: "PENDING",
          expiresAt: "2026-11-21T00:00:00.000Z",
          createdAt: "2026-11-14T00:00:00.000Z",
          acceptedAt: null,
        },
        token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      });
    }
    return Response.json({
      invitations: [{
        id: "44444444-4444-4444-8444-444444444444",
        organizationId: "11111111-1111-4111-8111-111111111111",
        email: "invitee@bugzero.dev",
        role: "DEVELOPER",
        status: "PENDING",
        expiresAt: "2026-11-21T00:00:00.000Z",
        createdAt: "2026-11-14T00:00:00.000Z",
        acceptedAt: null,
      }],
    });
  };

  const created = await bugzeroApi.createOrganizationInvitation({ email: "invitee@bugzero.dev", role: "DEVELOPER" });
  const listed = await bugzeroApi.listOrganizationInvitations();

  assert.equal(requests[0]?.url, "http://localhost/api/bugzero/organizations/invitations");
  assert.equal(requests[0]?.headers.get("Authorization"), "Bearer header.manager-token.signature");
  assert.deepEqual(await requests[0]?.json(), { email: "invitee@bugzero.dev", role: "DEVELOPER" });
  assert.equal(created.token, "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
  assert.equal(requests[1]?.url, "http://localhost/api/bugzero/organizations/invitations");
  assert.equal(JSON.stringify(listed).includes(created.token), false);
});

test("invitation acceptance sends the token in an authenticated body, never the request URL", async () => {
  installWindow();
  setSession({
    accessToken: "header.invitee-token.signature",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "invitee@bugzero.dev", role: "OWNER" },
  });
  const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      accessToken: "header.target-org-token.signature",
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_003_600,
      user: {
        userId: "33333333-3333-4333-8333-333333333333",
        email: "invitee@bugzero.dev",
        role: "DEVELOPER",
      },
    });
  };

  const session = await bugzeroApi.acceptOrganizationInvitation({
    organizationId: "11111111-1111-4111-8111-111111111111",
    token,
  });

  assert.equal(request?.url, "http://localhost/api/bugzero/organizations/invitations/accept");
  assert.equal(request?.url.includes(token), false);
  assert.equal(request?.headers.get("Authorization"), "Bearer header.invitee-token.signature");
  assert.deepEqual(await request?.json(), {
    organizationId: "11111111-1111-4111-8111-111111111111",
    token,
  });
  assert.equal(session.user.role, "DEVELOPER");
});

test("session restore sends the persisted token and parses the workspace membership", async () => {
  installWindow();
  setSession({
    accessToken: "header.verified-token.signature",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      user: {
        userId: "33333333-3333-4333-8333-333333333333",
        email: "member@bugzero.dev",
        displayName: "Member",
        role: "OWNER",
      },
      workspace: {
        organizationId: "11111111-1111-4111-8111-111111111111",
        name: "Member workspace",
      },
    });
  };

  const result = await bugzeroApi.getAuthenticatedSession();

  assert.equal(request?.url, "http://localhost/api/bugzero/auth/session");
  assert.equal(request?.headers.get("Authorization"), "Bearer header.verified-token.signature");
  assert.equal(result.workspace.name, "Member workspace");
});

test("session validation is never served from the workspace response cache", async () => {
  installWindow();
  setSession({
    accessToken: "header.verified-token.signature",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      user: {
        userId: "33333333-3333-4333-8333-333333333333",
        email: "member@bugzero.dev",
        displayName: "Member",
        role: "OWNER",
      },
      workspace: {
        organizationId: "11111111-1111-4111-8111-111111111111",
        name: "Member workspace",
      },
    });
  };

  await bugzeroApi.getAuthenticatedSession();
  await bugzeroApi.getAuthenticatedSession();
  assert.equal(calls, 2, "revoked sessions must not be kept valid by cached authentication responses");
});

test("API errors distinguish authentication, authorization, missing resources, and server failures", async () => {
  installWindow();
  const cases = [
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [500, "SERVER_ERROR"],
  ] as const;

  for (const [status, code] of cases) {
    globalThis.fetch = async () => Response.json({ error: "Internal error", stack: "never render this" }, { status });
    await assert.rejects(bugzeroApi.listRepositories(), (error: unknown) =>
      error instanceof ApiError && error.code === code && !error.message.includes("stack"));
  }
  assert.deepEqual(events, ["bugzero:unauthorized"]);
});

test("repository requests accept valid backend responses that take longer than five seconds", async () => {
  installWindow();
  setSession({
    accessToken: "verified.backend.token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    return Response.json({ repositories: [] });
  };

  assert.deepEqual(await bugzeroApi.listRepositories(), []);
});

test("repository responses are reused, explicitly invalidated, and isolated by session", async () => {
  installWindow();
  setSession({
    accessToken: "verified.first-session.token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "first@bugzero.dev", role: "OWNER" },
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ repositories: [] });
  };

  await bugzeroApi.listRepositories();
  await bugzeroApi.listRepositories();
  assert.equal(calls, 1, "unchanged data should be reused within the same session");

  invalidateCachedData("verified.first-session.token");
  await bugzeroApi.listRepositories();
  assert.equal(calls, 2, "explicit invalidation should fetch current data");

  setSession({
    accessToken: "verified.second-session.token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "44444444-4444-4444-8444-444444444444", email: "second@bugzero.dev", role: "OWNER" },
  });
  await bugzeroApi.listRepositories();
  assert.equal(calls, 3, "a different session must never reuse a prior session's response");
});

test("expired response data is reused only as stale UI data and refreshed once per session key", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    const first = loadCachedData("tenant-one.session", "page:findings", load, 50);
    const duplicate = loadCachedData("tenant-one.session", "page:findings", load, 50);

    assert.equal(first, duplicate, "concurrent navigation should share the in-flight request");
    assert.equal(await first, 1);
    assert.equal(getCachedData("tenant-one.session", "page:findings"), 1);

    now += 51;
    assert.equal(getCachedData("tenant-one.session", "page:findings"), undefined);
    assert.equal(getStaleCachedData("tenant-one.session", "page:findings"), 1);
    assert.equal(await loadCachedData("tenant-one.session", "page:findings", load, 50), 2);
    assert.equal(calls, 2, "expired data must be refreshed instead of served indefinitely");
    assert.equal(getStaleCachedData("tenant-two.session", "page:findings"), undefined);
  } finally {
    Date.now = originalNow;
  }
});

test("security findings responses are reused briefly and then fetched fresh", async () => {
  installWindow();
  setSession({
    accessToken: "findings.freshness.session",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ findings: [] });
  };

  try {
    const repositoryId = "22222222-2222-4222-8222-222222222222";
    await bugzeroApi.getRepositoryFindings(repositoryId);
    await bugzeroApi.getRepositoryFindings(repositoryId);
    assert.equal(calls, 1);

    now += 5_001;
    await bugzeroApi.getRepositoryFindings(repositoryId);
    assert.equal(calls, 2, "security findings should not be cached beyond the short freshness window");
  } finally {
    Date.now = originalNow;
  }
});

test("refreshing one page invalidates its data without discarding unrelated cached resources", () => {
  const scope = "page-refresh.session";
  setCachedData(scope, "page:health", ["stale health"]);
  setCachedData(scope, "api:/repositories", { repositories: [] });
  setCachedData(scope, "api:/repositories/repo-1/health", { history: [] });
  setCachedData(scope, "api:/repositories/repo-2/health", { history: [] });
  setCachedData(scope, "api:/repositories/repo-1/findings", { findings: [] });
  setCachedData(scope, "page:findings", ["cached findings"]);
  setCachedData(scope, "view:findings:search", "AUTH");

  invalidatePageData(scope, "health");

  assert.equal(getCachedData(scope, "page:health"), undefined);
  assert.equal(getCachedData(scope, "api:/repositories"), undefined);
  assert.equal(getCachedData(scope, "api:/repositories/repo-1/health"), undefined);
  assert.equal(getCachedData(scope, "api:/repositories/repo-2/health"), undefined);
  assert.deepEqual(getCachedData(scope, "api:/repositories/repo-1/findings"), { findings: [] });
  assert.deepEqual(getCachedData(scope, "page:findings"), ["cached findings"]);
  assert.equal(getCachedData(scope, "view:findings:search"), "AUTH");
});

test("history page invalidation is scoped to its selected repository", () => {
  const scope = "history-page.session";
  setCachedData(scope, "page:history:repo-1", ["repo 1 history"]);
  setCachedData(scope, "page:history:repo-2", ["repo 2 history"]);
  setCachedData(scope, "page:reports-history:repo-1", ["repo 1 report analyses"]);
  setCachedData(scope, "api:/repositories/repo-1/history", { history: [] });
  setCachedData(scope, "api:/repositories/repo-2/history", { history: [] });

  invalidatePageData(scope, "history:repo-1");

  assert.equal(getCachedData(scope, "page:history:repo-1"), undefined);
  assert.equal(getCachedData(scope, "api:/repositories/repo-1/history"), undefined);
  assert.deepEqual(getCachedData(scope, "page:history:repo-2"), ["repo 2 history"]);
  assert.deepEqual(getCachedData(scope, "api:/repositories/repo-2/history"), { history: [] });

  invalidateRepositoryData(scope, "repo-1");
  assert.equal(getCachedData(scope, "page:reports-history:repo-1"), undefined);
});

test("refreshing All history invalidates every cached repository history view", () => {
  const scope = "all-history-refresh.session";
  setCachedData(scope, "page:history:ALL", ["all histories"]);
  setCachedData(scope, "page:history:repo-1", ["repo 1 history"]);
  setCachedData(scope, "page:history:repo-2", ["repo 2 history"]);

  invalidatePageData(scope, "history:ALL");

  assert.equal(getCachedData(scope, "page:history:ALL"), undefined);
  assert.equal(getCachedData(scope, "page:history:repo-1"), undefined);
  assert.equal(getCachedData(scope, "page:history:repo-2"), undefined);
});

test("repository list changes invalidate the cached History selector options", () => {
  const scope = "history-repository-list.session";
  setCachedData(scope, "page:history-repository-list", [{ id: "repo-1" }]);
  setCachedData(scope, "api:/repositories", { repositories: [{ id: "repo-1" }] });

  invalidateRepositoryListData(scope);

  assert.equal(getCachedData(scope, "page:history-repository-list"), undefined);
  assert.equal(getCachedData(scope, "api:/repositories"), undefined);
});

test("repository page data stays isolated and analysis invalidation targets the changed repository", () => {
  const scope = "repository-switch.session";
  setCachedData(scope, "page:repository:repo-1", { name: "First repository" });
  setCachedData(scope, "page:repository:repo-2", { name: "Second repository" });
  setCachedData(scope, "api:/repositories/repo-1", { name: "First repository" });
  setCachedData(scope, "api:/repositories/repo-2", { name: "Second repository" });

  invalidateRepositoryData(scope, "repo-1");

  assert.equal(getCachedData(scope, "page:repository:repo-1"), undefined);
  assert.equal(getCachedData(scope, "api:/repositories/repo-1"), undefined);
  assert.deepEqual(getCachedData(scope, "page:repository:repo-2"), { name: "Second repository" });
  assert.deepEqual(getCachedData(scope, "api:/repositories/repo-2"), { name: "Second repository" });
});

test("repository detail requests honor a dashboard-specific timeout", async () => {
  installWindow();
  setSession({
    accessToken: "dashboard.timeout.token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

  await assert.rejects(bugzeroApi.getRepository("22222222-2222-4222-8222-222222222222", 5), (error: unknown) =>
    error instanceof ApiError
    && error.code === "NETWORK_ERROR"
    && error.message.includes("request timed out"));
});

test("local ZIP import uses the authenticated raw archive endpoint", async () => {
  installWindow();
  setSession({
    accessToken: "verified.backend.token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      repository: {
        id: "22222222-2222-4222-8222-222222222222",
        organizationId: "11111111-1111-4111-8111-111111111111",
        provider: "LOCAL",
        externalId: "local-fixture",
        fullName: "Local Fixture",
        defaultBranch: "main",
        cloneUrl: "local://local-fixture",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      revision: {
        id: "44444444-4444-4444-8444-444444444444",
        organizationId: "11111111-1111-4111-8111-111111111111",
        repositoryId: "22222222-2222-4222-8222-222222222222",
        commitSha: "a".repeat(40),
        parentCommitSha: null,
        createdAt: new Date(0).toISOString(),
        indexedAt: new Date(0).toISOString(),
      },
      filesPersisted: 1,
      totalBytes: 4,
      languages: ["TypeScript"],
    });
  };

  const result = await bugzeroApi.uploadLocalRepository(
    "Local Fixture",
    new File(["code"], "local-e2e.zip", { type: "application/zip" }),
  );

  assert.equal(request?.url, "http://localhost/api/bugzero/repositories/local-zip");
  assert.equal(request?.headers.get("Content-Type"), "application/zip");
  assert.equal(request?.headers.get("X-Repository-Name"), "Local Fixture");
  assert.equal(request?.headers.get("Authorization"), "Bearer verified.backend.token");
  assert.equal(Buffer.from(await request!.arrayBuffer()).toString(), "code");
  assert.equal(result.repository.provider, "LOCAL");
});

test("createAnalysis sends an explicitly requested repository scope", async () => {
  installWindow();
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      analysisRunId: "55555555-5555-4555-8555-555555555555",
      jobId: "66666666-6666-4666-8666-666666666666",
      status: "QUEUED",
    }, { status: 202 });
  };

  const result = await bugzeroApi.createAnalysis(
    "22222222-2222-4222-8222-222222222222",
    "a".repeat(40),
    "REPOSITORY",
  );

  assert.equal(result.status, "QUEUED");
  assert.deepEqual(await request?.json(), {
    repositoryId: "22222222-2222-4222-8222-222222222222",
    commitSha: "a".repeat(40),
    profileId: "default",
    scope: "REPOSITORY",
    changedFiles: [],
    changedEntityIds: [],
  });
});

test("ZIP onboarding submits the persisted repository revision to the real analysis endpoint with backward-compatible COMMIT scope", async () => {
  installWindow();
  setSession({
    accessToken: "verified.backend.token",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    user: { userId: "33333333-3333-4333-8333-333333333333", email: "member@bugzero.dev", role: "OWNER" },
  });
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    requests.push(request);
    if (request.url.endsWith("/repositories/local-zip")) {
      return Response.json({
        repository: {
          id: "22222222-2222-4222-8222-222222222222",
          organizationId: "11111111-1111-4111-8111-111111111111",
          provider: "LOCAL",
          externalId: "uploaded-codebase",
          fullName: "Uploaded Codebase",
          defaultBranch: "main",
          cloneUrl: "local://uploaded-codebase",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        revision: {
          id: "44444444-4444-4444-8444-444444444444",
          organizationId: "11111111-1111-4111-8111-111111111111",
          repositoryId: "22222222-2222-4222-8222-222222222222",
          commitSha: "a".repeat(40),
          parentCommitSha: null,
          createdAt: new Date(0).toISOString(),
          indexedAt: new Date(0).toISOString(),
        },
        filesPersisted: 1,
        totalBytes: 4,
        languages: ["TypeScript"],
      });
    }
    return Response.json({
      analysisRunId: "55555555-5555-4555-8555-555555555555",
      jobId: "66666666-6666-4666-8666-666666666666",
      status: "QUEUED",
    }, { status: 202 });
  };

  const result = await bugzeroApi.uploadAndAnalyzeRepository(
    "Uploaded Codebase",
    new File(["code"], "codebase.zip", { type: "application/zip" }),
  );

  assert.equal(result.analysis?.status, "QUEUED");
  assert.equal(result.analysisError, null);
  assert.equal(requests.length, 2);
  assert.match(requests[0]?.url ?? "", /repositories\/local-zip$/);
  assert.equal(requests[1]?.url, "http://localhost/api/bugzero/analysis");
  assert.deepEqual(await requests[1]?.json(), {
    repositoryId: "22222222-2222-4222-8222-222222222222",
    commitSha: "a".repeat(40),
    profileId: "default",
    scope: "COMMIT",
    changedFiles: [],
    changedEntityIds: [],
  });
});
