// Comprehensive verification of WebDemoSqliteDriver
import { WebDemoSqliteDriver } from '../src/database/WebDemoSqliteDriver';

async function run() {
  console.log('================================================================');
  console.log('    TESTING WebDemoSqliteDriver QUERY COMPATIBILITY & LOGIC    ');
  console.log('================================================================\n');

  // Mock localStorage for Node environment
  const storage = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => storage.get(k) || null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  };

  const driver = new WebDemoSqliteDriver();
  await driver.openAsync('test.db');

  let passed = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  // 1. Check seed data
  const prods = await driver.getAllAsync<any>('SELECT * FROM products');
  assert(prods.length === 10, `Initial products count is 10 (got ${prods.length})`);

  // 2. Test Overview KPI SUM query
  const todayStr = new Date().toISOString().slice(0, 10);
  const curOverview = await driver.getFirstAsync<any>(`
    SELECT 
      COUNT(id) as transaction_count,
      COALESCE(SUM(quantity), 0) as units_sold,
      COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
      COALESCE(SUM(discount), 0) as total_discount,
      COALESCE(SUM(total_revenue), 0) as net_revenue,
      COALESCE(SUM(total_cost), 0) as cogs,
      COALESCE(SUM(profit), 0) as gross_profit
    FROM sales_records
    WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
  `, [todayStr, todayStr]);

  assert(Number(curOverview?.net_revenue) > 0, `Today net revenue is > 0 (${curOverview?.net_revenue}đ)`);
  assert(Number(curOverview?.units_sold) > 0, `Today units sold is > 0 (${curOverview?.units_sold})`);

  // 3. Test COUNT(DISTINCT client_order_id)
  const ordersCountRow = await driver.getFirstAsync<any>(`
    SELECT COUNT(DISTINCT client_order_id) as orders_count
    FROM sales_records
    WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
  `, [todayStr, todayStr]);

  assert(Number(ordersCountRow?.orders_count) === 3, `Today distinct orders count is 3 (got ${ordersCountRow?.orders_count})`);

  // 4. Test Product Lot Drilldown (total_sold)
  const lotDrillSold = await driver.getFirstAsync<any>(`
    SELECT COALESCE(SUM(quantity), 0) as total_sold
    FROM sales_records
    WHERE product_id = ? AND status = 'COMPLETED'
  `, [1]);

  assert(Number(lotDrillSold?.total_sold) > 0, `Product 1 total_sold is > 0 (got ${lotDrillSold?.total_sold})`);

  // 5. Test Date Orders Drilldown (Must NOT be hijacked by staff performance)
  const dateDrill = await driver.getAllAsync<any>(`
    SELECT 
      COALESCE(so.id, sr.order_id, sr.id) as id,
      COALESCE(so.order_code, sr.transaction_code) as order_code,
      sr.sale_date,
      COALESCE(so.final_amount, SUM(sr.total_revenue)) as final_amount,
      COALESCE(so.total_discount, SUM(sr.discount)) as total_discount,
      COALESCE(so.total_amount, SUM(sr.quantity * sr.unit_price_at_sale)) as total_amount,
      COALESCE(so.payment_method, 'CASH') as payment_method,
      u.full_name as cashier_name,
      COUNT(sr.id) as items_count
    FROM sales_records sr
    LEFT JOIN sales_orders so ON so.id = sr.order_id OR so.client_order_id = sr.client_order_id
    LEFT JOIN users u ON u.id = sr.created_by
    WHERE sr.sale_date = ? AND sr.status = 'COMPLETED'
    GROUP BY COALESCE(so.id, sr.order_id, sr.id), COALESCE(so.order_code, sr.transaction_code), sr.sale_date, so.final_amount, so.total_discount, so.total_amount, so.payment_method, u.full_name
    ORDER BY id DESC
  `, [todayStr]);

  assert(dateDrill.length === 3, `Date drilldown returned 3 orders (got ${dateDrill.length})`);
  assert(dateDrill[0].order_code !== undefined && dateDrill[0].cashier_name !== undefined, `Order has order_code (${dateDrill[0].order_code}) and cashier_name (${dateDrill[0].cashier_name})`);
  assert(dateDrill[0].items_count > 0, `Order has items_count (${dateDrill[0].items_count})`);

  // 6. Test Hourly Performance (distinct orders_count)
  const hourlyRows = await driver.getAllAsync<any>(`
    SELECT 
      CAST(strftime('%H', created_at) AS INTEGER) as hour_of_day,
      COUNT(DISTINCT client_order_id) as orders_count,
      COALESCE(SUM(total_revenue), 0) as net_revenue,
      COALESCE(SUM(profit), 0) as gross_profit,
      COALESCE(SUM(quantity), 0) as units_sold
    FROM sales_records
    WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
    GROUP BY hour_of_day
    ORDER BY hour_of_day ASC
  `, [todayStr, todayStr]);

  assert(hourlyRows.length > 0, `Hourly rows returned: ${hourlyRows.length}`);
  const totalHourlyOrders = hourlyRows.reduce((sum, h) => sum + h.orders_count, 0);
  assert(totalHourlyOrders === 3, `Total orders across hours for today is 3 (got ${totalHourlyOrders})`);

  // 7. Test Timeline Chronological ASC Sorting
  const timelineRows = await driver.getAllAsync<any>(`
    SELECT 
      sale_date as time_key,
      COUNT(id) as transaction_count,
      COALESCE(SUM(quantity), 0) as sold_quantity,
      COALESCE(SUM(total_revenue), 0) as revenue,
      COALESCE(SUM(total_cost), 0) as total_cost,
      COALESCE(SUM(profit), 0) as profit
    FROM sales_records
    WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
    GROUP BY sale_date ORDER BY sale_date ASC
  `, ['2026-08-01', '2026-09-30']);

  assert(timelineRows.length > 1, `Timeline rows returned: ${timelineRows.length}`);
  for (let i = 1; i < timelineRows.length; i++) {
    assert(timelineRows[i].time_key >= timelineRows[i - 1].time_key, `Timeline sorted ASC: ${timelineRows[i - 1].time_key} <= ${timelineRows[i].time_key}`);
  }

  // 8. Test LocalStorage Persistence on new Sale
  console.log('\n--- Test 8: Persistence on New Order Creation ---');
  await driver.runAsync(`
    INSERT INTO sales_orders (client_order_id, order_code, sale_date, total_amount, total_discount, final_amount, total_items, payment_method, cash_received, cash_change, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['ord-test-pers-01', 'HD-TEST-001', todayStr, 150000, 0, 150000, 1, 'CASH', 150000, 0, 'Test persistence', 1]);

  await driver.runAsync(`
    INSERT INTO sales_records (order_id, client_order_id, client_transaction_id, transaction_code, product_id, sale_date, quantity, unit_price_at_sale, cost_price_at_sale, discount, total_revenue, total_cost, profit, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [999, 'ord-test-pers-01', 'tx-test-pers-01', 'HD-TEST-001-P1', 1, todayStr, 1, 150000, 85000, 0, 150000, 85000, 65000, 'COMPLETED', 1]);

  assert(storage.has('t_shop_web_demo_data_v6'), `LocalStorage contains key 't_shop_web_demo_data_v6'`);

  // Create a brand new driver instance and verify it restores state from storage
  const driver2 = new WebDemoSqliteDriver();
  await driver2.openAsync('test.db');
  const restoredOrders = await driver2.getAllAsync<any>('SELECT * FROM sales_orders WHERE client_order_id = ?', ['ord-test-pers-01']);
  assert(restoredOrders.length === 1, `New driver instance successfully restored order from localStorage`);

  // 9. Test Exact Report Overview curSql (Tab 1)
  console.log('\n--- Test 9: Tab 1 Report Overview curSql Aggregation ---');
  const tab1Overview = await driver.getFirstAsync<any>(`
    SELECT 
      COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
      COALESCE(SUM(discount), 0) as total_discount,
      COALESCE(SUM(total_revenue), 0) as net_revenue,
      COALESCE(SUM(total_cost), 0) as total_cogs,
      COALESCE(SUM(profit), 0) as gross_profit,
      COALESCE(SUM(quantity), 0) as units_sold,
      COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as orders_count
    FROM sales_records
    WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
  `, ['2026-09-01', '2026-09-30']);

  assert(Number(tab1Overview?.gross_sales) > 0, `Tab 1 gross_sales > 0 (${tab1Overview?.gross_sales}đ)`);
  assert(Number(tab1Overview?.total_discount) > 0, `Tab 1 total_discount > 0 (${tab1Overview?.total_discount}đ)`);
  assert(Number(tab1Overview?.net_revenue) > 0, `Tab 1 net_revenue > 0 (${tab1Overview?.net_revenue}đ)`);
  assert(Number(tab1Overview?.total_cogs) > 0, `Tab 1 total_cogs > 0 (${tab1Overview?.total_cogs}đ)`);
  assert(Number(tab1Overview?.gross_profit) > 0, `Tab 1 gross_profit > 0 (${tab1Overview?.gross_profit}đ)`);
  assert(Number(tab1Overview?.units_sold) > 0, `Tab 1 units_sold > 0 (${tab1Overview?.units_sold})`);
  assert(Number(tab1Overview?.orders_count) > 0, `Tab 1 orders_count > 0 (${tab1Overview?.orders_count})`);
  assert(
    tab1Overview?.gross_sales - tab1Overview?.total_discount === tab1Overview?.net_revenue,
    `Tab 1 Waterfall identity holds: Gross (${tab1Overview?.gross_sales}) - Discount (${tab1Overview?.total_discount}) = Net Revenue (${tab1Overview?.net_revenue})`
  );

  // 10. Test Exact Tab 2 Discount Analysis baseSql
  console.log('\n--- Test 10: Tab 2 Discount Analysis baseSql Aggregation ---');
  const tab2Discount = await driver.getFirstAsync<any>(`
    SELECT
      COALESCE(SUM(quantity * unit_price_at_sale), 0) as gross_sales,
      COALESCE(SUM(discount), 0) as total_discount,
      COUNT(DISTINCT COALESCE(client_order_id, transaction_code)) as total_orders,
      COUNT(DISTINCT CASE WHEN discount > 0 THEN COALESCE(client_order_id, transaction_code) ELSE NULL END) as discounted_orders
    FROM sales_records
    WHERE sale_date >= ? AND sale_date <= ? AND status = 'COMPLETED'
  `, ['2026-09-01', '2026-09-30']);

  assert(Number(tab2Discount?.gross_sales) > 0, `Tab 2 gross_sales > 0 (${tab2Discount?.gross_sales}đ)`);
  assert(Number(tab2Discount?.total_discount) > 0, `Tab 2 total_discount > 0 (${tab2Discount?.total_discount}đ)`);
  assert(Number(tab2Discount?.total_orders) > 0, `Tab 2 total_orders > 0 (${tab2Discount?.total_orders})`);
  assert(Number(tab2Discount?.discounted_orders) > 0, `Tab 2 discounted_orders > 0 (${tab2Discount?.discounted_orders})`);

  // 11. Test Tab 5 Inventory Valuation Matching
  console.log('\n--- Test 11: Tab 5 Inventory Lots Valuation ---');
  const lotValRow = await driver.getFirstAsync<any>(`
    SELECT COALESCE(SUM(quantity_remaining * unit_cost), 0) as lot_valuation
    FROM inventory_lots
    WHERE quantity_remaining > 0
  `);
  assert(Number(lotValRow?.lot_valuation) === 34210000, `Tab 5 lot_valuation is exactly 34,210,000đ (got ${lotValRow?.lot_valuation}đ)`);

  // 12. Test Category Create, Update (Sửa), and Delete (Xóa)
  console.log('\n--- Test 12: Category Create, Update (Sửa), Delete (Xóa) ---');
  const catCreateRes = await driver.runAsync(`
    INSERT INTO categories (code, name, description, status)
    VALUES (?, ?, ?, 'ACTIVE')
  `, ['CAT_TEST_01', 'Danh mục Test', 'Mô tả test']);
  const newCatId = catCreateRes.lastInsertRowId;
  assert(newCatId > 0, `Category created with id ${newCatId}`);

  // Test Update (Sửa)
  await driver.runAsync(`
    UPDATE categories
    SET code = ?, name = ?, description = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `, ['CAT_TEST_MOD', 'Danh mục Đã Sửa', 'Mô tả đã sửa', 'ACTIVE', newCatId]);

  const allCatsAfterUpdate = await driver.getAllAsync<any>('SELECT * FROM categories');
  const updatedCat = allCatsAfterUpdate.find(c => c.id === newCatId);
  assert(updatedCat?.name === 'Danh mục Đã Sửa', `Category name updated to '${updatedCat?.name}'`);
  assert(updatedCat?.code === 'CAT_TEST_MOD', `Category code updated to '${updatedCat?.code}'`);
  assert(updatedCat?.description === 'Mô tả đã sửa', `Category description updated to '${updatedCat?.description}'`);

  // Test Delete (Xóa)
  await driver.runAsync('DELETE FROM categories WHERE id = ?', [newCatId]);
  const allCatsAfterDelete = await driver.getAllAsync<any>('SELECT * FROM categories');
  const deletedCat = allCatsAfterDelete.find(c => c.id === newCatId);
  assert(!deletedCat, `Category with id ${newCatId} successfully deleted`);

  // 13. Test Inactive Product Filtering in Warehouse Picker
  console.log('\n--- Test 13: Inactive Products Excluded from Sales Picker ---');
  const allProds = await driver.getAllAsync<any>('SELECT * FROM products');
  assert(allProds.length === 10, `Initial products: 10`);

  // Deactivate product 1
  await driver.runAsync("UPDATE products SET status = 'INACTIVE' WHERE id = 1");
  const prodsAfterDeactivation = await driver.getAllAsync<any>('SELECT * FROM products');
  const activePickerProds = prodsAfterDeactivation.filter(p => (p.status || 'ACTIVE') === 'ACTIVE');
  assert(activePickerProds.length === 9, `Active products for picker is 9 (got ${activePickerProds.length})`);
  assert(!activePickerProds.some(p => p.id === 1), 'Inactive Product 1 is excluded from warehouse picker list');

  // Reactivate product 1 to keep demo data clean
  await driver.runAsync("UPDATE products SET status = 'ACTIVE' WHERE id = 1");

  console.log(`\n================================================================`);
  console.log(`  ✓ ALL ${passed} WebDemoSqliteDriver TESTS PASSED 100%!`);
  console.log(`================================================================`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
