import { Platform } from 'react-native';
import { IDatabaseDriver, ITransactionClient, QueryResult } from './types';
import { ExpoSqliteDriver } from './ExpoSqliteDriver';
import { WebDemoSqliteDriver } from './WebDemoSqliteDriver';
import { migrations } from './migrations';
import logger from '../utils/logger';

export class DatabaseService {
  private driver: IDatabaseDriver;
  private initialized: boolean = false;
  private dbName: string = 't_shop.db';

  constructor(driver?: IDatabaseDriver) {
    if (driver) {
      this.driver = driver;
    } else if (Platform.OS === 'web') {
      this.driver = new WebDemoSqliteDriver();
    } else {
      this.driver = new ExpoSqliteDriver();
    }
  }

  setDriver(driver: IDatabaseDriver): void {
    this.driver = driver;
    this.initialized = false;
  }

  getDriver(): IDatabaseDriver {
    return this.driver;
  }

  isInitialized(): boolean {
    return this.initialized && this.driver.isOpen();
  }

  async initialize(dbName: string = 't_shop.db'): Promise<void> {
    if (this.isInitialized() && this.dbName === dbName) {
      return;
    }

    this.dbName = dbName;
    logger.info('DatabaseService', `Initializing SQLite database: ${dbName}`);

    if (Platform.OS === 'web') {
      await this.driver.openAsync(dbName);
      this.initialized = true;
      logger.info('DatabaseService', 'Web Demo SQLite Driver ready.');
      return;
    }

    if (!this.driver.isOpen()) {
      await this.driver.openAsync(dbName);
    }

    // 1. Ensure migrations tracking table exists
    await this.driver.execAsync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 2. Fetch applied migration versions
    const appliedRows = await this.driver.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC'
    );
    const appliedVersions = new Set(appliedRows.map((r) => r.version));
    logger.debug('DatabaseService', `Applied migration versions: [${Array.from(appliedVersions).join(', ')}]`);

    // 3. Run pending migrations in ascending order within individual atomic transactions
    for (const mig of migrations) {
      if (!appliedVersions.has(mig.version)) {
        logger.info('DatabaseService', `Applying migration ${mig.version}: ${mig.name}...`);
        await this.driver.withTransactionAsync(async (tx) => {
          await mig.up(tx);
          await tx.runAsync(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime("now"))',
            [mig.version, mig.name]
          );
        });
        logger.info('DatabaseService', `Migration ${mig.version}: ${mig.name} applied successfully`);
      }
    }

    this.initialized = true;
    const currentVersion = await this.getCurrentVersion();
    logger.info('DatabaseService', `Database ready at schema version ${currentVersion}`);
  }

  async getCurrentVersion(): Promise<number> {
    const row = await this.driver.getFirstAsync<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );
    return row ? row.version : 0;
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    this.assertReady();
    return await this.driver.getAllAsync<T>(sql, params);
  }

  async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    this.assertReady();
    return await this.driver.getFirstAsync<T>(sql, params);
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.assertReady();
    return await this.driver.runAsync(sql, params);
  }

  async run(sql: string, params?: unknown[]): Promise<QueryResult> {
    return await this.execute(sql, params);
  }

  async withTransaction<T>(action: (tx: ITransactionClient) => Promise<T>): Promise<T> {
    this.assertReady();
    return await this.driver.withTransactionAsync<T>(action);
  }

  async withTransactionAsync<T>(action: (tx: ITransactionClient) => Promise<T>): Promise<T> {
    return await this.withTransaction<T>(action);
  }

  async close(): Promise<void> {
    if (this.driver.isOpen()) {
      await this.driver.closeAsync();
    }
    this.initialized = false;
  }

  private assertReady(): void {
    if (!this.driver.isOpen()) {
      throw new Error('DatabaseService: database driver is not open. Call initialize() first.');
    }
  }
}

export const databaseService = new DatabaseService();
export default databaseService;
