import fs from 'fs';
import { Pool } from 'pg';

const env = fs.readFileSync('.env.local', 'utf-8');
const line = env.split('\n').find(l => l.startsWith('POSTGRES_URL='));
const url = line.substring('POSTGRES_URL='.length).trim().replace(/^["']|["']$/g, '');
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/gi, '');

const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });

async function benchmark(name, fn) {
  const start = performance.now();
  const res = await fn();
  const duration = Math.round(performance.now() - start);
  console.log(`[PASS] ${name} executed in ${duration}ms (${Array.isArray(res) ? res.length + ' rows' : 'object'})`);
  return duration;
}

try {
  console.log('=== BENCHMARKING REPORT QUERIES DIRECTLY ON SUPABASE POSTGRESQL ===');
  const startDate = '2026-08-01';
  const endDate = '2026-09-30';

  // 1. Overview
  await benchmark('Q01 Overview KPIs', async () => {
    const res = await pool.query(`
      SELECT 
        COALESCE(SUM(sr.total_revenue), 0) as total_revenue,
        COALESCE(SUM(sr.total_cost), 0) as total_cogs,
        COALESCE(SUM(sr.profit), 0) as total_profit,
        COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as sales_count,
        COALESCE(SUM(sr.quantity), 0) as sold_quantity
      FROM sales_records sr
      WHERE DATE(sr.sale_date) >= $1 AND DATE(sr.sale_date) <= $2 
        AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
    `, [startDate, endDate]);
    return res.rows[0];
  });

  // 2. Timeline
  await benchmark('Q02 Daily Sales Timeline', async () => {
    const res = await pool.query(`
      SELECT 
        DATE(sr.sale_date) as date,
        COALESCE(SUM(sr.total_revenue), 0) as revenue,
        COALESCE(SUM(sr.total_cost), 0) as cogs,
        COALESCE(SUM(sr.profit), 0) as profit,
        COUNT(DISTINCT COALESCE(sr.transaction_code, sr.id::text)) as order_count,
        COALESCE(SUM(sr.quantity), 0) as units_sold
      FROM sales_records sr
      WHERE DATE(sr.sale_date) >= $1 AND DATE(sr.sale_date) <= $2 
        AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
      GROUP BY DATE(sr.sale_date)
      ORDER BY date ASC
    `, [startDate, endDate]);
    return res.rows;
  });

  // 3. Top Products
  await benchmark('Q03 Top Products Performance', async () => {
    const res = await pool.query(`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.sku,
        COALESCE(c.name, 'Chưa phân loại') as category_name,
        COALESCE(SUM(sr.quantity), 0) as units_sold,
        COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
        COALESCE(SUM(sr.total_cost), 0) as cogs,
        COALESCE(SUM(sr.profit), 0) as gross_profit
      FROM sales_records sr
      JOIN products p ON p.id = sr.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE DATE(sr.sale_date) >= $1 AND DATE(sr.sale_date) <= $2 
        AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
      GROUP BY p.id, p.name, p.sku, c.name
      ORDER BY net_revenue DESC
      LIMIT 20
    `, [startDate, endDate]);
    return res.rows;
  });

  // 4. Category Performance
  await benchmark('Q04 Category Breakdown', async () => {
    const res = await pool.query(`
      SELECT 
        c.id as category_id,
        c.name as category_name,
        COALESCE(SUM(sr.quantity), 0) as units_sold,
        COALESCE(SUM(sr.total_revenue), 0) as net_revenue,
        COALESCE(SUM(sr.total_cost), 0) as cogs,
        COALESCE(SUM(sr.profit), 0) as gross_profit
      FROM sales_records sr
      JOIN products p ON p.id = sr.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE DATE(sr.sale_date) >= $1 AND DATE(sr.sale_date) <= $2 
        AND COALESCE(sr.status, 'COMPLETED') = 'COMPLETED'
      GROUP BY c.id, c.name
      ORDER BY net_revenue DESC
    `, [startDate, endDate]);
    return res.rows;
  });

  // 5. Inventory Capital
  await benchmark('Q05 Inventory Capital & Valuation', async () => {
    const res = await pool.query(`
      SELECT 
        COALESCE(SUM(current_stock), 0) as total_stock,
        COALESCE(SUM(current_stock * current_cost_price), 0) as total_cost_value,
        COALESCE(SUM(current_stock * current_selling_price), 0) as total_retail_value,
        COUNT(CASE WHEN current_stock <= min_stock_alert THEN 1 END) as low_stock_count,
        COUNT(CASE WHEN current_stock = 0 THEN 1 END) as out_of_stock_count
      FROM products
      WHERE status = 'ACTIVE'
    `);
    return res.rows[0];
  });

} catch (err) {
  console.error('Benchmark error:', err);
} finally {
  await pool.end();
}
