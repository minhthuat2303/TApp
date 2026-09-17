// T_SHOP Mobile - Phase 10 Comprehensive Automated Inventory, Stock Movement, Cost/Profit, & Reporting Tests
import Database from 'better-sqlite3';
import crypto from 'crypto';

console.log('================================================================');
console.log('    T_SHOP MOBILE — PHASE 10 INVENTORY & COST/PROFIT TESTS      ');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

class NodeTestSqliteDriver {
  constructor(dbFile = ':memory:') {
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this._isOpen = true;
  }

  async execAsync(sql) {
    this.db.exec(sql);
  }

  async runAsync(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return {
      changes: info.changes,
      lastInsertRowId: Number(info.lastInsertRowid),
    };
  }

  async getAllAsync(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async getFirstAsync(sql, params = []) {
    const row = this.db.prepare(sql).get(...params);
    return row || null;
  }

  async withTransactionAsync(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const client = {
        execAsync: async (sql) => this.execAsync(sql),
        runAsync: async (sql, p) => this.runAsync(sql, p),
        getAllAsync: async (sql, p) => this.getAllAsync(sql, p),
        getFirstAsync: async (sql, p) => this.getFirstAsync(sql, p),
      };
      const result = await action(client);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

// Schemas v1 to v7
const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_types (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    product_type_id INTEGER NOT NULL REFERENCES product_types(id),
    current_cost_price REAL NOT NULL DEFAULT 0 CHECK (current_cost_price >= 0),
    current_selling_price REAL NOT NULL DEFAULT 0 CHECK (current_selling_price >= 0),
    current_stock INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    price REAL NOT NULL CHECK (price >= 0),
    effective_from TEXT NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cost_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    cost_price REAL NOT NULL CHECK (cost_price >= 0),
    effective_from TEXT NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_order_id TEXT UNIQUE NOT NULL,
    order_code TEXT UNIQUE NOT NULL,
    sale_date TEXT NOT NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    total_discount REAL NOT NULL DEFAULT 0 CHECK (total_discount >= 0),
    final_amount REAL NOT NULL CHECK (final_amount >= 0),
    total_items INTEGER NOT NULL CHECK (total_items > 0),
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sales_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_transaction_id TEXT UNIQUE NOT NULL,
    server_id INTEGER,
    order_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE,
    client_order_id TEXT,
    transaction_code TEXT UNIQUE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    sale_date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_at_sale REAL NOT NULL CHECK (unit_price_at_sale >= 0),
    cost_price_at_sale REAL NOT NULL CHECK (cost_price_at_sale >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total_revenue REAL NOT NULL CHECK (total_revenue >= 0),
    total_cost REAL NOT NULL CHECK (total_cost >= 0),
    profit REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    cancel_reason TEXT,
    cancelled_at TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_import_id TEXT UNIQUE NOT NULL,
    server_id INTEGER,
    import_code TEXT UNIQUE NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    import_date TEXT NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    note TEXT,
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_price REAL NOT NULL CHECK (unit_cost_price >= 0),
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inventory_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_code TEXT UNIQUE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    purchase_date TEXT NOT NULL,
    quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
    quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
    unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
    supplier_id INTEGER REFERENCES suppliers(id),
    import_id INTEGER,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_movement_id TEXT UNIQUE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('SALE', 'PURCHASE', 'DAMAGE', 'LOSS', 'GIFT', 'RETURN', 'ADJUSTMENT')),
    quantity_change INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    movement_date TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCED')),
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_mutation_id TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TEXT,
    payload_version INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER,
    device_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// Helper: Seed master data
async function seedMasterData(driver) {
  await driver.execAsync(schemaSql);

  await driver.runAsync('INSERT INTO users (id, username, full_name, role) VALUES (?, ?, ?, ?)', [
    1, 'admin', 'System Administrator', 'ADMIN'
  ]);
  await driver.runAsync('INSERT INTO categories (id, code, name) VALUES (?, ?, ?)', [
    1, 'CAT_CLOTHES', 'Quần Áo'
  ]);
  await driver.runAsync('INSERT INTO product_types (id, category_id, code, name) VALUES (?, ?, ?, ?)', [
    1, 1, 'TYPE_SHIRT', 'Áo Sơ Mi'
  ]);
  await driver.runAsync('INSERT INTO suppliers (id, code, name) VALUES (?, ?, ?)', [
    1, 'NCC01', 'Nhà Cung Cấp May Mặc An Phú'
  ]);
  await driver.runAsync(
    `INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, 'AO-SOM-01', 'Áo Sơ Mi Trắng Oxford', 1, 1, 0, 250000, 0, 5]
  );
  await driver.runAsync(
    `INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock, min_stock_alert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [2, 'AO-THUN-02', 'Áo Thun Cotton Basic', 1, 1, 50000, 120000, 20, 5]
  );
}

// Logic: Recompute weighted average cost exactly matching Web
async function recomputeProductCostPrice(driver, productId) {
  const activeLots = await driver.getAllAsync(
    `SELECT quantity_remaining, unit_cost FROM inventory_lots 
     WHERE product_id = ? AND quantity_remaining > 0`,
    [productId]
  );

  let newCost = 0;
  if (activeLots.length > 0) {
    const totalRemaining = activeLots.reduce((sum, l) => sum + l.quantity_remaining, 0);
    const totalValue = activeLots.reduce((sum, l) => sum + (l.quantity_remaining * l.unit_cost), 0);
    newCost = totalRemaining > 0 ? Math.round(totalValue / totalRemaining) : 0;
  }
  return newCost;
}

// Logic: Multi-item Import Stock
async function importStock(driver, input) {
  return await driver.withTransactionAsync(async (tx) => {
    const importCode = `IMP-${Date.now()}`;
    const clientImportId = crypto.randomUUID();
    const importDate = input.import_date || new Date().toISOString().split('T')[0];

    let totalAmount = 0;
    input.items.forEach(it => {
      totalAmount += it.quantity * it.unit_cost_price;
    });

    const impRes = await tx.runAsync(
      `INSERT INTO imports (client_import_id, import_code, supplier_id, import_date, total_amount, note, sync_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [clientImportId, importCode, input.supplier_id || null, importDate, totalAmount, input.note || null, input.user_id || 1]
    );
    const importId = impRes.lastInsertRowId;

    for (const item of input.items) {
      const lineTotal = item.quantity * item.unit_cost_price;
      await tx.runAsync(
        `INSERT INTO import_items (import_id, product_id, quantity, unit_cost_price, total_amount)
         VALUES (?, ?, ?, ?, ?)`,
        [importId, item.product_id, item.quantity, item.unit_cost_price, lineTotal]
      );

      // Create lot
      const lotCode = `LOT-${item.product_id}-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      await tx.runAsync(
        `INSERT INTO inventory_lots (lot_code, product_id, purchase_date, quantity_received, quantity_remaining, unit_cost, supplier_id, import_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lotCode, item.product_id, importDate, item.quantity, item.quantity, item.unit_cost_price, input.supplier_id || null, importId, input.user_id || 1]
      );

      // Current product stock
      const prod = await tx.getFirstAsync('SELECT current_stock FROM products WHERE id = ?', [item.product_id]);
      const newStock = (prod ? prod.current_stock : 0) + item.quantity;

      // Update product stock
      await tx.runAsync('UPDATE products SET current_stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        newStock, item.product_id
      ]);

      // Record stock movement (PURCHASE)
      const clientMovementId = crypto.randomUUID();
      await tx.runAsync(
        `INSERT INTO stock_movements (client_movement_id, product_id, movement_type, quantity_change, balance_after, movement_date, reference_type, reference_id, sync_status, created_by)
         VALUES (?, ?, 'PURCHASE', ?, ?, ?, 'IMPORT', ?, 'PENDING', ?)`,
        [clientMovementId, item.product_id, item.quantity, newStock, importDate, importCode, input.user_id || 1]
      );

      // Record cost price history
      await tx.runAsync(
        `INSERT INTO cost_price_history (product_id, cost_price, effective_from, note, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [item.product_id, item.unit_cost_price, importDate, `Nhập hàng ${importCode}`, input.user_id || 1]
      );

      // Recompute weighted average cost
      const activeLots = await tx.getAllAsync(
        `SELECT quantity_remaining, unit_cost FROM inventory_lots 
         WHERE product_id = ? AND quantity_remaining > 0`,
        [item.product_id]
      );
      let avgCost = 0;
      if (activeLots.length > 0) {
        const totalRem = activeLots.reduce((s, l) => s + l.quantity_remaining, 0);
        const totalVal = activeLots.reduce((s, l) => s + (l.quantity_remaining * l.unit_cost), 0);
        avgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : 0;
      }
      await tx.runAsync('UPDATE products SET current_cost_price = ? WHERE id = ?', [avgCost, item.product_id]);
    }

    // Enqueue Outbox mutation for IMPORT
    const mutationId = crypto.randomUUID();
    await tx.runAsync(
      `INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload_json, status, user_id, device_id)
       VALUES (?, 'IMPORT', ?, 'CREATE', ?, 'PENDING', ?, ?)`,
      [mutationId, clientImportId, JSON.stringify({
        client_import_id: clientImportId,
        import_code: importCode,
        supplier_id: input.supplier_id,
        import_date: importDate,
        total_amount: totalAmount,
        note: input.note,
        items: input.items,
      }), input.user_id || 1, 'TEST_DEVICE_01']
    );

    return { importId, clientImportId, importCode, totalAmount };
  });
}

// Logic: FIFO Sale COGS and Deductions
async function processSaleWithFIFO(driver, sale) {
  return await driver.withTransactionAsync(async (tx) => {
    const prod = await tx.getFirstAsync('SELECT * FROM products WHERE id = ?', [sale.product_id]);
    if (!prod) throw new Error('Product not found');
    if (prod.current_stock < sale.quantity) {
      throw new Error(`Insufficient stock: available ${prod.current_stock}, requested ${sale.quantity}`);
    }

    // Allocate FIFO from inventory_lots
    const lots = await tx.getAllAsync(
      `SELECT * FROM inventory_lots 
       WHERE product_id = ? AND quantity_remaining > 0 
       ORDER BY purchase_date ASC, id ASC`,
      [sale.product_id]
    );

    let remainingToFulfill = sale.quantity;
    let totalCogs = 0;
    const lotAllocations = [];

    for (const lot of lots) {
      if (remainingToFulfill <= 0) break;
      const take = Math.min(lot.quantity_remaining, remainingToFulfill);
      const costForThis = take * lot.unit_cost;
      totalCogs += costForThis;
      remainingToFulfill -= take;

      lotAllocations.push({
        lot_id: lot.id,
        lot_code: lot.lot_code,
        quantity: take,
        unit_cost: lot.unit_cost,
        subtotal_cost: costForThis,
      });

      // Update lot remaining
      await tx.runAsync(
        'UPDATE inventory_lots SET quantity_remaining = quantity_remaining - ? WHERE id = ?',
        [take, lot.id]
      );
    }

    if (remainingToFulfill > 0) {
      // Fallback if lots do not cover (e.g. initial stock without lot)
      totalCogs += remainingToFulfill * prod.current_cost_price;
    }

    const unitCostAtSale = totalCogs / sale.quantity;
    const totalRevenue = sale.quantity * sale.unit_price - (sale.discount || 0);
    const profit = totalRevenue - totalCogs;

    const clientTxId = crypto.randomUUID();
    const txCode = `HD-${Date.now()}`;
    const saleDate = sale.sale_date || new Date().toISOString().split('T')[0];

    // Create sales_records
    await tx.runAsync(
      `INSERT INTO sales_records (client_transaction_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, sync_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?)`,
      [clientTxId, txCode, sale.product_id, saleDate, sale.quantity, sale.unit_price, unitCostAtSale, sale.discount || 0, totalRevenue, totalCogs, profit, sale.user_id || 1]
    );

    // Deduct product stock
    const newStock = prod.current_stock - sale.quantity;
    await tx.runAsync('UPDATE products SET current_stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [
      newStock, sale.product_id
    ]);

    // Record stock movement (SALE)
    const clientMovementId = crypto.randomUUID();
    await tx.runAsync(
      `INSERT INTO stock_movements (client_movement_id, product_id, movement_type, quantity_change, balance_after, movement_date, reference_type, reference_id, sync_status, created_by)
       VALUES (?, ?, 'SALE', ?, ?, ?, 'SALE', ?, 'PENDING', ?)`,
      [clientMovementId, sale.product_id, -sale.quantity, newStock, saleDate, txCode, sale.user_id || 1]
    );

    // Recompute weighted average cost of remaining stock
    const activeLots = await tx.getAllAsync(
      `SELECT quantity_remaining, unit_cost FROM inventory_lots 
       WHERE product_id = ? AND quantity_remaining > 0`,
      [sale.product_id]
    );
    let avgCost = 0;
    if (activeLots.length > 0) {
      const totalRem = activeLots.reduce((s, l) => s + l.quantity_remaining, 0);
      const totalVal = activeLots.reduce((s, l) => s + (l.quantity_remaining * l.unit_cost), 0);
      avgCost = totalRem > 0 ? Math.round(totalVal / totalRem) : 0;
    } else if (newStock > 0) {
      avgCost = prod.current_cost_price;
    }
    await tx.runAsync('UPDATE products SET current_cost_price = ? WHERE id = ?', [avgCost, sale.product_id]);

    return {
      clientTxId,
      txCode,
      quantity: sale.quantity,
      unitCostAtSale,
      totalRevenue,
      totalCogs,
      profit,
      newStock,
      avgCostAfterSale: avgCost,
      lotAllocations,
    };
  });
}

// Logic: Stock Adjustment
async function adjustStock(driver, input) {
  return await driver.withTransactionAsync(async (tx) => {
    const prod = await tx.getFirstAsync('SELECT current_stock FROM products WHERE id = ?', [input.product_id]);
    if (!prod) throw new Error('Product not found');

    const newStock = prod.current_stock + input.quantity_change;
    if (newStock < 0) {
      throw new Error(`Insufficient stock for adjustment: current ${prod.current_stock}, change ${input.quantity_change}`);
    }

    const clientMovementId = crypto.randomUUID();
    const movementDate = input.movement_date || new Date().toISOString().split('T')[0];

    // Append to stock_movements
    await tx.runAsync(
      `INSERT INTO stock_movements (client_movement_id, product_id, movement_type, quantity_change, balance_after, movement_date, reference_type, reference_id, sync_status, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, 'PENDING', ?, ?)`,
      [clientMovementId, input.product_id, input.movement_type, input.quantity_change, newStock, movementDate, clientMovementId, input.note || null, input.user_id || 1]
    );

    // Update products table
    await tx.runAsync('UPDATE products SET current_stock = ?, updated_at = datetime(\'now\') WHERE id = ?', [
      newStock, input.product_id
    ]);

    // Enqueue Outbox mutation for INVENTORY_ADJUSTMENT
    const mutationId = crypto.randomUUID();
    await tx.runAsync(
      `INSERT INTO sync_queue (client_mutation_id, entity_type, entity_id, action, payload_json, status, user_id, device_id)
       VALUES (?, 'INVENTORY_ADJUSTMENT', ?, 'UPDATE', ?, 'PENDING', ?, ?)`,
      [mutationId, clientMovementId, JSON.stringify({
        client_movement_id: clientMovementId,
        product_id: input.product_id,
        movement_type: input.movement_type,
        quantity_change: input.quantity_change,
        balance_after: newStock,
        movement_date: movementDate,
        note: input.note || null,
        created_by: input.user_id || 1,
      }), input.user_id || 1, 'TEST_DEVICE_01']
    );

    return { clientMovementId, newStock, quantityChange: input.quantity_change };
  });
}

// Logic: Analytics Aggregations
async function getDashboardSummary(driver, period) {
  let dateFilter = "strftime('%Y-%m-%d', sale_date) = date('now')";
  if (period === '7days') {
    dateFilter = "strftime('%Y-%m-%d', sale_date) >= date('now', '-7 days')";
  } else if (period === '30days') {
    dateFilter = "strftime('%Y-%m-%d', sale_date) >= date('now', '-30 days')";
  } else if (period === 'this_month') {
    dateFilter = "strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')";
  }

  const kpis = await driver.getFirstAsync(`
    SELECT 
      COALESCE(SUM(total_revenue), 0) as total_revenue,
      COALESCE(SUM(total_cost), 0) as total_cost,
      COALESCE(SUM(profit), 0) as gross_profit,
      COALESCE(COUNT(*), 0) as total_orders,
      COALESCE(SUM(quantity), 0) as total_units_sold
    FROM sales_records
    WHERE status = 'COMPLETED' AND ${dateFilter}
  `);

  const inv = await driver.getFirstAsync(`
    SELECT 
      COALESCE(SUM(current_stock * current_cost_price), 0) as inventory_value,
      COALESCE(SUM(current_stock), 0) as total_stock,
      COUNT(CASE WHEN current_stock <= min_stock_alert THEN 1 END) as low_stock_count
    FROM products
    WHERE status = 'ACTIVE'
  `);

  const totalRev = Number(kpis?.total_revenue || 0);
  const totalCost = Number(kpis?.total_cost || 0);
  const grossProfit = Number(kpis?.gross_profit || 0);
  const grossMargin = totalRev > 0 ? (grossProfit / totalRev) * 100 : 0;

  return {
    period,
    total_revenue: totalRev,
    total_cost: totalCost,
    gross_profit: grossProfit,
    gross_margin_percent: Math.round(grossMargin * 10) / 10,
    total_orders: Number(kpis?.total_orders || 0),
    total_units_sold: Number(kpis?.total_units_sold || 0),
    inventory_value: Number(inv?.inventory_value || 0),
    low_stock_count: Number(inv?.low_stock_count || 0),
    total_stock: Number(inv?.total_stock || 0),
  };
}

async function runPhase10Tests() {
  const driver = new NodeTestSqliteDriver();
  await seedMasterData(driver);

  console.log('--- TEST SUITE 1: Multi-item Import Stock & Lot Creation ---');
  // Import 1: Product 1 (Áo sơ mi) 10 units @ 100,000 VND
  const import1 = await importStock(driver, {
    supplier_id: 1,
    import_date: '2026-09-01',
    note: 'Đợt nhập sơ mi trắng lô 1',
    items: [
      { product_id: 1, quantity: 10, unit_cost_price: 100000 },
    ],
  });

  assert(import1.importId > 0, 'Import 1 created successfully with valid ID');
  assert(import1.totalAmount === 1000000, 'Import 1 total amount correctly computed (10 * 100,000 = 1,000,000)');

  const prodAfterImp1 = await driver.getFirstAsync('SELECT current_stock, current_cost_price FROM products WHERE id = 1');
  assert(prodAfterImp1.current_stock === 10, 'Product 1 stock increased to 10');
  assert(prodAfterImp1.current_cost_price === 100000, 'Product 1 weighted avg cost price initialized to 100,000');

  const lotsAfterImp1 = await driver.getAllAsync('SELECT * FROM inventory_lots WHERE product_id = 1');
  assert(lotsAfterImp1.length === 1, 'Exactly 1 lot created for Product 1');
  assert(lotsAfterImp1[0].quantity_received === 10 && lotsAfterImp1[0].quantity_remaining === 10, 'Lot 1 has 10 received and 10 remaining');
  assert(lotsAfterImp1[0].unit_cost === 100000, 'Lot 1 unit cost is 100,000');

  const mvAfterImp1 = await driver.getAllAsync("SELECT * FROM stock_movements WHERE product_id = 1 AND movement_type = 'PURCHASE'");
  assert(mvAfterImp1.length === 1, 'PURCHASE stock movement recorded');
  assert(mvAfterImp1[0].quantity_change === 10 && mvAfterImp1[0].balance_after === 10, 'Movement shows +10 change and balance 10');

  const costHist1 = await driver.getAllAsync('SELECT * FROM cost_price_history WHERE product_id = 1');
  assert(costHist1.length === 1, 'Cost price history logged');
  assert(costHist1[0].cost_price === 100000, 'Cost price history recorded 100,000');

  const outboxAfterImp1 = await driver.getAllAsync("SELECT * FROM sync_queue WHERE entity_type = 'IMPORT'");
  assert(outboxAfterImp1.length === 1, 'Outbox enqueued IMPORT mutation');
  assert(outboxAfterImp1[0].action === 'CREATE' && outboxAfterImp1[0].status === 'PENDING', 'Outbox mutation is CREATE and PENDING');

  console.log('\n--- TEST SUITE 2: Multiple Import Costs & Weighted Average Cost ---');
  // Import 2: Product 1 gets additional 20 units @ 160,000 VND
  const import2 = await importStock(driver, {
    supplier_id: 1,
    import_date: '2026-09-05',
    note: 'Đợt nhập sơ mi trắng lô 2 (giá nhập tăng)',
    items: [
      { product_id: 1, quantity: 20, unit_cost_price: 160000 },
    ],
  });

  const prodAfterImp2 = await driver.getFirstAsync('SELECT current_stock, current_cost_price FROM products WHERE id = 1');
  assert(prodAfterImp2.current_stock === 30, 'Product 1 stock is now 30 (10 + 20)');

  // Mathematical verification:
  // Lot 1: 10 units @ 100,000 = 1,000,000
  // Lot 2: 20 units @ 160,000 = 3,200,000
  // Total Value = 4,200,000. Total Units = 30.
  // Weighted Average Cost = 4,200,000 / 30 = 140,000 VND
  assert(prodAfterImp2.current_cost_price === 140000, `Weighted average cost correctly calculated: expected 140000, got ${prodAfterImp2.current_cost_price}`);

  const lotsAfterImp2 = await driver.getAllAsync('SELECT * FROM inventory_lots WHERE product_id = 1 ORDER BY purchase_date ASC');
  assert(lotsAfterImp2.length === 2, '2 separate inventory lots preserved (FIFO tracking)');
  assert(lotsAfterImp2[0].quantity_remaining === 10 && lotsAfterImp2[1].quantity_remaining === 20, 'Lots maintain distinct remaining balances');

  console.log('\n--- TEST SUITE 3: FIFO COGS & Sales Profit Calculation ---');
  // Sell 15 units of Product 1 @ 250,000 VND (Selling Price)
  // FIFO Deduction:
  // 10 units from Lot 1 @ 100,000 = 1,000,000 VND COGS (Lot 1 remaining becomes 0)
  // 5 units from Lot 2 @ 160,000 = 800,000 VND COGS (Lot 2 remaining becomes 15)
  // Total COGS = 1,800,000 VND. Unit cost at sale = 1,800,000 / 15 = 120,000 VND.
  // Total Revenue = 15 * 250,000 = 3,750,000 VND.
  // Gross Profit = 3,750,000 - 1,800,000 = 1,950,000 VND.
  // Remaining stock = 15 units (all in Lot 2 @ 160,000).
  // New Weighted Average Cost of remaining stock = 160,000 VND.

  const todayStr = new Date().toISOString().split('T')[0];
  const saleRes = await processSaleWithFIFO(driver, {
    product_id: 1,
    quantity: 15,
    unit_price: 250000,
    discount: 0,
    sale_date: todayStr,
    user_id: 1,
  });

  assert(saleRes.totalRevenue === 3750000, 'Total revenue is 3,750,000');
  assert(saleRes.totalCogs === 1800000, `FIFO COGS exactly 1,800,000: got ${saleRes.totalCogs}`);
  assert(saleRes.profit === 1950000, `Gross Profit exactly 1,950,000 (Revenue - FIFO COGS): got ${saleRes.profit}`);
  assert(saleRes.newStock === 15, 'Stock reduced to 15');
  assert(saleRes.avgCostAfterSale === 160000, `Cost of remaining stock updated to 160,000 (Lot 2 only): got ${saleRes.avgCostAfterSale}`);

  const lotsAfterSale = await driver.getAllAsync('SELECT * FROM inventory_lots WHERE product_id = 1 ORDER BY purchase_date ASC');
  assert(lotsAfterSale[0].quantity_remaining === 0, 'Lot 1 fully depleted (quantity_remaining = 0)');
  assert(lotsAfterSale[1].quantity_remaining === 15, 'Lot 2 partially consumed (quantity_remaining = 15)');

  const salesRecord = await driver.getFirstAsync('SELECT * FROM sales_records WHERE transaction_code = ?', [saleRes.txCode]);
  assert(salesRecord.total_cost === 1800000, 'sales_records total_cost saved accurately');
  assert(salesRecord.profit === 1950000, 'sales_records profit saved accurately');

  const saleMovement = await driver.getFirstAsync('SELECT * FROM stock_movements WHERE reference_id = ?', [saleRes.txCode]);
  assert(saleMovement.movement_type === 'SALE' && saleMovement.quantity_change === -15, 'SALE stock movement recorded with -15 change');
  assert(saleMovement.balance_after === 15, 'Stock movement balance_after is 15');

  console.log('\n--- TEST SUITE 4: Insufficient Stock Protection ---');
  let errorCaught = false;
  try {
    await processSaleWithFIFO(driver, {
      product_id: 1,
      quantity: 50, // Only 15 available!
      unit_price: 250000,
    });
  } catch (err) {
    errorCaught = true;
    assert(err.message.includes('Insufficient stock'), `Validation caught deficit: "${err.message}"`);
  }
  assert(errorCaught, 'Sale blocked when attempting to oversell stock');

  console.log('\n--- TEST SUITE 5: Offline Stock Adjustment & Outbox ---');
  // Perform DAMAGE adjustment of -2 units
  const adjRes = await adjustStock(driver, {
    product_id: 1,
    movement_type: 'DAMAGE',
    quantity_change: -2,
    movement_date: todayStr,
    note: 'Áo bị ố vàng lúc trưng bày',
    user_id: 1,
  });

  assert(adjRes.newStock === 13, 'Stock updated to 13 after -2 DAMAGE');

  const adjMovement = await driver.getFirstAsync('SELECT * FROM stock_movements WHERE client_movement_id = ?', [adjRes.clientMovementId]);
  assert(adjMovement.movement_type === 'DAMAGE' && adjMovement.quantity_change === -2, 'DAMAGE movement logged with -2 quantity change');
  assert(adjMovement.balance_after === 13, 'Movement balance_after reflects 13');

  const adjOutbox = await driver.getFirstAsync("SELECT * FROM sync_queue WHERE entity_type = 'INVENTORY_ADJUSTMENT' AND entity_id = ?", [adjRes.clientMovementId]);
  assert(adjOutbox !== null, 'INVENTORY_ADJUSTMENT queued in sync_queue Outbox');
  assert(adjOutbox.action === 'UPDATE' && adjOutbox.status === 'PENDING', 'Adjustment outbox record status is PENDING');

  // Verify adjustment cannot reduce stock below 0
  let adjErrorCaught = false;
  try {
    await adjustStock(driver, {
      product_id: 1,
      movement_type: 'LOSS',
      quantity_change: -20, // Only 13 available!
    });
  } catch (err) {
    adjErrorCaught = true;
    assert(err.message.includes('Insufficient stock'), `Stock adjustment deficit prevented: "${err.message}"`);
  }
  assert(adjErrorCaught, 'Stock adjustment correctly blocked when reducing stock below 0');

  console.log('\n--- TEST SUITE 6: Analytics, Dashboard KPIs, & Reports ---');
  const todaySummary = await getDashboardSummary(driver, 'today');
  assert(todaySummary.total_revenue === 3750000, 'Today revenue matches sale: 3,750,000');
  assert(todaySummary.total_cost === 1800000, 'Today COGS matches sale: 1,800,000');
  assert(todaySummary.gross_profit === 1950000, 'Today gross profit matches sale: 1,950,000');
  assert(todaySummary.gross_margin_percent === 52, `Gross margin % accurate: expected 52%, got ${todaySummary.gross_margin_percent}%`);
  assert(todaySummary.total_orders === 1, 'Total completed orders is 1');
  assert(todaySummary.total_units_sold === 15, 'Total units sold is 15');

  // Inventory value verification:
  // Product 1: 13 units @ 160,000 = 2,080,000
  // Product 2: 20 units @ 50,000 = 1,000,000
  // Total Inventory Value = 3,080,000
  const expectedInvValue = (13 * 160000) + (20 * 50000);
  assert(todaySummary.inventory_value === expectedInvValue, `Inventory value matches sum(stock * cost): expected ${expectedInvValue}, got ${todaySummary.inventory_value}`);

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runPhase10Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
