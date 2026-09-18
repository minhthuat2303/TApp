import Config from '../config/env';
import tokenStorage from './tokenStorage';
import logger from '../utils/logger';

export type AuthEventType = 
  | 'REFRESH_SUCCESS' 
  | 'SESSION_REVOKED' 
  | 'AUTH_EXPIRED' 
  | 'DEVICE_REVOKED' 
  | 'UNAUTHORIZED';

export interface AuthEvent {
  type: AuthEventType;
  reason?: string;
  error?: any;
}

export type AuthEventListener = (event: AuthEvent) => void;

class AuthManager {
  private isRefreshing = false;
  private refreshPromise: Promise<string> | null = null;
  private listeners: Set<AuthEventListener> = new Set();

  addListener(listener: AuthEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: AuthEvent): void {
    logger.warn('AuthManager', `Auth event emitted: ${event.type}`, event.reason);
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        logger.error('AuthManager', 'Error in auth event listener', err);
      }
    });
  }

  /**
   * Thread-safe / single-flight refresh token rotation.
   * If multiple concurrent requests hit 401, all await the single in-flight refresh call.
   */
  async refreshToken(): Promise<string> {
    if (this.isRefreshing && this.refreshPromise) {
      logger.debug('AuthManager', 'Refresh already in progress. Joining single-flight promise.');
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.executeRefresh()
      .finally(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  private async executeRefresh(): Promise<string> {
    const rawRefreshToken = await tokenStorage.getRefreshToken();
    const deviceId = await tokenStorage.getDeviceId();

    if (!rawRefreshToken) {
      logger.warn('AuthManager', 'No refresh token stored, skipping token refresh attempt.');
      throw new Error('NO_REFRESH_TOKEN');
    }

    const savedUrl = await tokenStorage.getServerUrl();
    const activeBaseUrl = (savedUrl && savedUrl.trim()) ? savedUrl.trim().replace(/\/+$/, '') : Config.API_BASE_URL.replace(/\/+$/, '');
    const refreshUrl = `${activeBaseUrl}/api/auth/refresh`;
    logger.info('AuthManager', `Attempting refresh token rotation at ${refreshUrl}`);

    try {
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify({
          refreshToken: rawRefreshToken,
          deviceId,
        }),
      });

      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('PARSE_ERROR');
      }

      if (!response.ok || !data.success) {
        const errorCode = data?.error?.code || (response.status === 401 ? 'UNAUTHORIZED' : 'REFRESH_FAILED');
        const errorMessage = data?.error?.message || `Lỗi refresh token (${response.status})`;

        if (errorCode === 'SESSION_REVOKED') {
          this.notify({ type: 'SESSION_REVOKED', reason: errorMessage });
        } else if (errorCode === 'DEVICE_REVOKED') {
          this.notify({ type: 'DEVICE_REVOKED', reason: errorMessage });
        } else if (errorCode === 'AUTH_EXPIRED' || errorCode === 'REFRESH_TOKEN_EXPIRED') {
          this.notify({ type: 'AUTH_EXPIRED', reason: errorMessage });
        } else if (response.status === 401 || response.status === 403) {
          this.notify({ type: 'AUTH_EXPIRED', reason: errorMessage });
        } else {
          logger.warn('AuthManager', `Server returned temporary refresh error ${response.status}: ${errorMessage}`);
        }

        throw new Error(errorCode);
      }

      const { token: newAccessToken, refreshToken: newRefreshToken, user } = data.data;

      // Update storage atomically
      await tokenStorage.setToken(newAccessToken);
      if (newRefreshToken) {
        await tokenStorage.setRefreshToken(newRefreshToken);
      }
      if (user) {
        await tokenStorage.setUser(user);
      }

      logger.info('AuthManager', 'Token refresh successful. New tokens stored.');
      this.notify({ type: 'REFRESH_SUCCESS' });

      return newAccessToken;
    } catch (err: any) {
      logger.error('AuthManager', 'Token refresh execution failed', err);
      throw err;
    }
  }

  notifySessionRevoked(reason?: string): void {
    this.notify({ type: 'SESSION_REVOKED', reason });
  }

  notifyDeviceRevoked(reason?: string): void {
    this.notify({ type: 'DEVICE_REVOKED', reason });
  }
}

export const authManager = new AuthManager();
export default authManager;
