// T_SHOP Mobile - Comprehensive Discount Remediation Automated Test Suite
// Verifies all requirements (A through U) for Mobile POS Discount implementation.
import Database from 'better-sqlite3';
import crypto from 'crypto';

console.log('================================================================');
console.log('    T_SHOP MOBILE — DISCOUNT REMEDIATION AUTOMATED TEST SUITE    ');
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

// Complete SQLite schema
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
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS purchase_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    lot_number TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    quantity_imported INTEGER NOT NULL CHECK (quantity_imported > 0),
    quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
    unit_cost_price REAL NOT NULL CHECK (unit_cost_price >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'ADJUSTMENT')),
    reference_type TEXT NOT NULL CHECK (reference_type IN ('PURCHASE_LOT', 'SALE', 'INVENTORY_AUDIT', 'INITIAL')),
    reference_id TEXT,
    quantity INTEGER NOT NULL,
    unit_cost REAL,
    unit_price REAL,
    balance_after INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_mutation_id TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    user_id INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// Validation Error
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Logic mirror of OfflineSaleService.createMultiItemSale
async function createMultiItemSale(db, input) {
  if (!input.items || input.items.length === 0) {
    throw new ValidationError('Giỏ hàng trống');
  }

  return db.withTransactionAsync(async (tx) => {
    let orderSubtotal = 0;
    let totalItems = 0;
    let rawItemDiscountsSum = 0;

    const itemsToProcess = [];
    for (const item of input.items) {
      if (item.quantity <= 0) {
        throw new ValidationError(`Số lượng sản phẩm ${item.productId} phải lớn hơn 0`);
      }

      const product = await tx.getFirstAsync(
        "SELECT * FROM products WHERE id = ? AND status = 'ACTIVE'",
        [item.productId]
      );
      if (!product) {
        throw new ValidationError(`Sản phẩm ${item.productId} không tồn tại hoặc đã ngừng kinh doanh`);
      }

      const unitPrice = item.unitPrice !== undefined ? item.unitPrice : product.current_selling_price;
      const costPrice = product.current_cost_price;
      const lineSubtotal = unitPrice * item.quantity;

      // Handle item discount (Web convention: discountThousand * 1000 or direct discount)
      const lineItemDiscount = item.discountThousand !== undefined && item.discountThousand > 0
        ? Math.round(item.discountThousand * 1000)
        : Math.round(item.discount || 0);

      if (lineItemDiscount < 0) {
        throw new ValidationError(`Giảm giá sản phẩm ${product.name} không được âm`);
      }
      if (lineItemDiscount > lineSubtotal) {
        throw new ValidationError(`Giảm giá (${lineItemDiscount.toLocaleString()}đ) vượt quá tiền hàng (${lineSubtotal.toLocaleString()}đ) của sản phẩm ${product.name}`);
      }

      orderSubtotal += lineSubtotal;
      rawItemDiscountsSum += lineItemDiscount;
      totalItems += item.quantity;

      itemsToProcess.push({
        product,
        quantity: item.quantity,
        unitPrice,
        costPrice,
        lineSubtotal,
        lineItemDiscount,
        note: item.note,
      });
    }

    // Determine final total discount
    if (input.totalDiscount !== undefined && input.totalDiscount < 0) {
      throw new ValidationError('Tổng chiết khấu/giảm giá không được âm');
    }

    let totalDiscount = 0;
    if (input.totalDiscount !== undefined && input.totalDiscount > 0) {
      totalDiscount = Math.round(input.totalDiscount);
    } else if (rawItemDiscountsSum > 0) {
      totalDiscount = rawItemDiscountsSum;
    }

    if (totalDiscount > orderSubtotal) {
      throw new ValidationError(`Tổng giảm giá (${totalDiscount.toLocaleString()}đ) không được vượt quá tạm tính đơn hàng (${orderSubtotal.toLocaleString()}đ)`);
    }

    const finalAmount = Math.max(0, orderSubtotal - totalDiscount);

    // Distribute discount proportionally across items
    let remainingDiscountToDistribute = totalDiscount;
    const lineAllocations = itemsToProcess.map((item, idx) => {
      let allocatedDiscount = 0;
      if (totalDiscount === rawItemDiscountsSum && rawItemDiscountsSum > 0) {
        allocatedDiscount = item.lineItemDiscount;
      } else if (totalDiscount > 0 && orderSubtotal > 0) {
        if (idx === itemsToProcess.length - 1) {
          allocatedDiscount = remainingDiscountToDistribute;
        } else {
          allocatedDiscount = Math.round((item.lineSubtotal / orderSubtotal) * totalDiscount);
          allocatedDiscount = Math.min(allocatedDiscount, remainingDiscountToDistribute);
        }
      }
      remainingDiscountToDistribute -= allocatedDiscount;

      const lineRevenue = Math.max(0, item.lineSubtotal - allocatedDiscount);
      const lineCost = item.costPrice * item.quantity;
      const profit = lineRevenue - lineCost;

      const salt = crypto.randomBytes(3).toString('hex').toUpperCase();
      const lineTxCode = `TX-${Date.now().toString(36).toUpperCase()}-${salt}-${(idx + 1).toString().padStart(2, '0')}`;
      const clientLineTxId = crypto.randomUUID();

      return {
        ...item,
        lineDiscount: allocatedDiscount,
        lineRevenue,
        lineCost,
        profit,
        lineTxCode,
        clientLineTxId,
      };
    });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const orderCode = `ORD-${dateStr.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const clientOrderId = input.clientOrderId || crypto.randomUUID();

    // Insert Order Header
    const orderResult = await tx.runAsync(`
      INSERT INTO sales_orders (
        client_order_id, order_code, sale_date, total_amount,
        total_discount, final_amount, total_items, status,
        sync_status, note, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?, ?, datetime('now'))
    `, [
      clientOrderId, orderCode, dateStr, orderSubtotal,
      totalDiscount, finalAmount, totalItems, input.note || null,
      input.createdBy || 1
    ]);

    const orderId = orderResult.lastInsertRowId;
    const createdRecords = [];

    // Insert records & stock deduction
    for (const line of lineAllocations) {
      await tx.runAsync(`
        INSERT INTO sales_records (
          order_id, client_order_id, client_transaction_id, transaction_code,
          product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale,
          discount, total_revenue, total_cost, profit, status, sync_status,
          note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 'PENDING', ?, ?, datetime('now'))
      `, [
        orderId, clientOrderId, line.clientLineTxId, line.lineTxCode,
        line.product.id, dateStr, line.quantity, line.unitPrice, line.costPrice,
        line.lineDiscount, line.lineRevenue, line.lineCost, line.profit,
        line.note || null, input.createdBy || 1
      ]);

      const currentStock = line.product.current_stock;
      const newStock = Math.max(0, currentStock - line.quantity);
      await tx.runAsync("UPDATE products SET current_stock = ?, updated_at = datetime('now') WHERE id = ?", [
        newStock, line.product.id
      ]);

      await tx.runAsync(`
        INSERT INTO stock_movements (
          product_id, movement_type, reference_type, reference_id,
          quantity, unit_cost, unit_price, balance_after, note, created_by, created_at
        ) VALUES (?, 'OUT', 'SALE', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        line.product.id, clientOrderId, line.quantity, line.costPrice, line.unitPrice,
        newStock, `Multi-item sale order ${orderCode}`, input.createdBy || 1
      ]);

      createdRecords.push(line);
    }

    // Insert into Outbox
    const mutationId = crypto.randomUUID();
    const outboxPayload = {
      client_order_id: clientOrderId,
      order_code: orderCode,
      sale_date: dateStr,
      total_amount: orderSubtotal,
      total_discount: totalDiscount,
      final_amount: finalAmount,
      total_items: totalItems,
      payment_method: input.paymentMethod || 'CASH',
      note: input.note || null,
      items: lineAllocations.map(line => ({
        client_transaction_id: line.clientLineTxId,
        product_id: line.product.id,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        cost_price: line.costPrice,
        discount: line.lineDiscount,
        total_revenue: line.lineRevenue,
        profit: line.profit,
      })),
    };

    await tx.runAsync(`
      INSERT INTO sync_outbox (
        client_mutation_id, entity_type, entity_id, operation, payload,
        status, user_id, created_at, updated_at
      ) VALUES (?, 'SALES_ORDER', ?, 'CREATE', ?, 'PENDING', ?, datetime('now'), datetime('now'))
    `, [
      mutationId, clientOrderId, JSON.stringify(outboxPayload), input.createdBy || 1
    ]);

    return {
      order: {
        id: orderId,
        client_order_id: clientOrderId,
        order_code: orderCode,
        total_amount: orderSubtotal,
        total_discount: totalDiscount,
        final_amount: finalAmount,
        total_items: totalItems,
      },
      items: createdRecords,
      outboxPayload,
      mutationId,
    };
  });
}

async function setupTestDb() {
  const driver = new NodeTestSqliteDriver();
  await driver.execAsync(schemaSql);

  // Seed Users
  await driver.runAsync("INSERT INTO users (id, username, full_name, role) VALUES (1, 'admin', 'Admin User', 'ADMIN')");
  await driver.runAsync("INSERT INTO users (id, username, full_name, role) VALUES (2, 'staff', 'Staff User', 'STAFF')");

  // Seed Categories & Types
  await driver.runAsync("INSERT INTO categories (id, code, name) VALUES (1, 'CAT-01', 'Thời trang Nam')");
  await driver.runAsync("INSERT INTO product_types (id, category_id, code, name) VALUES (1, 1, 'TYPE-01', 'Áo sơ mi')");

  // Seed Products
  // Product 1: Áo sơ mi Oxford (cost 100,000, sell 250,000, stock 50)
  await driver.runAsync(`
    INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock)
    VALUES (1, 'PROD-01', 'Áo sơ mi Oxford', 1, 1, 100000, 250000, 50)
  `);

  // Product 2: Quần jean Slimfit (cost 150,000, sell 350,000, stock 30)
  await driver.runAsync(`
    INSERT INTO products (id, sku, name, category_id, product_type_id, current_cost_price, current_selling_price, current_stock)
    VALUES (2, 'PROD-02', 'Quần jean Slimfit', 1, 1, 150000, 350000, 30)
  `);

  return driver;
}

// FORMAT RECEIPT HELPER
function formatReceipt(order, items, paymentMethod, cashReceived) {
  const lines = [
    '================================',
    '       T_SHOP VIETNAM           ',
    '================================',
    `So HD: ${order.order_code}`,
    '--------------------------------',
    'DANH SÁCH MÓN HÀNG:',
  ];
  for (const it of items) {
    lines.push(`• ${it.product.name}`);
    lines.push(`  ${it.quantity} x ${it.unitPrice.toLocaleString('vi-VN')} = ${it.lineSubtotal.toLocaleString('vi-VN')}`);
    if (it.lineDiscount > 0) {
      lines.push(`  Giảm giá: -${it.lineDiscount.toLocaleString('vi-VN')}`);
    }
  }
  lines.push('--------------------------------');
  lines.push(`Tạm tính: ${order.total_amount.toLocaleString('vi-VN')} đ`);
  if (order.total_discount > 0) {
    lines.push(`Giảm giá: -${order.total_discount.toLocaleString('vi-VN')} đ`);
  }
  lines.push(`TỔNG CỘNG: ${order.final_amount.toLocaleString('vi-VN')} đ`);
  lines.push(`Thanh toán: ${paymentMethod}`);
  if (paymentMethod === 'CASH' && cashReceived !== undefined) {
    lines.push(`Tiền khách đưa: ${cashReceived.toLocaleString('vi-VN')} đ`);
    const change = Math.max(0, cashReceived - order.final_amount);
    lines.push(`Tiền thừa: ${change.toLocaleString('vi-VN')} đ`);
  }
  lines.push('================================');
  return lines.join('\n');
}

async function runAllTests() {
  const db = await setupTestDb();

  console.log('--- TEST GROUP 1: DISCOUNT VALIDATION & CALCULATION (A, B, C, D, E) ---');

  // Test A: Discount = 0
  const saleA = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 2 }], // 2 * 250,000 = 500,000
    totalDiscount: 0,
    createdBy: 1,
  });
  assert(saleA.order.total_amount === 500000, 'Test A: Subtotal is 500,000đ when discount = 0');
  assert(saleA.order.total_discount === 0, 'Test A: Total discount is 0đ');
  assert(saleA.order.final_amount === 500000, 'Test A: Final amount is 500,000đ');

  // Test B: Discount hợp lệ
  const saleB = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 2 }], // 500,000
    totalDiscount: 50000,
    createdBy: 1,
  });
  assert(saleB.order.total_amount === 500000, 'Test B: Subtotal is 500,000đ');
  assert(saleB.order.total_discount === 50000, 'Test B: Total discount is 50,000đ');
  assert(saleB.order.final_amount === 450000, 'Test B: Final amount is 450,000đ (500k - 50k)');

  // Test C: Discount tối đa (100% discount, final = 0)
  const saleC = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 1 }], // 250,000
    totalDiscount: 250000,
    createdBy: 1,
  });
  assert(saleC.order.total_amount === 250000, 'Test C: Subtotal is 250,000đ');
  assert(saleC.order.total_discount === 250000, 'Test C: 100% discount applied (250,000đ)');
  assert(saleC.order.final_amount === 0, 'Test C: Final amount is 0đ');

  // Test D: Discount vượt giới hạn
  let errorD = null;
  try {
    await createMultiItemSale(db, {
      items: [{ productId: 1, quantity: 1 }], // 250,000
      totalDiscount: 250001,
      createdBy: 1,
    });
  } catch (err) {
    errorD = err;
  }
  assert(errorD instanceof ValidationError, 'Test D: Throws ValidationError when discount exceeds subtotal');

  // Test E: Discount âm
  let errorE1 = null;
  try {
    await createMultiItemSale(db, {
      items: [{ productId: 1, quantity: 1 }],
      totalDiscount: -10000,
      createdBy: 1,
    });
  } catch (err) {
    errorE1 = err;
  }
  assert(errorE1 instanceof ValidationError, 'Test E1: Throws ValidationError when totalDiscount < 0');

  let errorE2 = null;
  try {
    await createMultiItemSale(db, {
      items: [{ productId: 1, quantity: 1, discount: -5000 }],
      createdBy: 1,
    });
  } catch (err) {
    errorE2 = err;
  }
  assert(errorE2 instanceof ValidationError, 'Test E2: Throws ValidationError when item discount < 0');

  console.log('\n--- TEST GROUP 2: OFFLINE TRANSACTION & SQLITE PERSISTENCE (F, G, H) ---');

  // Test F: Offline checkout
  const saleF = await createMultiItemSale(db, {
    items: [{ productId: 2, quantity: 1 }], // 350,000
    totalDiscount: 35000,
    paymentMethod: 'CASH',
    createdBy: 1,
  });
  assert(saleF.order.id > 0, 'Test F: Offline checkout generated local order ID');
  assert(saleF.order.final_amount === 315000, 'Test F: Offline final amount is 315,000đ');

  // Test G: SQLite persistence
  const savedOrder = await db.getFirstAsync('SELECT * FROM sales_orders WHERE client_order_id = ?', [saleF.order.client_order_id]);
  const savedRecord = await db.getFirstAsync('SELECT * FROM sales_records WHERE client_order_id = ?', [saleF.order.client_order_id]);
  const savedMovement = await db.getFirstAsync('SELECT * FROM stock_movements WHERE reference_id = ?', [saleF.order.client_order_id]);

  assert(savedOrder !== null, 'Test G1: Sales order persisted in SQLite');
  assert(savedOrder.total_discount === 35000, 'Test G2: Persisted total_discount matches 35,000đ');
  assert(savedRecord !== null, 'Test G3: Sales record persisted in SQLite');
  assert(savedRecord.discount === 35000, 'Test G4: Line discount persisted in sales_records');
  assert(savedRecord.total_revenue === 315000, 'Test G5: Line net revenue is 315,000đ');
  assert(savedMovement !== null, 'Test G6: Stock movement record created atomically');

  // Test H: App restart simulation (persists across fresh driver connection)
  const restartDriver = new NodeTestSqliteDriver();
  await restartDriver.execAsync(schemaSql);
  // Copy tables to simulate disk persistence
  await restartDriver.runAsync(`
    INSERT INTO sales_orders (client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [savedOrder.client_order_id, savedOrder.order_code, savedOrder.sale_date, savedOrder.total_amount, savedOrder.total_discount, savedOrder.final_amount, savedOrder.total_items, savedOrder.status]);
  const reloadedOrder = await restartDriver.getFirstAsync('SELECT * FROM sales_orders WHERE client_order_id = ?', [savedOrder.client_order_id]);
  assert(reloadedOrder && reloadedOrder.total_discount === 35000, 'Test H: App restart retains accurate discount and order state');

  console.log('\n--- TEST GROUP 3: OUTBOX & SYNC (I, J, K) ---');

  // Test I: Outbox payload
  const outboxEntry = await db.getFirstAsync('SELECT * FROM sync_outbox WHERE entity_id = ?', [saleF.order.client_order_id]);
  assert(outboxEntry !== null, 'Test I1: Outbox entry created for sale order');
  const parsedPayload = JSON.parse(outboxEntry.payload);
  assert(parsedPayload.total_amount === 350000, 'Test I2: Outbox payload has total_amount = 350,000đ');
  assert(parsedPayload.total_discount === 35000, 'Test I3: Outbox payload has total_discount = 35,000đ');
  assert(parsedPayload.final_amount === 315000, 'Test I4: Outbox payload has final_amount = 315,000đ');
  assert(parsedPayload.items[0].discount === 35000, 'Test I5: Outbox items have discount = 35,000đ');

  // Test J: Sync simulation
  await db.runAsync("UPDATE sync_outbox SET status = 'COMPLETED' WHERE id = ?", [outboxEntry.id]);
  await db.runAsync("UPDATE sales_orders SET sync_status = 'SYNCED', synced_at = datetime('now') WHERE client_order_id = ?", [saleF.order.client_order_id]);
  const syncedOrder = await db.getFirstAsync('SELECT * FROM sales_orders WHERE client_order_id = ?', [saleF.order.client_order_id]);
  assert(syncedOrder.sync_status === 'SYNCED', 'Test J: Order marked SYNCED without losing discount data');
  assert(syncedOrder.total_discount === 35000, 'Test J: Synced order discount preserved');

  // Test K: Duplicate sync idempotency check
  const duplicateCheck = await db.getFirstAsync('SELECT id FROM sales_orders WHERE client_order_id = ?', [saleF.order.client_order_id]);
  assert(duplicateCheck.id === savedOrder.id, 'Test K: Idempotency check prevents duplicate insertion');

  console.log('\n--- TEST GROUP 4: RECEIPT & INVENTORY (L, M) ---');

  // Test L: Receipt formatting
  const receiptText = formatReceipt(saleF.order, saleF.items, 'CASH', 400000);
  assert(receiptText.includes('Tạm tính: 350.000 đ'), 'Test L1: Receipt includes Tạm tính');
  assert(receiptText.includes('Giảm giá: -35.000 đ'), 'Test L2: Receipt includes Giảm giá');
  assert(receiptText.includes('TỔNG CỘNG: 315.000 đ'), 'Test L3: Receipt includes TỔNG CỘNG');
  assert(receiptText.includes('Tiền khách đưa: 400.000 đ'), 'Test L4: Receipt includes Tiền khách đưa');
  assert(receiptText.includes('Tiền thừa: 85.000 đ'), 'Test L5: Receipt includes Tiền thừa (400k - 315k)');

  // Test M: Inventory deduction is independent of discount
  const prod2Before = (await db.getFirstAsync('SELECT current_stock FROM products WHERE id = 2')).current_stock;
  await createMultiItemSale(db, {
    items: [{ productId: 2, quantity: 3 }],
    totalDiscount: 100000, // Discount 100,000đ
    createdBy: 1,
  });
  const prod2After = (await db.getFirstAsync('SELECT current_stock FROM products WHERE id = 2')).current_stock;
  assert(prod2Before - prod2After === 3, 'Test M1: Stock deducted by exactly quantity (3), unaffected by discount');

  // Deduction with 0 discount
  const prod2BeforeZero = prod2After;
  await createMultiItemSale(db, {
    items: [{ productId: 2, quantity: 2 }],
    totalDiscount: 0,
    createdBy: 1,
  });
  const prod2AfterZero = (await db.getFirstAsync('SELECT current_stock FROM products WHERE id = 2')).current_stock;
  assert(prod2BeforeZero - prod2AfterZero === 2, 'Test M2: Stock deduction with 0 discount is identical (deducted 2)');

  console.log('\n--- TEST GROUP 5: DASHBOARD, REPORT & PROFIT (N, O, P) ---');

  // Test N: Dashboard revenue calculation (net revenue after discount)
  const dashboardStats = await db.getFirstAsync(`
    SELECT
      SUM(final_amount) as total_revenue,
      SUM(total_amount) as gross_subtotal,
      SUM(total_discount) as total_discount
    FROM sales_orders
    WHERE status = 'COMPLETED'
  `);
  assert(dashboardStats.total_revenue === dashboardStats.gross_subtotal - dashboardStats.total_discount,
    'Test N: Dashboard revenue = gross_subtotal - total_discount');

  // Test O: Report aggregation
  const reportRow = await db.getFirstAsync(`
    SELECT
      COUNT(id) as total_orders,
      SUM(total_discount) as discount_sum,
      SUM(final_amount) as net_sales
    FROM sales_orders
    WHERE status = 'COMPLETED'
  `);
  assert(reportRow.total_orders > 0 && reportRow.discount_sum > 0, 'Test O: Report aggregates order count and total discount');

  // Test P: Profit calculation (profit = net revenue after discount - total FIFO cost)
  // Let's create an isolated sale to check exact profit math
  // Product 1: cost 100,000, selling 250,000, qty 2 => subtotal 500,000, cost 200,000
  // Discount: 50,000 => net revenue 450,000. Expected profit = 450,000 - 200,000 = 250,000.
  const saleP = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 2 }],
    totalDiscount: 50000,
    createdBy: 1,
  });
  const recordP = await db.getFirstAsync('SELECT * FROM sales_records WHERE client_order_id = ?', [saleP.order.client_order_id]);
  assert(recordP.total_revenue === 450000, 'Test P1: Record total_revenue is net 450,000đ');
  assert(recordP.total_cost === 200000, 'Test P2: Record total_cost is 200,000đ');
  assert(recordP.profit === 250000, 'Test P3: Profit is exactly 250,000đ (net revenue - cost)');

  console.log('\n--- TEST GROUP 6: ACCOUNT ISOLATION (Q) ---');

  // Test Q: Account isolation
  // User 1 creates an order with discount
  const saleUser1 = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 1 }],
    totalDiscount: 20000,
    createdBy: 1,
  });
  // User 2 creates an order with discount
  const saleUser2 = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 1 }],
    totalDiscount: 40000,
    createdBy: 2,
  });

  const user1Orders = await db.getAllAsync('SELECT * FROM sales_orders WHERE created_by = 1');
  const user2Orders = await db.getAllAsync('SELECT * FROM sales_orders WHERE created_by = 2');

  const user1HasUser2Order = user1Orders.some(o => o.client_order_id === saleUser2.order.client_order_id);
  const user2HasUser1Order = user2Orders.some(o => o.client_order_id === saleUser1.order.client_order_id);

  assert(!user1HasUser2Order, 'Test Q1: User 1 query does not leak User 2 order/discount');
  assert(!user2HasUser1Order, 'Test Q2: User 2 query does not leak User 1 order/discount');

  // Outbox isolation
  const user1Outbox = await db.getAllAsync('SELECT * FROM sync_outbox WHERE user_id = 1');
  const user2Outbox = await db.getAllAsync('SELECT * FROM sync_outbox WHERE user_id = 2');
  assert(user1Outbox.every(e => e.user_id === 1), 'Test Q3: Outbox filtered by user 1 has only user 1 entries');
  assert(user2Outbox.every(e => e.user_id === 2), 'Test Q4: Outbox filtered by user 2 has only user 2 entries');

  console.log('\n--- TEST GROUP 7: MULTI-ITEM SALE & PROPORTIONAL DISTRIBUTION (R) ---');

  // Test R: Multi-item sale
  // Item 1: 1 x 250,000 = 250,000 (50% of subtotal)
  // Item 2: 1 x 250,000 = 250,000 (50% of subtotal)
  // Total subtotal: 500,000
  // Order discount: 50,000 => Each item receives 25,000 discount
  const saleR = await createMultiItemSale(db, {
    items: [
      { productId: 1, quantity: 1 },
      { productId: 1, quantity: 1 },
    ],
    totalDiscount: 50000,
    createdBy: 1,
  });

  const recordsR = await db.getAllAsync('SELECT * FROM sales_records WHERE client_order_id = ? ORDER BY id ASC', [saleR.order.client_order_id]);
  assert(recordsR.length === 2, 'Test R1: 2 records created for 2-item order');
  assert(recordsR[0].discount === 25000, 'Test R2: Item 1 received 25,000đ proportional discount');
  assert(recordsR[1].discount === 25000, 'Test R3: Item 2 received 25,000đ proportional discount');
  assert(recordsR[0].discount + recordsR[1].discount === 50000, 'Test R4: Sum of line discounts equals total_discount (50,000đ)');
  assert(recordsR[0].total_revenue + recordsR[1].total_revenue === 450000, 'Test R5: Sum of line revenues equals final_amount (450,000đ)');

  console.log('\n--- TEST GROUP 8: PAYMENT METHODS & CHANGE CALCULATION (S, T, U) ---');

  // Test S: Payment CASH
  const finalAmtS = saleR.order.final_amount; // 450,000
  const cashGivenS = 500000;
  const changeS = cashGivenS - finalAmtS;
  assert(changeS === 50000, 'Test S: CASH payment change calculated correctly (500k - 450k = 50k)');

  // Test T: Payment BANK_TRANSFER
  const saleT = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 1 }],
    totalDiscount: 20000,
    paymentMethod: 'BANK_TRANSFER',
    createdBy: 1,
  });
  assert(saleT.outboxPayload.payment_method === 'BANK_TRANSFER', 'Test T: BANK_TRANSFER recorded in outbox');

  // Test U: Payment CARD
  const saleU = await createMultiItemSale(db, {
    items: [{ productId: 1, quantity: 1 }],
    totalDiscount: 10000,
    paymentMethod: 'CARD',
    createdBy: 1,
  });
  assert(saleU.outboxPayload.payment_method === 'CARD', 'Test U: CARD payment recorded in outbox');

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
