export type AuthRole = "DEMO_USER";

export interface AuthUser {
  userId: string;
  email: string;
  role: AuthRole;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
  issuedAt: number;
  expiresAt: number;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthSessionState {
  session: AuthSession | null;
  expired: boolean;
}

export interface AuthService {
  login(credentials: AuthCredentials): Promise<AuthSession>;
  getSessionState(): AuthSessionState;
  logout(): void;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpired: boolean;
  login(credentials: AuthCredentials): Promise<void>;
  logout(): void;
}
