import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { UserSession } from '../types/domain';
import logger from '../utils/logger';

const TOKEN_KEY = 'tshop_auth_token';
const REFRESH_TOKEN_KEY = 'tshop_auth_refresh_token';
const USER_KEY = 'tshop_auth_user';
const DEVICE_ID_KEY = 'tshop_device_id';
const SESSION_ID_KEY = 'tshop_session_id';

const isWeb = Platform.OS === 'web';
const webMemoryFallback = new Map<string, string>();

async function getStorageItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // Ignore security errors in sandboxed iframes
    }
    return webMemoryFallback.get(key) || null;
  }
  return await SecureStore.getItemAsync(key);
}

async function setStorageItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Ignore
    }
    webMemoryFallback.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStorageItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore
    }
    webMemoryFallback.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const tokenStorage = {
  async getToken(): Promise<string | null> {
    try {
      return await getStorageItem(TOKEN_KEY);
    } catch (err) {
      logger.error('TokenStorage', 'Failed to retrieve auth token', err);
      return null;
    }
  },

  async setToken(token: string): Promise<void> {
    try {
      await setStorageItem(TOKEN_KEY, token);
      logger.debug('TokenStorage', 'Auth token stored securely');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to store auth token securely', err);
    }
  },

  async removeToken(): Promise<void> {
    try {
      await deleteStorageItem(TOKEN_KEY);
      logger.debug('TokenStorage', 'Auth token deleted');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to delete auth token', err);
    }
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      return await getStorageItem(REFRESH_TOKEN_KEY);
    } catch (err) {
      logger.error('TokenStorage', 'Failed to retrieve refresh token', err);
      return null;
    }
  },

  async setRefreshToken(refreshToken: string): Promise<void> {
    try {
      await setStorageItem(REFRESH_TOKEN_KEY, refreshToken);
      logger.debug('TokenStorage', 'Refresh token stored securely');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to store refresh token securely', err);
    }
  },

  async removeRefreshToken(): Promise<void> {
    try {
      await deleteStorageItem(REFRESH_TOKEN_KEY);
      logger.debug('TokenStorage', 'Refresh token deleted');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to delete refresh token', err);
    }
  },

  async getSessionId(): Promise<string | null> {
    try {
      return await getStorageItem(SESSION_ID_KEY);
    } catch (err) {
      logger.error('TokenStorage', 'Failed to retrieve session id', err);
      return null;
    }
  },

  async setSessionId(sessionId: string): Promise<void> {
    try {
      await setStorageItem(SESSION_ID_KEY, sessionId);
      logger.debug('TokenStorage', 'Session id stored securely');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to store session id', err);
    }
  },

  async removeSessionId(): Promise<void> {
    try {
      await deleteStorageItem(SESSION_ID_KEY);
    } catch (err) {
      logger.error('TokenStorage', 'Failed to delete session id', err);
    }
  },

  async getDeviceId(): Promise<string> {
    try {
      let deviceId = await getStorageItem(DEVICE_ID_KEY);
      if (!deviceId) {
        deviceId = generateUUID();
        await setStorageItem(DEVICE_ID_KEY, deviceId);
        logger.info('TokenStorage', `Generated and stored new device_id: ${deviceId}`);
      }
      return deviceId;
    } catch (err) {
      logger.error('TokenStorage', 'Failed to get or create device_id', err);
      return 'fallback-device-id';
    }
  },

  async getUser(): Promise<UserSession | null> {
    try {
      const raw = await getStorageItem(USER_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as UserSession;
    } catch (err) {
      logger.error('TokenStorage', 'Failed to retrieve user session', err);
      return null;
    }
  },

  async setUser(user: UserSession): Promise<void> {
    try {
      await setStorageItem(USER_KEY, JSON.stringify(user));
      logger.debug('TokenStorage', 'User session stored securely');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to store user session', err);
    }
  },

  async removeUser(): Promise<void> {
    try {
      await deleteStorageItem(USER_KEY);
      logger.debug('TokenStorage', 'User session deleted');
    } catch (err) {
      logger.error('TokenStorage', 'Failed to delete user session', err);
    }
  },

  async clearAuthCredentials(): Promise<void> {
    // Clears tokens, user, and session ID but PRESERVES device_id
    await this.removeToken();
    await this.removeRefreshToken();
    await this.removeSessionId();
    await this.removeUser();
    logger.info('TokenStorage', 'Auth credentials cleared, persistent device_id preserved');
  },

  async clearAll(): Promise<void> {
    await this.clearAuthCredentials();
  },
};

export type TokenStorage = typeof tokenStorage;
export default tokenStorage;

