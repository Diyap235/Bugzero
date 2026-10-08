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
import type { AuthSession } from "../../../src/lib/auth/auth-types";

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

function createSession(): AuthSession {
  const issuedAt = Date.now();
  return {
    accessToken: "header.payload.signature",
    user: {
      userId: "33333333-3333-4333-8333-333333333333",
      email: "member@bugzero.dev",
      role: "DEVELOPER",
    },
    issuedAt,
    expiresAt: issuedAt + 15 * 60 * 1000,
  };
}

afterEach(() => {
  storage.clear();
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("server-issued JWT session persists and exposes the authenticated identity", () => {
  installSessionStorage();
  const session = createSession();
  setSession(session);

  assert.equal(isAuthenticated(), true);
  assert.deepEqual(getSession(), session);
  assert.deepEqual(getCurrentUser(), session.user);

  clearSession();
  assert.equal(isAuthenticated(), false);
  assert.equal(getCurrentUser(), null);
});

test("legacy demo tokens are discarded instead of becoming backend credentials", () => {
  installSessionStorage();
  sessionStorageMock.setItem("bugzero_session", JSON.stringify({
    ...createSession(),
    accessToken: "demo-session.not-a-jwt",
  }));

  assert.deepEqual(getSessionState(), { session: null, expired: false });
  assert.equal(storage.size, 0);
});

test("expired JWT sessions are cleared and reported", () => {
  installSessionStorage();
  setSession({ ...createSession(), expiresAt: Date.now() - 1 });

  assert.deepEqual(getSessionState(), { session: null, expired: true });
  assert.equal(storage.size, 0);
});
