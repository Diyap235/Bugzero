export type AuthRole = string;

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

export interface RegistrationDetails extends AuthCredentials {
  displayName: string;
  workspaceName: string;
}

export interface AuthSessionState {
  session: AuthSession | null;
  expired: boolean;
}

export interface AuthService {
  login(credentials: AuthCredentials): Promise<AuthSession>;
  register(details: RegistrationDetails): Promise<AuthSession>;
  validateSession(): Promise<void>;
  getSessionState(): AuthSessionState;
  logout(): void;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpired: boolean;
  login(credentials: AuthCredentials): Promise<void>;
  register(details: RegistrationDetails): Promise<void>;
  logout(): void;
}
