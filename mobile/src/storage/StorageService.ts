import { IStorageService, IKeyValueStorage } from './types';
import logger from '../utils/logger';

// Default in-memory driver for Phase 03 foundation (swappable with SQLite in Phase 04)
class MemoryStorageDriver implements IKeyValueStorage {
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

class StorageService implements IStorageService {
  private driver: IKeyValueStorage;

  constructor(driver?: IKeyValueStorage) {
    this.driver = driver || new MemoryStorageDriver();
  }

  // Allow plugging in new storage drivers (e.g. SQLite storage engine in Phase 04)
  setDriver(driver: IKeyValueStorage): void {
    this.driver = driver;
    logger.info('StorageService', 'Storage driver updated');
  }

  async getString(key: string): Promise<string | null> {
    try {
      return await this.driver.getItem(key);
    } catch (err) {
      logger.error('StorageService', `Failed to get item ${key}`, err);
      return null;
    }
  }

  async setString(key: string, value: string): Promise<void> {
    try {
      await this.driver.setItem(key, value);
    } catch (err) {
      logger.error('StorageService', `Failed to set item ${key}`, err);
    }
  }

  async getObject<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.getString(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.error('StorageService', `Failed to parse JSON for ${key}`, err);
      return null;
    }
  }

  async setObject<T>(key: string, value: T): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      await this.setString(key, raw);
    } catch (err) {
      logger.error('StorageService', `Failed to stringify object for ${key}`, err);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.driver.removeItem(key);
    } catch (err) {
      logger.error('StorageService', `Failed to remove item ${key}`, err);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.driver.clear();
    } catch (err) {
      logger.error('StorageService', 'Failed to clear storage', err);
    }
  }
}

export const storageService = new StorageService();
export default storageService;
