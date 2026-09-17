import { UserSession } from '../types/domain';

export type AuthStatus = 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'REVOKED' | 'EXPIRED';

export interface LoginCredentials {
  username: string;
  password: string;
  device_id?: string;
  device_name?: string;
  platform?: string;
  app_version?: string;
}

export interface LoginResponseData {
  token: string;
  refreshToken?: string;
  session_id?: string;
  device_id?: string;
  user: UserSession;
}

export interface AuthState {
  user: UserSession | null;
  token: string | null;
  deviceId: string | null;
  sessionId: string | null;
  authStatus: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  revocationReason?: string | null;
}

export interface LogoutResult {
  success: boolean;
  unSyncedCount?: number;
  warning?: string;
}

export interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: (force?: boolean) => Promise<LogoutResult>;
  refreshSession: () => Promise<void>;
  checkPendingOutboxCount: () => Promise<number>;
}

