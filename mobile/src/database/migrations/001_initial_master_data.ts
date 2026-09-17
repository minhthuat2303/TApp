import { Migration, ITransactionClient } from '../types';

export const migration001: Migration = {
  version: 1,
  name: '001_initial_master_data',
  up: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      -- Users / Staff Local Cache (strictly NO plaintext passwords)
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Categories Master Data
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Product Types Master Data
      CREATE TABLE IF NOT EXISTS product_types (
        id INTEGER PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Products Master Data
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE RESTRICT,
        current_cost_price REAL NOT NULL DEFAULT 0 CHECK (current_cost_price >= 0),
        current_selling_price REAL NOT NULL DEFAULT 0 CHECK (current_selling_price >= 0),
        current_stock INTEGER NOT NULL DEFAULT 0,
        min_stock_alert INTEGER NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Price History (Append-only snapshot price changes)
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price REAL NOT NULL CHECK (price >= 0),
        effective_from TEXT NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Cost Price History (Append-only snapshot cost changes)
      CREATE TABLE IF NOT EXISTS cost_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        cost_price REAL NOT NULL CHECK (cost_price >= 0),
        effective_from TEXT NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for fast autocomplete & lookup
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
      CREATE INDEX IF NOT EXISTS idx_products_cat_type ON products(category_id, product_type_id);
      CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
      CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(product_id, effective_from DESC);
      CREATE INDEX IF NOT EXISTS idx_cost_price_history_lookup ON cost_price_history(product_id, effective_from DESC);
    `);
  },
  down: async (db: ITransactionClient): Promise<void> => {
    await db.execAsync(`
      DROP TABLE IF EXISTS cost_price_history;
      DROP TABLE IF EXISTS price_history;
      DROP TABLE IF EXISTS products;
      DROP TABLE IF EXISTS product_types;
      DROP TABLE IF EXISTS categories;
      DROP TABLE IF EXISTS users;
    `);
  },
};
