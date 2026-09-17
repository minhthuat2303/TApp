import * as SQLite from 'expo-sqlite';
import { IDatabaseDriver, ITransactionClient, QueryResult } from './types';
import logger from '../utils/logger';

export class ExpoSqliteDriver implements IDatabaseDriver {
  private db: SQLite.SQLiteDatabase | null = null;
  private dbName: string = 't_shop.db';

  async openAsync(dbName: string = 't_shop.db'): Promise<void> {
    this.dbName = dbName;
    this.db = await SQLite.openDatabaseAsync(dbName);
    // Configure SQLite pragmas for performance and data integrity
    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    logger.info('ExpoSqliteDriver', `Database ${dbName} opened successfully`);
  }

  async closeAsync(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      logger.info('ExpoSqliteDriver', 'Database closed');
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  private getDb(): SQLite.SQLiteDatabase {
    if (!this.db) {
      throw new Error('Database is not opened. Call openAsync() first.');
    }
    return this.db;
  }

  async execAsync(sql: string): Promise<void> {
    await this.getDb().execAsync(sql);
  }

  async runAsync(sql: string, params?: unknown[]): Promise<QueryResult> {
    const res = await this.getDb().runAsync(sql, (params || []) as SQLite.SQLiteBindParams);
    return {
      changes: res.changes,
      lastInsertRowId: Number(res.lastInsertRowId),
    };
  }

  async getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return await this.getDb().getAllAsync<T>(sql, (params || []) as SQLite.SQLiteBindParams);
  }

  async getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    return await this.getDb().getFirstAsync<T>(sql, (params || []) as SQLite.SQLiteBindParams);
  }

  async withTransactionAsync<T>(action: (tx: ITransactionClient) => Promise<T>): Promise<T> {
    const db = this.getDb();
    let result: T;
    await db.withTransactionAsync(async () => {
      const txClient: ITransactionClient = {
        execAsync: (sql) => db.execAsync(sql),
        runAsync: async (sql, params) => {
          const res = await db.runAsync(sql, (params || []) as SQLite.SQLiteBindParams);
          return { changes: res.changes, lastInsertRowId: Number(res.lastInsertRowId) };
        },
        getAllAsync: (sql, params) => db.getAllAsync(sql, (params || []) as SQLite.SQLiteBindParams),
        getFirstAsync: (sql, params) => db.getFirstAsync(sql, (params || []) as SQLite.SQLiteBindParams),
      };
      result = await action(txClient);
    });
    return result!;
  }
}

export default ExpoSqliteDriver;
