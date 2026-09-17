import { Pool } from 'pg';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import serverCache from './cache';

// Types for unified database operations
export interface DbClient {
  query<T = any>(sqlText: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sqlText: string, params?: any[]): Promise<T | null>;
  execute(sqlText: string, params?: any[]): Promise<{ rowCount: number; lastInsertId?: number }>;
}

// Global cache for connection pool in Next.js Serverless warm containers
declare global {
  // eslint-disable-next-line no-var
  var __pg_pool__: Pool | undefined;
  // eslint-disable-next-line no-var
  var __sqlite_db__: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __db_initialized__: boolean | undefined;
}

// Check if PostgreSQL connection string is configured
export function getPostgresConnectionString(): string | null {
  const url = process.env.POSTGRES_URL || 
              process.env.DATABASE_URL || 
              process.env.POSTGRES_PRISMA_URL || 
              process.env.POSTGRES_URL_NON_POOLING;
  return url && url.trim().length > 0 ? url.trim() : null;
}

export function isUsingPostgres(): boolean {
  return getPostgresConnectionString() !== null;
}

// Helper: Convert SQLite '?' parameter placeholders to PostgreSQL '$1, $2, ...'
export function convertPlaceholdersToPg(sqlText: string): string {
  let paramIndex = 1;
  return sqlText.replace(/\?/g, () => `$${paramIndex++}`);
}

// Helper: Convert PostgreSQL '$1, $2, ...' placeholders to SQLite '?'
export function convertPlaceholdersToSqlite(sqlText: string): string {
  return sqlText.replace(/\$\d+/g, '?');
}

// 1. Ultra-fast PostgreSQL Connection Pool with Warm Re-use
function getPgPool(): Pool {
  if (global.__pg_pool__) {
    return global.__pg_pool__;
  }

  const rawUrl = getPostgresConnectionString()!;
  let cleanUrl = rawUrl.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]supa=[^&]*/gi, '').replace(/[?&]pgbouncer=[^&]*/gi, '');
  if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

  const isSsl = !cleanUrl.includes('localhost') && !cleanUrl.includes('127.0.0.1');

  const pool = new Pool({
    connectionString: cleanUrl,
    ssl: isSsl ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
  });

  global.__pg_pool__ = pool;
  return pool;
}

// 2. SQLite Fallback Setup (for local dev when no Postgres URL is provided)
function getSqliteDb(): Database.Database {
  if (global.__sqlite_db__) {
    return global.__sqlite_db__;
  }

  const isServerless = process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.NOW_REGION;
  let dbPath: string;

  if (isServerless) {
    dbPath = path.join('/tmp', 't_shop.db');
  } else {
    const localDir = path.join(process.cwd(), 'data');
    try {
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
      dbPath = path.join(localDir, 't_shop.db');
    } catch {
      dbPath = path.join('/tmp', 't_shop.db');
    }
  }

  const db = new Database(dbPath);
  try { db.pragma('journal_mode = WAL'); } catch { try { db.pragma('journal_mode = DELETE'); } catch {} }
  try { db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 10000'); } catch {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS processed_sync_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_transaction_id TEXT UNIQUE NOT NULL,
        entity_type TEXT NOT NULL,
        status TEXT NOT NULL,
        server_id INTEGER,
        result_json TEXT,
        payload_hash TEXT,
        payload_json TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        device_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_processed_sync_tx_id ON processed_sync_transactions(client_transaction_id);

      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        app_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        refresh_token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_refreshed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME,
        revoked_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id ON user_sessions(device_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token_hash);
    `);
    try { db.exec('ALTER TABLE processed_sync_transactions ADD COLUMN payload_hash TEXT;'); } catch {}
    try { db.exec('ALTER TABLE processed_sync_transactions ADD COLUMN payload_json TEXT;'); } catch {}
    try { db.exec('ALTER TABLE processed_sync_transactions ADD COLUMN user_id INTEGER;'); } catch {}
    try { db.exec('ALTER TABLE processed_sync_transactions ADD COLUMN device_id TEXT;'); } catch {}
  } catch {}

  global.__sqlite_db__ = db;
  return db;
}

// 3. PostgreSQL Schema DDL & Auto-seeding (Background Lazy Run)
export async function ensurePgSchema() {
  if (global.__db_initialized__) return;
  global.__db_initialized__ = true;

  try {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS product_types (
          id SERIAL PRIMARY KEY,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          code VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          sku VARCHAR(100) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE RESTRICT,
          current_cost_price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (current_cost_price >= 0),
          current_selling_price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (current_selling_price >= 0),
          current_stock INTEGER NOT NULL DEFAULT 0,
          min_stock_alert INTEGER NOT NULL DEFAULT 5,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS price_history (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          price NUMERIC(15, 2) NOT NULL CHECK (price >= 0),
          effective_from DATE NOT NULL,
          note TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cost_price_history (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          cost_price NUMERIC(15, 2) NOT NULL CHECK (cost_price >= 0),
          effective_from DATE NOT NULL,
          note TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sales_records (
          id SERIAL PRIMARY KEY,
          transaction_code VARCHAR(100) UNIQUE NOT NULL,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          sale_date DATE NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price_at_sale NUMERIC(15, 2) NOT NULL CHECK (unit_price_at_sale >= 0),
          cost_price_at_sale NUMERIC(15, 2) NOT NULL CHECK (cost_price_at_sale >= 0),
          discount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
          total_revenue NUMERIC(15, 2) NOT NULL CHECK (total_revenue >= 0),
          total_cost NUMERIC(15, 2) NOT NULL CHECK (total_cost >= 0),
          profit NUMERIC(15, 2) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
          cancel_reason TEXT,
          cancelled_at TIMESTAMPTZ,
          cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          note TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS stock_movements (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN ('SALE', 'PURCHASE', 'DAMAGE', 'LOSS', 'GIFT', 'RETURN', 'ADJUSTMENT')),
          quantity_change INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          movement_date DATE NOT NULL,
          reference_type VARCHAR(50),
          reference_id INTEGER,
          note TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS suppliers (
          id SERIAL PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(50),
          address TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS imports (
          id SERIAL PRIMARY KEY,
          import_code VARCHAR(100) UNIQUE NOT NULL,
          supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
          import_date DATE NOT NULL,
          total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
          note TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS import_items (
          id SERIAL PRIMARY KEY,
          import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_cost_price NUMERIC(15, 2) NOT NULL CHECK (unit_cost_price >= 0),
          total_amount NUMERIC(15, 2) NOT NULL CHECK (total_amount >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS import_logs (
          id SERIAL PRIMARY KEY,
          file_name VARCHAR(255) NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          total_rows INTEGER NOT NULL DEFAULT 0,
          valid_rows INTEGER NOT NULL DEFAULT 0,
          error_rows INTEGER NOT NULL DEFAULT 0,
          created_rows INTEGER NOT NULL DEFAULT 0,
          updated_rows INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(50) NOT NULL,
          details_json TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL,
          entity_name VARCHAR(100) NOT NULL,
          entity_id VARCHAR(100),
          old_value_json TEXT,
          new_value_json TEXT,
          ip_address VARCHAR(100),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS inventory_lots (
          id SERIAL PRIMARY KEY,
          lot_code VARCHAR(100) UNIQUE NOT NULL,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          purchase_date DATE NOT NULL,
          quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
          quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
          unit_cost NUMERIC(15, 2) NOT NULL CHECK (unit_cost >= 0),
          supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
          import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
          note TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sale_cost_allocations (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL REFERENCES sales_records(id) ON DELETE CASCADE,
          inventory_lot_id INTEGER NOT NULL REFERENCES inventory_lots(id) ON DELETE RESTRICT,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_cost NUMERIC(15, 2) NOT NULL CHECK (unit_cost >= 0),
          total_cost NUMERIC(15, 2) NOT NULL CHECK (total_cost >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS processed_sync_transactions (
          id SERIAL PRIMARY KEY,
          client_transaction_id VARCHAR(100) UNIQUE NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL,
          server_id INTEGER,
          result_json TEXT,
          payload_hash VARCHAR(64),
          payload_json TEXT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          device_id VARCHAR(100),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS devices (
          device_id VARCHAR(100) PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          device_name VARCHAR(255) NOT NULL,
          platform VARCHAR(50) NOT NULL,
          app_version VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
          session_id VARCHAR(100) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
          refresh_token_hash VARCHAR(128) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          revoked_at TIMESTAMPTZ,
          revoked_reason TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
        CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
        CREATE INDEX IF NOT EXISTS idx_products_cat_type ON products(category_id, product_type_id);
        CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
        CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(product_id, effective_from DESC);
        CREATE INDEX IF NOT EXISTS idx_cost_price_history_lookup ON cost_price_history(product_id, effective_from DESC);
        CREATE INDEX IF NOT EXISTS idx_sales_records_date ON sales_records(sale_date);
        CREATE INDEX IF NOT EXISTS idx_sales_records_product_date ON sales_records(product_id, sale_date);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_date ON stock_movements(product_id, movement_date);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
        CREATE INDEX IF NOT EXISTS idx_inventory_lots_fifo ON inventory_lots(product_id, purchase_date ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_inventory_lots_code ON inventory_lots(lot_code);
        CREATE INDEX IF NOT EXISTS idx_sale_alloc_sale ON sale_cost_allocations(sale_id);
        CREATE INDEX IF NOT EXISTS idx_sale_alloc_lot ON sale_cost_allocations(inventory_lot_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date ON audit_logs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_processed_sync_tx_id ON processed_sync_transactions(client_transaction_id);
        CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id ON user_sessions(device_id);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token_hash);
      `);

      // Safe column additions for existing PostgreSQL tables
      try {
        await client.query(`
          DO $$ 
          BEGIN 
            BEGIN
              ALTER TABLE processed_sync_transactions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
            EXCEPTION WHEN others THEN NULL;
            END;
            BEGIN
              ALTER TABLE processed_sync_transactions ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
            EXCEPTION WHEN others THEN NULL;
            END;
          END $$;
        `);
      } catch {}

      const userRes = await client.query('SELECT COUNT(*) as count FROM users');
      if (parseInt(userRes.rows[0].count, 10) === 0) {
        const adminHash = bcrypt.hashSync('admin123', 10);
        const staffHash = bcrypt.hashSync('staff123', 10);
        await client.query(`
          INSERT INTO users (username, password_hash, full_name, role, status)
          VALUES 
            ('admin', $1, 'Quản Trị Viên (Admin)', 'ADMIN', 'ACTIVE'),
            ('staff', $2, 'Nhân Viên Bán Hàng', 'STAFF', 'ACTIVE')
          ON CONFLICT (username) DO NOTHING
        `, [adminHash, staffHash]);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('ensurePgSchema background error:', err);
  }
}

// 4. Ultra-fast Unified Query Layer (Direct query with 0 latency overhead)
export async function query<T = any>(sqlText: string, params: any[] = []): Promise<T[]> {
  if (isUsingPostgres()) {
    const pool = getPgPool();
    const pgSql = convertPlaceholdersToPg(sqlText);
    const res = await pool.query(pgSql, params);
    return res.rows as T[];
  } else {
    const sqlite = getSqliteDb();
    const sqliteSql = convertPlaceholdersToSqlite(sqlText);
    return sqlite.prepare(sqliteSql).all(...params) as T[];
  }
}

export async function queryOne<T = any>(sqlText: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sqlText, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function execute(sqlText: string, params: any[] = []): Promise<{ rowCount: number; lastInsertId?: number }> {
  // Invalidate in-memory server cache when write operations occur
  serverCache.invalidateAll();

  if (isUsingPostgres()) {
    const pool = getPgPool();
    let pgSql = convertPlaceholdersToPg(sqlText);
    
    const isInsert = /^\s*INSERT\s+INTO/i.test(pgSql);
    const hasReturning = /RETURNING/i.test(pgSql);
    
    if (isInsert && !hasReturning) {
      pgSql += ' RETURNING id';
    }

    const res = await pool.query(pgSql, params);
    const lastInsertId = res.rows.length > 0 && res.rows[0].id ? Number(res.rows[0].id) : undefined;
    return { rowCount: res.rowCount || 0, lastInsertId };
  } else {
    const sqlite = getSqliteDb();
    const sqliteSql = convertPlaceholdersToSqlite(sqlText);
    const info = sqlite.prepare(sqliteSql).run(...params);
    return { rowCount: info.changes, lastInsertId: Number(info.lastInsertRowid) };
  }
}

export async function transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  // Invalidate in-memory cache when transaction executes
  serverCache.invalidateAll();

  if (isUsingPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txClient: DbClient = {
        async query<R = any>(sqlText: string, params: any[] = []): Promise<R[]> {
          const pgSql = convertPlaceholdersToPg(sqlText);
          const res = await client.query(pgSql, params);
          return res.rows as R[];
        },
        async queryOne<R = any>(sqlText: string, params: any[] = []): Promise<R | null> {
          const rows = await this.query<R>(sqlText, params);
          return rows.length > 0 ? rows[0] : null;
        },
        async execute(sqlText: string, params: any[] = []): Promise<{ rowCount: number; lastInsertId?: number }> {
          let pgSql = convertPlaceholdersToPg(sqlText);
          const isInsert = /^\s*INSERT\s+INTO/i.test(pgSql);
          const hasReturning = /RETURNING/i.test(pgSql);
          if (isInsert && !hasReturning) {
            pgSql += ' RETURNING id';
          }
          const res = await client.query(pgSql, params);
          const lastInsertId = res.rows.length > 0 && res.rows[0].id ? Number(res.rows[0].id) : undefined;
          return { rowCount: res.rowCount || 0, lastInsertId };
        },
      };

      const result = await fn(txClient);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } else {
    const sqlite = getSqliteDb();

    const txClient: DbClient = {
      async query<R = any>(sqlText: string, params: any[] = []): Promise<R[]> {
        const sqliteSql = convertPlaceholdersToSqlite(sqlText);
        return sqlite.prepare(sqliteSql).all(...params) as R[];
      },
      async queryOne<R = any>(sqlText: string, params: any[] = []): Promise<R | null> {
        const rows = await this.query<R>(sqlText, params);
        return rows.length > 0 ? rows[0] : null;
      },
      async execute(sqlText: string, params: any[] = []): Promise<{ rowCount: number; lastInsertId?: number }> {
        const sqliteSql = convertPlaceholdersToSqlite(sqlText);
        const info = sqlite.prepare(sqliteSql).run(...params);
        return { rowCount: info.changes, lastInsertId: Number(info.lastInsertRowid) };
      },
    };

    return await fn(txClient);
  }
}

// 5. Default db export object
export const db = {
  query,
  queryOne,
  execute,
  transaction,
};

export default db;
