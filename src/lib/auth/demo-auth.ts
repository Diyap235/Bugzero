import type { AuthCredentials, AuthSession, AuthService, AuthUser } from "./auth-types";
import { clearSession, getSessionState, setSession } from "./auth-service";

export const DEMO_CREDENTIALS = {
  email: "demo@bugzero.dev",
  password: "demo123",
} as const;

export const DEMO_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const demoUser: AuthUser = {
  userId: "bugzero-demo-user",
  email: DEMO_CREDENTIALS.email,
  role: "DEMO_USER",
};

export class InvalidDemoCredentialsError extends Error {
  constructor() {
    super("Invalid demo credentials.");
    this.name = "InvalidDemoCredentialsError";
  }
}

function createDemoAccessToken(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Browser randomness is unavailable.");
  }
  // Opaque client-only demo token; it is not signed or verifiable by the backend.
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `demo-session.${token}`;
}

export const demoAuthService: AuthService = {
  async login(credentials: AuthCredentials): Promise<AuthSession> {
    const email = credentials.email.trim().toLowerCase();
    if (email !== DEMO_CREDENTIALS.email || credentials.password !== DEMO_CREDENTIALS.password) {
      throw new InvalidDemoCredentialsError();
    }

    const issuedAt = Date.now();
    const session: AuthSession = {
      accessToken: createDemoAccessToken(),
      user: { ...demoUser },
      issuedAt,
      expiresAt: issuedAt + DEMO_SESSION_TTL_MS,
    };
    setSession(session);
    return session;
  },
  getSessionState,
  logout: clearSession,
};
