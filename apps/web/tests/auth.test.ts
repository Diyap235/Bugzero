import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearSession,
  getCurrentUser,
  getSession,
  getSessionState,
  isAuthenticated,
  setSession,
} from "../../../src/lib/auth/auth-service";
import { DEMO_CREDENTIALS, DEMO_SESSION_TTL_MS, demoAuthService, InvalidDemoCredentialsError } from "../../../src/lib/auth/demo-auth";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const storage = new Map<string, string>();
const sessionStorageMock: Storage = {
  get length() { return storage.size; },
  clear() { storage.clear(); },
  getItem(key) { return storage.get(key) ?? null; },
  key(index) { return [...storage.keys()][index] ?? null; },
  removeItem(key) { storage.delete(key); },
  setItem(key, value) { storage.set(key, String(value)); },
};

function installSessionStorage(): void {
  storage.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: sessionStorageMock },
  });
}

afterEach(() => {
  storage.clear();
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("demo login creates a random token with a 24-hour expiry and no password", async () => {
  installSessionStorage();
  const first = await demoAuthService.login(DEMO_CREDENTIALS);
  const second = await demoAuthService.login(DEMO_CREDENTIALS);

  assert.match(first.accessToken, /^demo-session\.[a-f0-9]{64}$/);
  assert.notEqual(first.accessToken, second.accessToken);
  assert.deepEqual(first.user, {
    userId: "bugzero-demo-user",
    email: DEMO_CREDENTIALS.email,
    role: "DEMO_USER",
  });
  assert.equal(first.expiresAt - first.issuedAt, DEMO_SESSION_TTL_MS);
  assert.equal(JSON.stringify(first).includes(DEMO_CREDENTIALS.password), false);
});

test("demo login rejects invalid credentials", async () => {
  await assert.rejects(
    demoAuthService.login({ email: DEMO_CREDENTIALS.email, password: "wrong" }),
    InvalidDemoCredentialsError,
  );
  await assert.rejects(
    demoAuthService.login({ email: "other@bugzero.dev", password: DEMO_CREDENTIALS.password }),
    InvalidDemoCredentialsError,
  );
});

test("session helpers persist identity in session storage and clear it on logout", async () => {
  installSessionStorage();
  const session = await demoAuthService.login(DEMO_CREDENTIALS);
  setSession(session);

  assert.equal(isAuthenticated(), true);
  assert.equal(getSession()?.accessToken, session.accessToken);
  assert.deepEqual(getCurrentUser(), session.user);

  clearSession();
  assert.equal(isAuthenticated(), false);
  assert.equal(getCurrentUser(), null);
});

test("expired sessions are cleared and reported as expired", async () => {
  installSessionStorage();
  const session = await demoAuthService.login(DEMO_CREDENTIALS);
  setSession({ ...session, expiresAt: Date.now() - 1 });

  assert.deepEqual(getSessionState(), { session: null, expired: true });
  assert.equal(storage.size, 0);
});
