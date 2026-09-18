import Config from '../config/env';
import tokenStorage from '../auth/tokenStorage';
import authManager from '../auth/AuthManager';
import { ApiResponse, RequestOptions } from './types';
import { MobileError, normalizeError } from '../types/errors';
import logger from '../utils/logger';

class ApiClient {
  private baseUrl: string;
  private defaultTimeoutMs: number;

  constructor() {
    this.baseUrl = Config.API_BASE_URL;
    this.defaultTimeoutMs = Config.API_TIMEOUT_MS;
    this.loadPersistedBaseUrl();
  }

  async loadPersistedBaseUrl(): Promise<string> {
    try {
      const savedUrl = await tokenStorage.getServerUrl();
      const isLegacyUrl = !savedUrl || 
        savedUrl.includes('10.0.2.2') || 
        savedUrl.includes('localhost') || 
        savedUrl.includes('api.tshop.retail') ||
        !savedUrl.startsWith('http');

      if (isLegacyUrl) {
        this.baseUrl = Config.API_BASE_URL;
        await tokenStorage.setServerUrl(this.baseUrl);
        logger.info('ApiClient', `Auto-migrated Base URL to official production server: ${this.baseUrl}`);
      } else {
        this.baseUrl = savedUrl.trim().replace(/\/+$/, '');
        logger.info('ApiClient', `Loaded persisted Base URL: ${this.baseUrl}`);
      }
    } catch (e) {
      logger.warn('ApiClient', 'Failed to load persisted Base URL', e);
      this.baseUrl = Config.API_BASE_URL;
    }
    return this.baseUrl;
  }

  async setBaseUrl(url: string, persist = true): Promise<void> {
    this.baseUrl = url.trim().replace(/\/+$/, '');
    if (persist) {
      await tokenStorage.setServerUrl(this.baseUrl);
    }
    logger.info('ApiClient', `Base URL updated and saved: ${this.baseUrl}`);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined | null>): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    let fullUrl = `${this.baseUrl}${cleanEndpoint}`;

    if (params) {
      const queryParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          queryParams.append(key, String(value));
        }
      }
      const queryString = queryParams.toString();
      if (queryString) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
      }
    }

    return fullUrl;
  }

  private async request<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { timeoutMs = this.defaultTimeoutMs, skipAuth = false, params, _retry = false, ...fetchOptions } = options;
    const url = this.buildUrl(endpoint, params);

    const deviceId = await tokenStorage.getDeviceId();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Device-Id': deviceId,
      ...(fetchOptions.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const token = await tokenStorage.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      logger.debug('ApiClient', `--> ${fetchOptions.method || 'GET'} ${url}`);

      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Handle 401 Automatic Token Refresh & Retry (Single-Flight Mutex)
      if (
        response.status === 401 &&
        !skipAuth &&
        !_retry &&
        !endpoint.includes('/auth/login') &&
        !endpoint.includes('/auth/refresh')
      ) {
        logger.info('ApiClient', `Received 401 on ${endpoint}. Initiating single-flight token refresh...`);
        try {
          await authManager.refreshToken();
          logger.info('ApiClient', `Token refreshed successfully. Retrying request to ${endpoint}`);
          return await this.request<T>(endpoint, {
            ...options,
            _retry: true,
          });
        } catch (refreshErr) {
          logger.warn('ApiClient', 'Token refresh failed during 401 retry interception', refreshErr);
          // Fall through to let standard error handling process 401
        }
      }

      let data: any;
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { success: false, error: { code: 'PARSE_ERROR', message: 'Máy chủ phản hồi không đúng định dạng JSON.' } };
      }

      logger.debug('ApiClient', `<-- ${response.status} ${url}`, data);

      if (!response.ok || data.success === false) {
        const errorInfo = data.error || {};
        const code = errorInfo.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN' : 'SERVER_ERROR');
        const message = errorInfo.message || `Lỗi máy chủ (${response.status})`;

        throw new MobileError(
          code,
          message,
          response.status,
          errorInfo.details,
          data
        );
      }

      return data as ApiResponse<T>;
    } catch (err: any) {
      clearTimeout(timer);

      if (err.name === 'AbortError') {
        throw new MobileError('TIMEOUT_ERROR', `Yêu cầu kết nối vượt quá ${timeoutMs / 1000} giây.`, 408);
      }

      throw normalizeError(err);
    }
  }

  async get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async put<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T = unknown>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
export default apiClient;
