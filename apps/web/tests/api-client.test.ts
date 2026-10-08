import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { bugzeroApi, ApiError } from "../../../src/lib/api-client";
import { clearSession, setSession } from "../../../src/lib/auth/auth-service";

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
    password: "a-long-enough-password",
    workspaceName: "Example Workspace",
  });

  assert.equal(request?.url, "http://localhost/api/bugzero/auth/signup");
  assert.equal(request?.headers.has("Authorization"), false);
  assert.deepEqual(await request?.json(), {
    displayName: "New Member",
    email: "member@bugzero.dev",
    password: "a-long-enough-password",
    workspaceName: "Example Workspace",
  });
  assert.equal(result.user.role, "OWNER");
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

test("ZIP onboarding submits the persisted repository revision to the real analysis endpoint", async () => {
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
