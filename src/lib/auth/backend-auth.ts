import { bugzeroApi } from "@/lib/api-client";
import type { AuthCredentials, AuthService, AuthSession } from "./auth-types";
import { clearSession, getSessionState, setSession } from "./auth-service";

export const backendAuthService: AuthService = {
  async login(credentials: AuthCredentials): Promise<AuthSession> {
    const response = await bugzeroApi.login(credentials.email, credentials.password);
    const session: AuthSession = {
      accessToken: response.accessToken,
      issuedAt: response.issuedAt * 1000,
      expiresAt: response.expiresAt * 1000,
      user: response.user,
    };
    setSession(session);
    return session;
  },
  async register(details): Promise<AuthSession> {
    const response = await bugzeroApi.registerAccount(details);
    const session: AuthSession = {
      accessToken: response.accessToken,
      issuedAt: response.issuedAt * 1000,
      expiresAt: response.expiresAt * 1000,
      user: response.user,
    };
    setSession(session);
    return session;
  },
  async validateSession(): Promise<void> {
    await bugzeroApi.getAuthenticatedSession();
  },
  getSessionState,
  logout(): void {
    clearSession();
  },
};
