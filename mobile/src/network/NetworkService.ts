import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import Config from '../config/env';
import logger from '../utils/logger';

export type NetworkStatusListener = (isConnected: boolean) => void;

export class NetworkService {
  private isConnected = true;
  private isInternetReachable = true;
  private isServerReachable = false;
  private subscription: NetInfoSubscription | null = null;
  private listeners = new Set<NetworkStatusListener>();

  constructor() {
    this.init();
  }

  private init(): void {
    this.subscription = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = !!state.isConnected;
      const reachable = state.isInternetReachable !== null ? !!state.isInternetReachable : connected;
      
      const hasChanged = this.isConnected !== connected;
      this.isConnected = connected;
      this.isInternetReachable = reachable;

      logger.debug('NetworkService', `Network status changed: connected=${connected}, reachable=${reachable}`);

      if (hasChanged) {
        this.notifyListeners(connected);
      }
    });

    // Initial check
    NetInfo.fetch().then((state) => {
      this.isConnected = !!state.isConnected;
      this.isInternetReachable = state.isInternetReachable !== null ? !!state.isInternetReachable : this.isConnected;
      logger.info('NetworkService', `Initial network status: ${this.isConnected ? 'ONLINE' : 'OFFLINE'}`);
    });
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getIsInternetReachable(): boolean {
    return this.isInternetReachable;
  }

  async checkServerReachability(customBaseUrl?: string): Promise<boolean> {
    if (!this.isConnected) {
      this.isServerReachable = false;
      return false;
    }

    const baseUrl = customBaseUrl || Config.API_BASE_URL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      // Ping health check or me endpoint
      const response = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Even 401 means server is reachable
      this.isServerReachable = response.status > 0;
      return this.isServerReachable;
    } catch {
      clearTimeout(timeout);
      this.isServerReachable = false;
      return false;
    }
  }

  addListener(listener: NetworkStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(isConnected: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(isConnected);
      } catch (err) {
        logger.error('NetworkService', 'Listener error', err);
      }
    }
  }

  cleanup(): void {
    if (this.subscription) {
      this.subscription();
      this.subscription = null;
    }
    this.listeners.clear();
  }
}

export const networkService = new NetworkService();
export default networkService;
