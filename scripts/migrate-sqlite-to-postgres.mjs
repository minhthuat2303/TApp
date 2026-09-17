import Database from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

// Try loading .env and .env.local manually
function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      content.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    }
  }
}

loadEnv();

// 1. Connection string resolution
const argUrl = process.argv[2];
const connectionString = (
  argUrl ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DIRECT_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL
)?.trim();

if (!connectionString) {
  console.error('\n❌ [LỖI]: Chưa cung cấp chuỗi kết nối PostgreSQL (Connection String).');
  console.log('\n👉 Hướng dẫn chạy:');
  console.log('   node scripts/migrate-sqlite-to-postgres.mjs "postgres://default:xxx@ep-xxx.postgres.vercel-storage.com/verceldb"');
  console.log('   hoặc thêm POSTGRES_URL=... vào file .env.local\n');
  process.exit(1);
}

// 2. Open SQLite Database
const SQLITE_PATH = path.join(process.cwd(), 'data', 't_shop.db');
if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`❌ [LỖI]: Không tìm thấy file SQLite tại '${SQLITE_PATH}'.`);
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
console.log(`\n📦 [1/4] Đã mở thành công file SQLite: ${SQLITE_PATH}`);

// 3. Connect to PostgreSQL
let cleanUrl = connectionString.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]supa=[^&]*/gi, '').replace(/[?&]pgbouncer=[^&]*/gi, '');
if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

const isSsl = !cleanUrl.includes('localhost') && !cleanUrl.includes('127.0.0.1');
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: isSsl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
});

async function main() {
  const client = await pool.connect();
  console.log('🐘 [2/4] Đã kết nối thành công tới cơ sở dữ liệu PostgreSQL!');

  try {
    console.log('\n⚙️ [3/4] Khởi tạo cấu trúc bảng (Schema DDL) trên PostgreSQL...');
    await client.query('BEGIN');

    // 1. USERS
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
    `);

    // 2. CATEGORIES
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. PRODUCT TYPES
    await client.query(`
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
    `);

    // 4. PRODUCTS
    await client.query(`
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
    `);

    // 5. PRICE HISTORY
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price NUMERIC(15, 2) NOT NULL CHECK (price >= 0),
        effective_from DATE NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. COST PRICE HISTORY
    await client.query(`
      CREATE TABLE IF NOT EXISTS cost_price_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        cost_price NUMERIC(15, 2) NOT NULL CHECK (cost_price >= 0),
        effective_from DATE NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. SALES RECORDS
    await client.query(`
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
    `);

    // 8. STOCK MOVEMENTS
    await client.query(`
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
    `);

    // 9. SUPPLIERS
    await client.query(`
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
    `);

    // 10. IMPORTS
    await client.query(`
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
    `);

    // 11. IMPORT ITEMS
    await client.query(`
      CREATE TABLE IF NOT EXISTS import_items (
        id SERIAL PRIMARY KEY,
        import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost_price NUMERIC(15, 2) NOT NULL CHECK (unit_cost_price >= 0),
        total_amount NUMERIC(15, 2) NOT NULL CHECK (total_amount >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 12. IMPORT LOGS
    await client.query(`
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
    `);

    // 13. AUDIT LOGS
    await client.query(`
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
    `);

    // 14. INVENTORY LOTS (FIFO)
    await client.query(`
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
    `);

    // 15. SALE COST ALLOCATIONS
    await client.query(`
      CREATE TABLE IF NOT EXISTS sale_cost_allocations (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER NOT NULL REFERENCES sales_records(id) ON DELETE CASCADE,
        inventory_lot_id INTEGER NOT NULL REFERENCES inventory_lots(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost NUMERIC(15, 2) NOT NULL CHECK (unit_cost >= 0),
        total_cost NUMERIC(15, 2) NOT NULL CHECK (total_cost >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Indexes
    await client.query(`
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
    `);

    // Truncate tables with CASCADE to ensure clean import
    console.log('\n🧹 Dọn dẹp dữ liệu cũ trên PostgreSQL để chuyển dữ liệu mới...');
    await client.query(`
      TRUNCATE TABLE 
        sale_cost_allocations, 
        sales_records, 
        inventory_lots, 
        import_items, 
        imports, 
        suppliers, 
        stock_movements, 
        price_history, 
        cost_price_history, 
        products, 
        product_types, 
        categories, 
        users, 
        import_logs, 
        audit_logs 
      CASCADE;
    `);

    console.log('\n🚀 [4/4] Bắt đầu chuyển dữ liệu từng bảng...');

    // Ordered list of tables to migrate
    const tables = [
      'users',
      'categories',
      'product_types',
      'products',
      'price_history',
      'cost_price_history',
      'suppliers',
      'imports',
      'import_items',
      'inventory_lots',
      'sales_records',
      'sale_cost_allocations',
      'stock_movements',
      'import_logs',
      'audit_logs',
    ];

    const report = [];

    for (const table of tables) {
      let rows = [];
      try {
        rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      } catch (e) {
        console.warn(`  ⚠️ Bảng '${table}' không có trong SQLite, bỏ qua.`);
        report.push({ table, count: 0 });
        continue;
      }

      if (rows.length === 0) {
        report.push({ table, count: 0 });
        continue;
      }

      const columns = Object.keys(rows[0]);
      const colNames = columns.join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

      const insertSql = `INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map((col) => row[col]);
        await client.query(insertSql, values);
      }

      // Reset SERIAL sequence in PostgreSQL so new records get proper incremented IDs
      if (columns.includes('id')) {
        await client.query(`
          SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1));
        `);
      }

      report.push({ table, count: rows.length });
      console.log(`  ✅ Bảng '${table}': đã chuyển ${rows.length} dòng.`);
    }

    await client.query('COMMIT');

    console.log('\n======================================================');
    console.log('🎉 CHUYỂN DỮ LIỆU SANG POSTGRESQL THÀNH CÔNG RỰC RỠ!');
    console.log('======================================================');
    console.table(report);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ [LỖI TRONG QUÁ TRÌNH CHUYỂN DỮ LIỆU]:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
